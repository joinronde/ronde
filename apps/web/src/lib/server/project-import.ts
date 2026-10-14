import type { TrackerKind } from "@ronde/editions/ee";
import "server-only";
import { Prisma, prisma, scoped } from "@ronde/db";
import { z } from "zod";
import { audit } from "./audit";
import type { WorkspaceContext } from "./authz";
import { AccessError, OpError } from "./errors";
import { isCloud } from "./license";
import { squareLogo } from "./project-logo";
import {
  completeForImport,
  datesGiven,
  isRepository,
  isWhatOf,
  listSource,
  mapLimit,
  type ProjectSource,
  projectSyncOn,
  type ReadFailure,
  readLogo,
  readSource,
  readSourceOf,
  SOURCE_KINDS,
  SOURCE_LIMIT,
  SOURCE_WHATS,
  type SourceAccess,
  SourceError,
  type SourceItem,
  type SourceKind,
  type SourceProblem,
  type SourceWhat,
  sourceKeyOf,
  TOKEN_FORMAT,
  TOOL_NAMES,
} from "./project-sources";
import { createProject, editableProject, visibleWhere } from "./projects";
import { trackerAccess, trackersOn } from "./trackers";

// Projects imported from GitHub, GitLab, Jira or Linear (every edition): the person picks the repositories,
// milestones, epics or projects to bring into the portfolio, read with a token that is not kept. Members read
// the public services (github.com, gitlab.com, Atlassian Cloud, Linear); another server, and the issue
// trackers saved in the workspace, are for its administrators. Read through a saved tracker (Team), projects
// stay in sync: the tool's name, status, dates and progress every hour (a repository only gives its name, and
// says when it is archived), the rest is Ronde's.

const WHATS = ["repos", "milestones", "epics", "projects"] as const;

/** Where to read: a saved tracker, or what the person typed (the token used for this request only) */
export const importSourceInput = z.union([
  z.object({ trackerId: z.string().min(1).max(50), what: z.enum(WHATS).optional() }),
  z.object({
    kind: z.enum(SOURCE_KINDS),
    /** What becomes a project: GitHub repositories or milestones, GitLab projects or milestones */
    what: z.enum(WHATS).optional(),
    /**
     * GitHub: the organization ("acme") or the repository ("acme/app"), or their address; GitLab: the group or
     * the project, or their address; Jira: the site's address
     */
    address: z.string().trim().max(300).default(""),
    /** Jira: the project's key */
    project: z.string().trim().max(40).default(""),
    /** Jira: the account the token belongs to */
    email: z.string().trim().max(200).default(""),
    token: z.string().trim().max(500).default(""),
  }),
]);
export type ImportSourceInput = z.input<typeof importSourceInput>;

/** What an import asks for besides where: the items picked, their theme, whether they stay in sync */
export const importPickInput = z.object({
  ids: z.array(z.string().max(300)).max(SOURCE_LIMIT),
  themeId: z.string().max(50).nullable().default(null),
  sync: z.boolean().default(false),
});

const NAME = /^[\w.-]+$/;

/** An address with or without its scheme ("gitlab.com/acme"); a bare name or path is not one */
function asUrl(v: string): URL | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(v) ? `https://${v}` : null;
  if (!withScheme) return null;
  try {
    const u = new URL(withScheme);
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch {
    return null;
  }
}

/** The public service's own address, whichever way it was written */
const canonical = (u: URL, service: string) => (u.hostname.replace(/^www\./, "") === service ? `https://${service}` : u.origin);

