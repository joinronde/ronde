import "server-only";
import type { ForgeConnectionView, ForgeItem, ForgeSettings, GithubSource, GitlabSource, IntegrationOrigin } from "@ronde/core/types";
import type { Prisma, ScopedClient } from "@ronde/db";
import { readConfig } from "@ronde/module-sdk";
import { github, gitlab } from "@ronde/modules";
import { type GitlabGrant, grantDue, parseGitlabSecret } from "@/lib/shared/gitlab-grant";
import { singleFlight } from "@/lib/shared/single-flight";
import { audit } from "./audit";
import type { WorkspaceContext } from "./authz";
import { env } from "./env";
import { AccessError, IntegrationError, OpError } from "./errors";
import { renewGrant } from "./gitlab-oauth";
import { isCloud } from "./license";
import { outboundFetch } from "./outbound";
import { TOKEN_FORMAT } from "./project-sources";
import { canEncrypt, decryptSecret, encryptSecret } from "./secrets";
import { deleteTracker } from "./trackers";

// Connections to the code forges (GitLab, GitHub): a personal token, or the grant of "Connect with GitLab",
// kept encrypted. The workspace's serve every meeting and its trackers; a meeting may add its own, which it
// alone sees. On a self-hosted server, GITLAB_TOKEN and GITHUB_TOKEN make one more connection, the instance's.

export const FORGE_KINDS = ["gitlab", "github"] as const;
export type ForgeKind = (typeof FORGE_KINDS)[number];

/** The id of the instance's connection, which has no row */
export const INSTANCE_CONNECTION = "instance";

/** What a request to the forge needs: the server and the token, sent as "Authorization: Bearer" */
export interface ForgeAccess {
  id: string;
  kind: ForgeKind;
  url: string;
  token: string;
}

export interface ForgeConnectionInput {
  id?: string;
  kind: ForgeKind;
  name: string;
  /** Empty: the server of the instance (GITLAB_URL, GITHUB_API_URL) */
  url?: string;
  /** Empty: keep the saved token */
  token?: string;
}

type Row = { id: string; kind: ForgeKind; name: string; url: string; account: string; secret: string; meetingId: string | null };

export const defaultUrl = (kind: ForgeKind) => (kind === "gitlab" ? env.gitlabUrl() : env.githubApiUrl());

/** The instance's token serves the workspaces of a self-hosted server; in the cloud each brings its own */
const instanceToken = (kind: ForgeKind) => (isCloud() ? "" : kind === "gitlab" ? env.gitlabToken() : env.githubToken());

/**
 * The instance's connection: GITLAB_TOKEN on a self-hosted server; for GitHub, GITHUB_TOKEN or else no token at
 * all, which reads public repositories
 */
function instanceConnection(kind: ForgeKind): ForgeConnectionView | null {
  if (kind === "gitlab" && !instanceToken("gitlab")) return null;
  return { id: INSTANCE_CONNECTION, kind, name: "", url: defaultUrl(kind), account: "", scope: "instance", oauth: false };
}

/** `withOAuth`: whether it was connected with OAuth, read from its secret (decrypted: for the settings only) */
const view = (r: Row, withOAuth: boolean): ForgeConnectionView => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  url: r.url,
  account: r.account,
  scope: r.meetingId ? "meeting" : "workspace",
  oauth: withOAuth && isOAuth(r.secret),
});

/** Whether a connection's secret is the grant of "Connect with GitLab" */
export const isOAuth = (secret: string) => !!parseGitlabSecret(safeDecrypt(secret)).grant;

function safeDecrypt(secret: string): string {
  try {
    return decryptSecret(secret);
  } catch {
    return "";
  }
}

/** The server as typed, or the instance's: https (http only on a self-hosted server), without a trailing slash */
export function forgeUrl(kind: ForgeKind, raw: string | undefined): string {
  const typed = (raw ?? "").trim();
  if (!typed) return defaultUrl(kind);
  let url: URL;
  try {
    url = new URL(typed);
  } catch {
    throw new OpError("forgeUrlInvalid");
  }
  if (url.protocol !== "https:" && (url.protocol !== "http:" || isCloud())) throw new OpError("forgeUrlInvalid");
  // People paste the address of the API as often as that of the server
  return url.href.replace(/\/+$/, "").replace(/\/api\/v4$/, "");
}

/** Connections the workspace (meetingId null) or a meeting may use: the workspace's, the meeting's own, the instance's */
export async function listForgeConnections(db: ScopedClient, meetingId: string | null, withOAuth = true): Promise<ForgeConnectionView[]> {
  const rows = await db.forgeConnection.findMany({
    where: meetingId ? { OR: [{ meetingId: null }, { meetingId }] } : { meetingId: null },
    orderBy: { createdAt: "asc" },
  });
  const instance = FORGE_KINDS.map(instanceConnection).filter((c): c is ForgeConnectionView => !!c);
  return [...rows.map((r) => view(r, withOAuth)), ...instance];
}

/** The forge account a token reads as; throws when the forge refuses it */
export async function forgeAccount(access: Omit<ForgeAccess, "id">): Promise<string> {
  const api = access.kind === "gitlab" ? `${access.url}/api/v4/user` : `${access.url}/user`;
  const res = await outboundFetch(api, {
    headers: {
      ...(access.token ? { Authorization: `Bearer ${access.token}` } : {}),
      ...(access.kind === "github" ? { Accept: "application/vnd.github+json", "User-Agent": "Ronde" } : {}),
    },
    cache: "no-store",
    // Short: a meeting's connection is checked within its operation's transaction
    signal: AbortSignal.timeout(8_000),
  }).catch(() => {
    throw new IntegrationError(access.kind === "gitlab" ? "gitlabUnreachable" : "githubUnreachable", { url: access.url });
  });
  if (res.status === 401 || res.status === 403)
    throw new IntegrationError(access.kind === "gitlab" ? "gitlabTokenRefused" : "githubTokenRefused");
  if (!res.ok)
    throw access.kind === "gitlab"
      ? new IntegrationError("gitlabStatus", { status: res.status, path: "/user" })
      : new IntegrationError("githubStatus", { status: res.status });
  // A page rather than the API (the site's address, a sign-in portal): the address is not the forge's API
  const me = (await res.json().catch(() => null)) as { username?: string; login?: string } | null;
  if (!me || typeof me !== "object") throw new OpError("forgeUrlInvalid");
  return me.username ?? me.login ?? "";
}

/**
 * Adds or changes a connection, of the workspace (meetingId null) or of a meeting. The token is checked with the
 * forge, which says whose account it is
 */
export async function saveForgeConnection(
  ctx: WorkspaceContext,
  input: ForgeConnectionInput,
  meetingId: string | null,
): Promise<{ id: string }> {
  if (!FORGE_KINDS.includes(input.kind)) throw new OpError("invalidRequest");
  const existing = input.id ? await ctx.db.forgeConnection.findFirst({ where: { id: input.id, meetingId } }) : null;
  if (input.id && !existing) throw new OpError("notFound");
  const kind = existing?.kind ?? input.kind;
  const url = forgeUrl(kind, input.url);
  // Another server than the instance's is reached from Ronde's network: its administrators decide, as for imports
  if (meetingId && url !== defaultUrl(kind) && url !== existing?.url && !ctx.can("connectors.manage"))
    throw new AccessError(403, "forgeServerAdminOnly", { host: new URL(url).host });
  const token = input.token?.trim() ?? "";
  if (!token && !existing?.secret) throw new OpError("connectorSecretRequired");
  if (token && !TOKEN_FORMAT.test(token)) throw new OpError("tokenInvalid");
  if (token && !canEncrypt()) throw new OpError("encryptionNotConfigured");
  // Another server keeps no grant or token of the first one
  if (existing && !token && url !== existing.url) throw new OpError("connectorSecretRequired");
  const account = token ? await forgeAccount({ kind, url, token }) : existing?.account;
  const name = input.name.trim().slice(0, 60) || (kind === "gitlab" ? "GitLab" : "GitHub");
  const data = { name, url, ...(token ? { secret: encryptSecret(token.slice(0, 500)), account: account ?? "" } : {}) };
  const row = existing
    ? await ctx.db.forgeConnection.update({ where: { id: existing.id }, data })
    : await ctx.db.forgeConnection.create({ data: { ...data, workspaceId: ctx.workspace.id, meetingId, kind } });
  await audit(ctx, ctx.db, {
    action: existing ? "forges.update" : "forges.add",
    targetType: "forgeConnection",
    targetId: row.id,
    ...(meetingId ? { meetingId } : {}),
    data: { kind, url },
  });
  return { id: row.id };
}