/** The organization, repository, group, project or site written in the dialog, as the source reads it */
export function configOf(
  kind: SourceKind,
  what: SourceWhat,
  input: { address: string; project: string; email: string },
): Record<string, string> | null {
  const address = input.address.trim();
  const u = asUrl(address);
  switch (kind) {
    case "github": {
      const [owner, repo] = (u ? u.pathname : address).split("/").filter(Boolean);
      const url = u ? canonical(u, "github.com") : "https://github.com";
      if (!owner || !NAME.test(owner)) return null;
      if (what === "repos") return { url, owner };
      return repo && NAME.test(repo.replace(/\.git$/, "")) ? { url, repo: `${owner}/${repo.replace(/\.git$/, "")}` } : null;
    }
    case "gitlab": {
      const path = (u ? u.pathname.split("/-/")[0]! : address).replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
      const url = u ? canonical(u, "gitlab.com") : "https://gitlab.com";
      if (!path || !path.split("/").every((p) => NAME.test(p))) return null;
      // A group may stand alone ("acme"); a project always sits in one ("acme/app")
      if (what === "projects") return { url, group: path };
      return path.includes("/") ? { url, project: path } : null;
    }
    case "jira": {
      const project = input.project.trim().toUpperCase();
      const email = input.email.trim();
      if (!u || !/^[A-Z][A-Z0-9_]{0,19}$/.test(project) || !z.string().email().safeParse(email).success) return null;
      // Atlassian Cloud only speaks https: the token never goes out in clear
      const site = /\.(atlassian\.net|jira\.com)$/.test(u.hostname) ? `https://${u.hostname}` : u.origin;
      return { site, project, email };
    }
    case "linear":
      return {};
  }
}

/** The server read, when it is not the public service everyone uses: only administrators point Ronde at one */
function ownServer(kind: SourceKind, config: Record<string, string>): string | null {
  const host = (url: string | undefined) => {
    try {
      return new URL(url ?? "").hostname;
    } catch {
      return "";
    }
  };
  switch (kind) {
    case "github":
      return config.url === "https://github.com" ? null : host(config.url);
    case "gitlab":
      return config.url === "https://gitlab.com" ? null : host(config.url);
    case "jira": {
      const h = host(config.site);
      return /\.(atlassian\.net|jira\.com)$/.test(h) ? null : h;
    }
    case "linear":
      return null;
  }
}

/**
 * A saved tracker's settings, as a source reads them: a GitHub tracker names a repository, whose organization
 * holds the other repositories; a GitLab tracker names a project, whose group holds the others
 */
function trackerConfig(kind: SourceKind, what: SourceWhat, config: Record<string, string>): Record<string, string> | null {
  switch (kind) {
    case "github": {
      const repo = config.repo ?? "";
      return what === "repos" ? { url: "https://github.com", owner: repo.split("/")[0] ?? "" } : { url: "https://github.com", repo };
    }
    case "gitlab": {
      const url = config.url || "https://gitlab.com";
      const project = config.project ?? "";
      if (what !== "projects") return { url, project };
      const group = project.split("/").slice(0, -1).join("/");
      return group ? { url, group } : null;
    }
    case "jira":
      return { site: config.site ?? "", project: config.project ?? "", email: config.email ?? "" };
    case "linear":
      return config.team ? { team: config.team } : {};
  }
}

/** The server and the account a tracker reads with now: the sync follows them, not those of the import */
function trackerAccount(kind: SourceKind, config: Record<string, string>): Record<string, string> {
  switch (kind) {
    case "github":
      return { url: "https://github.com" };
    case "gitlab":
      return { url: config.url || "https://gitlab.com" };
    case "jira":
      return { site: config.site ?? "", email: config.email ?? "" };
    case "linear":
      return {};
  }
}

const serverOf = (config: Record<string, string>) => (config.url ?? config.site ?? "").toLowerCase().replace(/\/+$/, "");

/** What was read, for the list's title and the audit log: the organization, repository, group or project */
const whereOf = (access: SourceAccess) => {
  const c = access.config;
  return c.owner ?? c.repo ?? c.group ?? c.project ?? "";
};