/** Removes a connection, of the workspace (meetingId null) or of a meeting, and the trackers that open tickets with it */
export async function deleteForgeConnection(ctx: WorkspaceContext, id: string, meetingId: string | null): Promise<void> {
  const row = await ctx.db.forgeConnection.findFirst({
    where: { id, meetingId },
    select: { id: true, trackers: { select: { id: true } } },
  });
  if (!row) throw new OpError("notFound");
  for (const t of row.trackers) await deleteTracker(ctx, t.id);
  await ctx.db.forgeConnection.deleteMany({ where: { id } });
  await audit(ctx, ctx.db, {
    action: "forges.delete",
    targetType: "forgeConnection",
    targetId: id,
    ...(meetingId ? { meetingId } : {}),
  });
}

/** Checks a connection with the forge, and keeps the account it reads as */
export async function testForgeConnection(ctx: WorkspaceContext, id: string, meetingId: string | null): Promise<{ account: string }> {
  const access = await forgeAccess(ctx.db, id, meetingId);
  if (!access) throw new OpError("notFound");
  const account = await forgeAccount(access);
  await ctx.db.forgeConnection.updateMany({ where: { id }, data: { account } });
  return { account };
}

/** One renewal of a connection's grant at a time on this server */
const renewOnce = singleFlight<GitlabGrant>();

/** Keeps a connection's new grant */
export async function saveConnectionGrant(db: ScopedClient, id: string, grant: GitlabGrant): Promise<void> {
  await db.forgeConnection.updateMany({
    where: { id },
    data: { secret: encryptSecret(JSON.stringify(grant)), ...(grant.user ? { account: grant.user } : {}) },
  });
}

/**
 * Back from "Connect with GitLab": the grant connects the connection again, or makes a new one (a meeting's own
 * is used by the meeting right away)
 */
export async function saveOAuthConnection(
  ctx: WorkspaceContext,
  target: { meetingId: string | null; connectionId: string | null },
  grant: GitlabGrant,
): Promise<{ id: string }> {
  const name = grant.user ? `GitLab @${grant.user}` : "GitLab";
  const existing = target.connectionId
    ? await ctx.db.forgeConnection.findFirst({ where: { id: target.connectionId, meetingId: target.meetingId, kind: "gitlab" } })
    : null;
  if (target.connectionId && !existing) throw new OpError("notFound");
  const url = env.gitlabUrl();
  const row = existing
    ? await ctx.db.forgeConnection.update({ where: { id: existing.id }, data: { url } })
    : await ctx.db.forgeConnection.create({
        data: { workspaceId: ctx.workspace.id, meetingId: target.meetingId, kind: "gitlab", name, url },
      });
  await saveConnectionGrant(ctx.db, row.id, grant);
  if (target.meetingId && !existing) await useInMeeting(ctx.db, ctx.workspace.id, target.meetingId, "gitlab", row.id);
  await audit(ctx, ctx.db, {
    action: existing ? "forges.update" : "forges.add",
    targetType: "forgeConnection",
    targetId: row.id,
    ...(target.meetingId ? { meetingId: target.meetingId } : {}),
    data: { kind: "gitlab", url, oauth: true },
  });
  return { id: row.id };
}

/**
 * The access of a connection the workspace (meetingId null) or the meeting may use; an OAuth grant is renewed
 * before it runs out. Null: no such connection for them
 */
export async function forgeAccess(db: ScopedClient, id: string, meetingId: string | null): Promise<ForgeAccess | null> {
  if (id === INSTANCE_CONNECTION) return null;
  const row = await db.forgeConnection.findFirst({ where: { id, OR: [{ meetingId: null }, ...(meetingId ? [{ meetingId }] : [])] } });
  if (!row) return null;
  const { token, grant } = parseGitlabSecret(decryptSecret(row.secret));
  if (!grant || !grantDue(grant)) return { id, kind: row.kind, url: row.url, token };
  try {
    // Requests of this server seeing it due share one renewal (GitLab takes each refresh token once)
    const renewed = await renewOnce(id, async () => {
      const next = await renewGrant(grant);
      await saveConnectionGrant(db, id, next);
      return next;
    });
    return { id, kind: row.kind, url: row.url, token: renewed.access };
  } catch (e) {
    // Renewed meanwhile by another server, whose save may come a moment later: the new grant then serves
    for (const wait of [0, 300, 900]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      const again = await db.forgeConnection.findFirst({ where: { id }, select: { secret: true } });
      const fresh = parseGitlabSecret(decryptSecret(again?.secret ?? "")).grant;
      if (fresh && !grantDue(fresh)) return { id, kind: row.kind, url: row.url, token: fresh.access };
    }
    throw e;
  }
}

/** The instance's access, or a connection's */
export async function accessOrInstance(
  db: ScopedClient,
  id: string,
  meetingId: string | null,
  kind: ForgeKind,
): Promise<ForgeAccess | null> {
  if (id !== INSTANCE_CONNECTION) return forgeAccess(db, id, meetingId);
  return instanceConnection(kind) ? { id, kind, url: defaultUrl(kind), token: instanceToken(kind) } : null;
}

type SourceOf<K extends ForgeKind> = K extends "gitlab" ? GitlabSource : GithubSource;

const blank = <K extends ForgeKind>(kind: K, connection: string): SourceOf<K> =>
  (kind === "gitlab" ? { connection, groups: "", projects: "" } : { connection, repos: "" }) as SourceOf<K>;

/**
 * The connections of a kind a meeting uses, with their filters: those its hosts picked, otherwise the
 * workspace's, otherwise the instance's
 */
export function usedSources<K extends ForgeKind>(
  kind: K,
  config: { picked: boolean; sources: SourceOf<K>[] },
  connections: ForgeConnectionView[],
): SourceOf<K>[] {
  const mine = connections.filter((c) => c.kind === kind);
  const known = new Set(mine.map((c) => c.id));
  if (config.picked) return config.sources.filter((s) => known.has(s.connection));
  const shared = mine.filter((c) => c.scope === "workspace");
  const defaults = shared.length ? shared : mine.filter((c) => c.scope === "instance");
  return defaults.map((c) => config.sources.find((s) => s.connection === c.id) ?? blank(kind, c.id));
}

/**
 * Where the connections a meeting uses come from, each once: inherited while its hosts picked nothing (the
 * workspace's, by usedSources), otherwise each one's scope
 */
export function forgeOrigins(forges: ForgeSettings, kind: ForgeKind): IntegrationOrigin[] {
  const scopes = [...new Set(forges[kind].sources.flatMap((u) => forges.connections.find((c) => c.id === u.connection)?.scope ?? []))];
  // Not picked: the workspace's connections, otherwise the instance's (usedSources)
  if (!forges[kind].picked) return scopes[0] === "workspace" ? ["inherited"] : scopes;
  return scopes;
}