async function accessOf(ctx: WorkspaceContext, raw: ImportSourceInput): Promise<{ access: SourceAccess; trackerId: string | null }> {
  const input = importSourceInput.parse(raw);
  if ("trackerId" in input) {
    if (!trackersOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
    // A tracker's token was saved by an administrator, for this workspace's tickets: they decide what it reads
    if (!ctx.can("connectors.manage")) throw new AccessError(403, "accessDenied");
    const row = await ctx.db.issueTracker.findFirst({ where: { id: input.trackerId } });
    if (!row) throw new OpError("notFound");
    const kind = row.kind as SourceKind;
    const what = isWhatOf(kind, input.what) ? input.what : SOURCE_WHATS[kind][0];
    const tracker = await trackerAccess(ctx.db, row);
    const config = trackerConfig(kind, what, tracker.config);
    if (!config) throw new OpError("sourceAddressInvalid", { tool: TOOL_NAMES[kind] });
    return { access: { kind, what, config, token: tracker.token }, trackerId: row.id };
  }
  if (!TOKEN_FORMAT.test(input.token)) throw new OpError("tokenInvalid");
  const what = isWhatOf(input.kind, input.what) ? input.what : SOURCE_WHATS[input.kind][0];
  const config = configOf(input.kind, what, input);
  if (!config) throw new OpError("sourceAddressInvalid", { tool: TOOL_NAMES[input.kind] });
  const server = ownServer(input.kind, config);
  if (server && !ctx.can("connectors.manage")) throw new AccessError(403, "sourceServerAdminOnly", { host: server });
  // In the cloud a token only travels encrypted
  if (server && isCloud() && serverOf(config).startsWith("http:"))
    throw new OpError("sourceAddressInvalid", { tool: TOOL_NAMES[input.kind] });
  // GitHub and GitLab show their public repositories to anyone; Jira and Linear always ask who is reading
  if (!input.token && (input.kind === "jira" || input.kind === "linear"))
    throw new OpError("sourceTokenRequired", { tool: TOOL_NAMES[input.kind] });
  return { access: { kind: input.kind, what, config, token: input.token }, trackerId: null };
}

/** What a log may say of an error: never its message, which may carry a header (a token) */
const errorName = (e: unknown) => (e instanceof SourceError ? `SourceError ${e.code}` : e instanceof Error ? e.name : typeof e);

const PROBLEM_KEYS = {
  refused: "sourceRefused",
  notFound: "sourceNotFound",
  failed: "sourceFailed",
  rateLimited: "sourceRateLimited",
} as const;

/** The tool's refusal, in the person's words */
function failure(access: SourceAccess, trackerId: string | null, e: unknown): never {
  const tool = TOOL_NAMES[access.kind];
  if (e instanceof SourceError) {
    // A saved tracker's token is not the person's: say whose it is
    const key = e.code === "refused" && trackerId ? "sourceRefusedTracker" : PROBLEM_KEYS[e.code];
    throw new OpError(key, { tool, status: e.status });
  }
  if (e instanceof OpError || e instanceof AccessError) throw e;
  console.error(`[projects] reading ${access.kind} failed`, errorName(e));
  throw new OpError("sourceFailed", { tool, status: 0 });
}

/** What the items already became in the portfolio: their page when the person may see it */
async function importedOf(ctx: WorkspaceContext, keys: string[]): Promise<Map<string, { slug: string | null }>> {
  if (!keys.length) return new Map();
  const rows = await ctx.db.project.findMany({ where: { sourceKey: { in: keys } }, select: { id: true, slug: true, sourceKey: true } });
  const visible = new Set(
    (
      await ctx.db.project.findMany({ where: { AND: [visibleWhere(ctx), { id: { in: rows.map((r) => r.id) } }] }, select: { id: true } })
    ).map((r) => r.id),
  );
  return new Map(rows.map((r) => [r.sourceKey!, { slug: visible.has(r.id) ? r.slug : null }]));
}

export interface ImportCandidate {
  id: string;
  key: string;
  name: string;
  summary: string;
  status: SourceItem["status"];
  startDate: string | null;
  targetDate: string | null;
  progress: number | null;
  /** Already in the portfolio (its page, when the person may see it) */
  imported: { slug: string | null } | null;
}

/** What the source holds, for the person to pick from */
export async function previewImport(
  ctx: WorkspaceContext,
  raw: ImportSourceInput,
): Promise<{
  kind: SourceKind;
  what: SourceWhat;
  where: string;
  items: ImportCandidate[];
  more: boolean;
  sync: boolean;
  /** Why the list may not hold everything: read with a tracker's token, or without a token (public only) */
  partial: "tracker" | "public" | null;
}> {
  if (!ctx.can("projects.create")) throw new AccessError(403, "accessDenied");
  const { access, trackerId } = await accessOf(ctx, raw);
  let listed: { items: SourceItem[]; more: boolean };
  try {
    listed = await listSource(access);
  } catch (e) {
    failure(access, trackerId, e);
  }
  const imported = await importedOf(
    ctx,
    listed.items.map((i) => sourceKeyOf(access.kind, i.id)),
  );
  return {
    kind: access.kind,
    what: access.what,
    where: whereOf(access),
    items: listed.items.map((i) => ({
      id: i.id,
      key: i.key,
      name: i.name,
      summary: i.summary,
      status: i.status,
      startDate: i.startDate,
      targetDate: i.targetDate,
      progress: i.progress,
      imported: imported.get(sourceKeyOf(access.kind, i.id)) ?? null,
    })),
    more: listed.more,
    sync: !!trackerId && projectSyncOn(ctx.workspace),
    // Listing repositories or projects without a token only finds the public ones
    partial: trackerId ? "tracker" : isRepository(access.kind, access.what) && !access.token ? "public" : null,
  };
}

/** People of the directory, by address */
async function peopleByEmail(ctx: WorkspaceContext, emails: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(emails.filter(Boolean).map((e) => e.toLowerCase()))];
  if (!wanted.length) return new Map();
  const rows = await ctx.db.person.findMany({
    where: { email: { in: wanted, mode: "insensitive" }, active: true, deprovisionedAt: null },
    select: { id: true, email: true },
  });
  return new Map(rows.map((r) => [r.email.toLowerCase(), r.id]));
}