/** A meeting's GitLab and GitHub: the connections it may use and those it uses */
export async function meetingForges(
  db: ScopedClient,
  meetingId: string,
  mods: { gitlab?: { config: unknown } | null; github?: { config: unknown } | null },
  withOAuth = true,
): Promise<ForgeSettings> {
  const connections = await listForgeConnections(db, meetingId, withOAuth);
  const gl = readConfig(gitlab, mods.gitlab?.config);
  const gh = readConfig(github, mods.github?.config);
  return {
    connections,
    servers: { gitlab: defaultUrl("gitlab"), github: defaultUrl("github") },
    gitlab: { picked: gl.picked, sources: usedSources("gitlab", gl, connections) },
    github: { picked: gh.picked, sources: usedSources("github", gh, connections) },
  };
}

/** The sources of a kind a meeting uses, each with its access; the module must be on */
export async function meetingSources<K extends ForgeKind>(
  db: ScopedClient,
  meetingId: string,
  kind: K,
): Promise<{ source: SourceOf<K>; access: ForgeAccess }[]> {
  const row = await db.moduleInstallation.findFirst({ where: { meetingId, moduleId: kind } });
  // GitLab is on until turned off; GitHub is off until turned on
  if (kind === "gitlab" ? row && !row.enabled : !row?.enabled) throw new AccessError(403, "moduleDisabled");
  const forges = await meetingForges(db, meetingId, { [kind]: row });
  const sources = forges[kind].sources as SourceOf<K>[];
  // A connection that cannot be read (a secret of another key, a renewal refused) leaves the others; its error is
  // only thrown when no connection is left
  const results = await Promise.allSettled(sources.map((source) => accessOrInstance(db, source.connection, meetingId, kind)));
  const out = results.flatMap((r, i) => (r.status === "fulfilled" && r.value ? [{ source: sources[i]!, access: r.value }] : []));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) console.error(`[${kind}] a connection could not be used`, failed.reason instanceof Error ? failed.reason.name : "");
  if (!out.length && failed) throw failed.reason;
  return out;
}

/** Adds a connection to those a meeting uses (its own, just added or connected) */
export async function useInMeeting(db: ScopedClient, workspaceId: string, meetingId: string, kind: ForgeKind, connection: string) {
  const row = await db.moduleInstallation.findFirst({ where: { meetingId, moduleId: kind } });
  const forges = await meetingForges(db, meetingId, { [kind]: row });
  const used: (GitlabSource | GithubSource)[] = forges[kind].sources;
  if (used.some((s) => s.connection === connection)) return;
  const config = { picked: true, sources: [...used, blank(kind, connection)] } as unknown as Prisma.InputJsonObject;
  await db.moduleInstallation.upsert({
    where: { meetingId_moduleId: { meetingId, moduleId: kind } },
    create: { workspaceId, meetingId, moduleId: kind, enabled: true, config },
    // GitHub is off until turned on: a connection added for it turns it on
    update: { config, ...(kind === "github" ? { enabled: true } : {}) },
  });
}

/**
 * The items read through each source, merged; a connection that fails leaves the others' items, and its error
 * is only thrown when every one failed
 */
export async function forgeItems<S extends { access: ForgeAccess }>(
  sources: S[],
  read: (source: S) => Promise<ForgeItem[]>,
): Promise<ForgeItem[]> {
  const results = await Promise.allSettled(sources.map(read));
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  if (sources.length && failed.length === sources.length) throw failed[0]!.reason;
  // Two servers may give the same ids: each item says through which connection it came. Two connections to one
  // server give the same item twice: its address keeps the first
  const seen = new Set<string>();
  return results.flatMap((r, i) =>
    r.status === "fulfilled"
      ? r.value
          .filter((item) => !item.url || (!seen.has(item.url) && !!seen.add(item.url)))
          .map((item) => ({ ...item, id: `${sources[i]!.access.id}:${item.id}` }))
      : [],
  );
}