/** Its dates, the start dropped when it comes after the target (Ronde keeps them in order) */
const ordered = (startDate: string | null, targetDate: string | null) => ({
  startDate: startDate && targetDate && targetDate < startDate ? null : startDate,
  targetDate,
});

const json = (s: ProjectSource) => s as unknown as Prisma.InputJsonObject;

/** Creates the picked items as projects; those already in the portfolio are left as they are */
export async function importProjects(
  ctx: WorkspaceContext,
  raw: ImportSourceInput,
  pick: z.input<typeof importPickInput>,
): Promise<{ created: { id: string; slug: string; finished: boolean }[]; failed: number }> {
  if (!ctx.can("projects.create")) throw new AccessError(403, "accessDenied");
  const { ids, themeId, sync: wantSync } = importPickInput.parse(pick);
  const { access, trackerId } = await accessOf(ctx, raw);
  const wanted = new Set(ids);
  let items: SourceItem[];
  try {
    // Read again: the tool says what each one is, not the browser
    const picked = (await listSource(access)).items.filter((i) => wanted.has(i.id));
    const already = await importedOf(
      ctx,
      picked.map((i) => sourceKeyOf(access.kind, i.id)),
    );
    items = await completeForImport(
      access,
      picked.filter((i) => !already.has(sourceKeyOf(access.kind, i.id))),
    );
  } catch (e) {
    failure(access, trackerId, e);
  }
  const people = await peopleByEmail(
    ctx,
    items.flatMap((i) => [i.leadEmail ?? "", ...i.memberEmails]),
  );
  const sync = wantSync && !!trackerId && projectSyncOn(ctx.workspace);
  const now = new Date();
  const slugs = new Set((await ctx.db.project.findMany({ select: { slug: true } })).map((p) => p.slug));
  const count = { n: await ctx.db.project.count() };
  const created: { id: string; slug: string; finished: boolean }[] = [];
  const logos: { projectId: string; logo: NonNullable<SourceItem["logo"]> }[] = [];
  let failed = 0;
  try {
    for (const i of items) {
      const name = (i.name.trim() || i.key.trim()).slice(0, 100);
      if (!name) {
        failed++;
        continue;
      }
      const source: ProjectSource = {
        kind: access.kind,
        what: access.what,
        id: i.id,
        ref: i.ref,
        key: i.key,
        url: i.url,
        config: access.config,
        progress: i.progress,
        done: i.done,
        total: i.total,
        importedAt: now.toISOString(),
        problem: null,
      };
      const make = () =>
        createProject(
          ctx,
          {
            name,
            summary: i.summary.slice(0, 200),
            description: i.description,
            status: i.status ?? "active",
            ...ordered(i.startDate, i.targetDate),
            themeId,
            leadId: (i.leadEmail && people.get(i.leadEmail.toLowerCase())) || null,
            memberIds: i.memberEmails.map((e) => people.get(e.toLowerCase())).filter((id): id is string => !!id),
          },
          {
            from: {
              source: json(source),
              sourceKey: sourceKeyOf(access.kind, i.id),
              sourceTrackerId: sync ? trackerId : null,
              syncedAt: sync ? now : null,
            },
            slugs,
            count,
          },
        );
      const done = (project: { id: string; slug: string }) => {
        created.push({ ...project, finished: i.status === "done" || i.status === "cancelled" });
        if (i.logo) logos.push({ projectId: project.id, logo: i.logo });
      };
      try {
        done(await make());
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          // Imported meanwhile (another tab, another person): it is in the portfolio already
          if (await ctx.db.project.findFirst({ where: { sourceKey: sourceKeyOf(access.kind, i.id) }, select: { id: true } })) continue;
          // Its address was taken meanwhile by another project: once more, with the slugs as they are now
          for (const p of await ctx.db.project.findMany({ select: { slug: true } })) slugs.add(p.slug);
          try {
            done(await make());
            continue;
          } catch {
            // Counted as failed below
          }
        }
        if (e instanceof AccessError) throw e;
        failed++;
        if (!(e instanceof OpError)) console.error("[projects] importing an item failed", errorName(e));
      }
    }
    // Their logos from the tool, each image read once (an organization's avatar is every repository's)
    const images = new Map<string, Promise<Awaited<ReturnType<typeof squareLogo>>>>();
    await mapLimit(logos, 4, async ({ projectId, logo }) => {
      let image = images.get(logo.url);
      if (!image) {
        image = readLogo(access, logo).then((bytes) => (bytes ? squareLogo(bytes) : null));
        images.set(logo.url, image);
      }
      const square = await image;
      if (square)
        await ctx.db.projectLogo
          .create({ data: { projectId, workspaceId: ctx.workspace.id, ...square } })
          .catch(() => console.error("[projects] saving an imported logo failed"));
    });
  } finally {
    await audit(ctx, ctx.db, {
      action: "projects.import",
      targetType: "project",
      targetId: null,
      data: {
        kind: access.kind,
        what: access.what,
        server: serverOf(access.config) || null,
        where: whereOf(access),
        sync,
        projects: created.map((c) => c.id),
        failed,
      },
    });
  }
  return { created, failed };
}

// Keeping imported projects in sync (Team): every hour, the projects of each tracker read again, a few trackers
// at a time; each write only lands while the project still follows that tracker ("Stop syncing" wins).

/** A project is read again after this long */
const DUE_MS = 50 * 60_000;
/** One the tool no longer finds is tried again once a day: it may have come back, or the token's access */
const GONE_RETRY_MS = 24 * 3_600_000;
/** The hourly run stops starting trackers after this long, within the 15 minutes the job queue gives a job */
const RUN_BUDGET_MS = 12 * 60_000;
/** Projects of one tracker read in one run */
const PER_TRACKER = 200;

type SyncedRow = {
  id: string;
  name: string;
  startDate: string | null;
  targetDate: string | null;
  source: ProjectSource;
};

/** The tool's latest word on a project: only what the tool gives replaces Ronde's */
function synced(row: SyncedRow, item: SourceItem | null, now: Date) {
  const s = row.source;
  if (!item) return { source: json({ ...s, problem: "gone" }), syncedAt: now };
  const given = datesGiven(s.kind, s.what);
  const dates = ordered(
    given.start && item.startDate ? item.startDate : row.startDate,
    given.target && item.targetDate ? item.targetDate : row.targetDate,
  );
  // Counting the issues failed this time: the last count stays
  const counts = item.counted === false ? { done: s.done, total: s.total, progress: s.progress } : item;
  return {
    name: (item.name.trim() || row.name).slice(0, 100),
    ...(item.status ? { status: item.status } : {}),
    ...dates,
    source: json({
      ...s,
      key: item.key || s.key,
      url: item.url || s.url,
      progress: counts.progress,
      done: counts.done,
      total: counts.total,
      problem: null,
    }),
    syncedAt: now,
  };
}

/** Reads again some projects of one tracker, read from the same place; returns how many were read */
async function syncGroup(
  db: ReturnType<typeof scoped>,
  tracker: { id: string; kind: TrackerKind; config: unknown; secret: string; connectionId: string | null },
  rows: SyncedRow[],
): Promise<number> {
  const first = rows[0]!.source;
  const kind = tracker.kind as SourceKind;
  const now = new Date();
  // Each write lands only while the project still follows this tracker; one failing leaves the others
  const write = async (id: string, data: Prisma.ProjectUncheckedUpdateManyInput) => {
    try {
      await db.project.updateMany({ where: { id, sourceTrackerId: tracker.id }, data });
    } catch (e) {
      console.error("[projects] saving a synced project failed", errorName(e));
    }
  };
  // What went wrong this time; one the tool no longer found stays so (tried again once a day)
  const problemOf = (r: SyncedRow, problem: SourceProblem) => (r.source.problem === "gone" ? "gone" : problem);
  const note = async (problem: SourceProblem) => {
    for (const r of rows) await write(r.id, { source: json({ ...r.source, problem: problemOf(r, problem) }), syncedAt: now });
  };
  // Its connection removed or refused: noted, the projects keep following it until it works again
  const access = await trackerAccess(db, tracker).catch(() => null);
  if (!access) {
    await note("refused");
    return 0;
  }
  // The server and account the tracker reads with now, where the projects were imported from
  const config = { ...first.config, ...trackerAccount(kind, access.config) };
  if (serverOf(config) !== serverOf(first.config)) {
    // The tracker now points at another server: these projects belong to the old one, they stop following it
    for (const r of rows) await write(r.id, { sourceTrackerId: null, source: json({ ...r.source, stopped: "moved", problem: null }) });
    return 0;
  }
  let read: Map<string, SourceItem | null | ReadFailure>;
  try {
    read = await readSource(
      { kind, what: first.what, config, token: access.token },
      rows.map((r) => r.source.ref),
    );
  } catch (e) {
    if (!(e instanceof SourceError)) console.error("[projects] sync failed", errorName(e));
    await note(e instanceof SourceError ? e.code : "failed");
    return 0;
  }
  for (const r of rows) {
    const item = read.get(r.source.ref) ?? null;
    // Not read this time (one item's failure): noted on it, the others go on
    if (item && "failed" in item) await write(r.id, { source: json({ ...r.source, problem: problemOf(r, item.failed) }), syncedAt: now });
    else await write(r.id, synced(r, item, now));
  }
  return rows.length;
}

/** The projects of one tracker that are due (or the one asked for), read again from their tool */
async function syncTracker(db: ReturnType<typeof scoped>, trackerId: string, only?: string, deadline = Infinity): Promise<number> {
  const tracker = await db.issueTracker.findFirst({ where: { id: trackerId } });
  if (!tracker) return 0;
  const now = Date.now();
  const rows = await db.project.findMany({
    where: {
      sourceTrackerId: trackerId,
      archivedAt: null,
      ...(only
        ? { id: only }
        : {
            OR: [{ syncedAt: null }, { syncedAt: { lt: new Date(now - DUE_MS) } }],
            // One the tool no longer found waits a day before it is tried again
            NOT: { AND: [{ source: { path: ["problem"], equals: "gone" } }, { syncedAt: { gt: new Date(now - GONE_RETRY_MS) } }] },
          }),
    },
    orderBy: { syncedAt: { sort: "asc", nulls: "first" } },
    take: PER_TRACKER,
    select: { id: true, name: true, startDate: true, targetDate: true, source: true, syncedAt: true },
  });
  const due: SyncedRow[] = [];
  for (const r of rows) {
    const source = readSourceOf(r.source);
    if (!source) continue;
    if (!only && source.problem === "gone" && r.syncedAt && now - r.syncedAt.getTime() < GONE_RETRY_MS) continue;
    due.push({ ...r, source });
  }
  // Grouped by what and where they were read: a tracker's projects may be repositories and milestones, from
  // several repositories over time
  const groups = new Map<string, SyncedRow[]>();
  for (const r of due) {
    const k = JSON.stringify([r.source.what, r.source.config]);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  let read = 0;
  for (const group of groups.values()) {
    if (Date.now() > deadline) break;
    read += await syncGroup(db, tracker, group);
  }
  return read;
}

/** Every hour: the synced projects of the live workspaces on Team follow their tool */
export async function syncProjects(): Promise<number> {
  const started = Date.now();
  const trackers = await prisma.project.findMany({
    where: { sourceTrackerId: { not: null }, archivedAt: null, workspace: { deletedAt: null, suspendedAt: null } },
    distinct: ["workspaceId", "sourceTrackerId"],
    select: { workspaceId: true, sourceTrackerId: true, workspace: { select: { plan: true } } },
  });
  // In another order each time: when the run's time is up, not always the same trackers wait
  const due = trackers.filter((t) => projectSyncOn(t.workspace)).sort(() => Math.random() - 0.5);
  let read = 0;
  await mapLimit(due, 4, async (t) => {
    if (Date.now() - started > RUN_BUDGET_MS) return;
    try {
      const n = await syncTracker(scoped(prisma, t.workspaceId), t.sourceTrackerId!, undefined, started + RUN_BUDGET_MS);
      read += n;
    } catch (e) {
      // One tracker failing leaves the others to their sync
      console.error("[projects] syncing a tracker failed", errorName(e));
    }
  });
  return read;
}

/** "Update now" on a synced project's page: what went wrong, if anything, shows on the page */
export async function syncProject(ctx: WorkspaceContext, id: string): Promise<void> {
  if (!projectSyncOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
  const p = await editableProject(ctx, id);
  const row = await ctx.db.project.findFirst({ where: { id: p.id }, select: { sourceTrackerId: true } });
  if (!row?.sourceTrackerId) throw new OpError("notFound");
  await syncTracker(ctx.db, row.sourceTrackerId, p.id);
}

/** Stops following the tool, for good: the project stays as it is, edited in Ronde from then on */
export async function unlinkSource(ctx: WorkspaceContext, id: string): Promise<void> {
  const p = await editableProject(ctx, id);
  const row = await ctx.db.project.findFirst({ where: { id: p.id }, select: { source: true, sourceTrackerId: true } });
  const source = readSourceOf(row?.source);
  if (!source || !row?.sourceTrackerId) return;
  await ctx.db.project.update({
    where: { id: p.id },
    data: { sourceTrackerId: null, source: json({ ...source, stopped: "unlinked", problem: null }) },
  });
}
