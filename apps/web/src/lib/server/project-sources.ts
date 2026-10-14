import "server-only";
import type { ProjectStatus } from "@ronde/core/types";
import { isRepository, isWhatOf, SOURCE_KINDS, SOURCE_WHATS, type SourceKind, type SourceWhat } from "@/lib/shared/project-sources";
import { featureOn, type PlanScope } from "./license";
import { outboundFetch } from "./outbound";

// Where projects come from: the repositories of a GitHub organization or the projects of a GitLab group (or
// the milestones of one of them), the epics of a Jira project, the projects of Linear. Reading them is in
// every edition (an import, with a token that is not kept); keeping them in sync goes through a saved issue
// tracker (Team, project-import.ts). What the tools answer is bounded and checked: a list is cut to
// SOURCE_LIMIT items, a body to MAX_BODY bytes, a link kept only when it leads to the tool itself.

export { isRepository, isWhatOf, SOURCE_KINDS, SOURCE_WHATS, type SourceKind, type SourceWhat } from "@/lib/shared/project-sources";

export const projectSyncOn = (ws: PlanScope) => featureOn("integrations.projectSync", ws);

export const TOOL_NAMES: Record<SourceKind, string> = { github: "GitHub", gitlab: "GitLab", jira: "Jira", linear: "Linear" };

/**
 * A token as the tools give them: printable, no spaces but after "Bearer" (anything else would end up in a request
 * header, and its error in a log)
 */
export const TOKEN_FORMAT = /^(Bearer )?[\x21-\x7e]*$/;

export type SourceProblem = "refused" | "notFound" | "failed" | "rateLimited" | "gone";

/** What a project keeps of where it comes from (its key, tracker and last reading are columns of Project) */
export interface ProjectSource {
  kind: SourceKind;
  what: SourceWhat;
  id: string;
  ref: string;
  key: string;
  url: string;
  /** Where it was read (no secret): the repository, group or project read again by the sync */
  config: Record<string, string>;
  progress: number | null;
  done: number | null;
  total: number | null;
  importedAt: string;
  /** Why the last sync did not go through; "gone": the tool no longer finds it (tried again once a day) */
  problem: SourceProblem | null;
  /** Why it is no longer synced, once it is not */
  stopped?: "unlinked" | "trackerRemoved" | "moved";
}

export const readSourceOf = (raw: unknown): ProjectSource | null => {
  if (!raw || typeof raw !== "object" || !("kind" in raw) || !("id" in raw)) return null;
  const s = raw as ProjectSource;
  if (!SOURCE_KINDS.includes(s.kind)) return null;
  return isWhatOf(s.kind, s.what) ? s : { ...s, what: SOURCE_WHATS[s.kind][0] };
};

/** What an import is recognised by in the workspace */
export const sourceKeyOf = (kind: SourceKind, id: string) => `${kind}:${id}`;

/** How long a progress read from the tool is shown as current */
const FRESH_MS = 3 * 86_400_000;

/** The tool's progress while it is current: synced, read in the last days, still found */
export function liveProgress(p: { source: unknown; sourceTrackerId: string | null; syncedAt: Date | null }): number | null {
  const s = readSourceOf(p.source);
  return s && p.sourceTrackerId && s.problem !== "gone" && p.syncedAt && Date.now() - p.syncedAt.getTime() < FRESH_MS ? s.progress : null;
}

/** Which dates a tool gives: GitHub milestones and Jira epics have a due date only, repositories none */
export function datesGiven(kind: SourceKind, what: SourceWhat): { start: boolean; target: boolean } {
  if (isRepository(kind, what)) return { start: false, target: false };
  return kind === "gitlab" || kind === "linear" ? { start: true, target: true } : { start: false, target: true };
}

/** How a source is read: what, where (no secret in it, kept with what was imported) and the token */
export interface SourceAccess {
  kind: SourceKind;
  what: SourceWhat;
  config: Record<string, string>;
  token: string;
  fetch?: typeof fetch;
}

/** A repository, a milestone, an epic or a project of the tool, as a project of the portfolio */
export interface SourceItem {
  /** Unique for this kind of tool, whichever repository or site it is in: what an import is recognised by */
  id: string;
  /** Its id where it lives, to read it again */
  ref: string;
  /** How the tool names it: "acme/app", "v2.0", "ENG-12" */
  key: string;
  name: string;
  summary: string;
  /** Markdown */
  description: string;
  /** null: the tool does not say (a repository that is not archived); Ronde's own status stays */
  status: ProjectStatus | null;
  startDate: string | null;
  targetDate: string | null;
  /** Its page in the tool; empty when the tool gave an address elsewhere */
  url: string;
  /** Issues closed and in all, when the tool counts them */
  done: number | null;
  total: number | null;
  /** From 0 to 1 */
  progress: number | null;
  /** false: counting its issues failed this time (the last count stays) */
  counted?: boolean;
  leadEmail: string | null;
  memberEmails: string[];
  /** Its image in the tool, made the project's logo at the import; auth: on the tool's own server, read with the token */
  logo: { url: string; auth: boolean } | null;
}

export class SourceError extends Error {
  constructor(
    public code: "refused" | "notFound" | "failed" | "rateLimited",
    public status = 0,
  ) {
    super(`${code}${status ? ` (${status})` : ""}`);
  }
}

/** At most this many items are read at once */
export const SOURCE_LIMIT = 100;
/** Requests to one tool at the same time */
const CONCURRENCY = 5;
/** Largest answer read from a tool */
const MAX_BODY = 5_000_000;

/** Runs fn over the items, a few at a time; the first failure stops the rest from starting */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failure: { error: unknown } | null = null;
  const worker = async () => {
    while (next < items.length && !failure) {
      const i = next++;
      try {
        out[i] = await fn(items[i]!);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failure) throw (failure as { error: unknown }).error;
  return out;
}

const trim = (url: string) => url.trim().replace(/\/+$/, "");
/** A text from the tool, bounded, without the NUL characters Postgres refuses */
const str = (v: unknown, max: number) => (typeof v === "string" ? v : v == null ? "" : String(v)).replace(/\u0000/g, "").slice(0, max);
const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
const ratio = (done: number | null, total: number | null) => (done !== null && total ? Math.min(1, done / total) : null);
const lastSegment = (path: string) => path.split("/").filter(Boolean).at(-1) ?? path;
const hostOf = (base: string) => {
  try {
    return new URL(base).hostname;
  } catch {
    return "";
  }
};
const listOf = (v: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(v)) throw new SourceError("failed");
  return v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
};

/** A link from the tool, kept only when it leads where the tool lives */
function safeUrl(url: unknown, host: string): string {
  try {
    const u = new URL(String(url));
    return /^https?:$/.test(u.protocol) && u.hostname === host ? u.href.slice(0, 500) : "";
  } catch {
    return "";
  }
}

/**
 * The tool's description is the project's description; its first line, its one-line summary (cut at a word
 * past 200 characters). Extra lines (a repository's website and topics) go after it.
 */
export function splitDescription(text: string, extra: string[] = []): { summary: string; description: string } {
  const clean = text.replace(/\r\n/g, "\n").trim();
  const first = (clean.split("\n").find((l) => l.trim()) ?? "").replace(/^#+\s*/, "").trim();
  const summary = first.length <= 200 ? first : `${first.slice(0, 199).replace(/\s+\S*$/, "")}…`;
  const description = [clean, ...extra].filter(Boolean).join("\n\n").slice(0, 20_000);
  return { summary, description };
}

/** A repository's website and topics, as lines of its description */
function repoExtras(homepage: unknown, topics: unknown): string[] {
  const out: string[] = [];
  const site = safeUrl(
    homepage,
    (() => {
      try {
        return new URL(String(homepage)).hostname;
      } catch {
        return "";
      }
    })(),
  );
  if (site) out.push(`🌐 ${site}`);
  const list = Array.isArray(topics)
    ? topics.filter((x): x is string => typeof x === "string" && /^[\w.+-]{1,50}$/.test(x)).slice(0, 12)
    : [];
  if (list.length) out.push(list.map((x) => `\`${x}\``).join(" · "));
  return out;
}

/** A milestone is named after its repository too: "v2.0" alone says nothing in a portfolio */
export function milestoneName(repo: string, title: string): string {
  const name = lastSegment(repo);
  return (title.toLowerCase().includes(name.toLowerCase()) ? title : `${name} · ${title}`).slice(0, 100);
}

/** The answer's body, at most MAX_BODY bytes, as JSON */
async function readBody(res: Response): Promise<unknown> {
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new SourceError("failed", res.status);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new SourceError("failed", res.status);
  }
}

function linearError(body: unknown): SourceError | null {
  const first = (body as { errors?: { message?: string; extensions?: { code?: string } }[] } | null)?.errors?.[0];
  if (!first) return null;
  const code = `${first.extensions?.code ?? ""} ${first.message ?? ""}`;
  if (/AUTH|FORBIDDEN/i.test(code)) return new SourceError("refused");
  if (/RATELIMIT/i.test(code)) return new SourceError("rateLimited");
  if (/NOT_FOUND|ENTITY/i.test(code)) return new SourceError("notFound");
  return new SourceError("failed");
}

async function call(t: SourceAccess, url: string, init: RequestInit & { json?: unknown } = {}): Promise<unknown> {
  const { json, ...rest } = init;
  let target = url;
  for (let hop = 0; ; hop++) {
    const res = await (t.fetch ?? outboundFetch)(target, {
      ...rest,
      // A redirect is followed by hand, within the same tool only: the token never goes anywhere else
      redirect: "manual",
      headers: { accept: "application/json", ...(json ? { "content-type": "application/json" } : {}), ...auth(t) },
      ...(json ? { body: JSON.stringify(json) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    // An answer not read is let go of, so its connection is
    const release = () => res.body?.cancel().catch(() => {});
    const drop = (error: SourceError) => {
      release();
      return error;
    };
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      const next = location ? new URL(location, target) : null;
      // A request with a body only follows the redirects that keep it (307, 308)
      const keepsBody = !json || res.status === 307 || res.status === 308;
      if (!next || next.origin !== new URL(target).origin || hop >= 3 || !keepsBody) throw drop(new SourceError("failed", res.status));
      release();
      target = next.href;
      continue;
    }
    if (res.status === 429 || (res.status === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after"))))
      throw drop(new SourceError("rateLimited", res.status));
    if (res.status === 401 || res.status === 403) throw drop(new SourceError("refused", res.status));
    // Jira answers 400 to a search naming a project it does not know, or one the account cannot see
    if (res.status === 404 || (res.status === 400 && t.kind === "jira")) throw drop(new SourceError("notFound", res.status));
    if (res.status === 400 && t.kind === "linear")
      throw linearError(await readBody(res).catch(() => null)) ?? new SourceError("failed", 400);
    if (!res.ok) throw drop(new SourceError("failed", res.status));
    return readBody(res);
  }
}

function auth(t: SourceAccess): Record<string, string> {
  if (!t.token) return {};
  switch (t.kind) {
    case "github":
      return { authorization: `Bearer ${t.token}`, "x-github-api-version": "2022-11-28" };
    case "gitlab":
      // A personal token as well as an OAuth access token
      return { authorization: `Bearer ${t.token}` };
    case "linear":
      return { authorization: t.token };
    case "jira":
      return { authorization: `Basic ${Buffer.from(`${t.config.email ?? ""}:${t.token}`).toString("base64")}` };
  }
}

const item = (fields: Partial<SourceItem> & Pick<SourceItem, "id" | "ref" | "key" | "name" | "url">): SourceItem => ({
  summary: "",
  description: "",
  status: null,
  startDate: null,
  targetDate: null,
  done: null,
  total: null,
  progress: null,
  leadEmail: null,
  memberEmails: [],
  logo: null,
  ...fields,
});

/** A logo read with the token: only at the tool's own address (scheme and port included), never elsewhere */
function tokenLogo(url: string | null, base: string): { url: string; auth: boolean } | null {
  try {
    return url && new URL(url).origin === new URL(base).origin ? { url, auth: true } : null;
  } catch {
    return null;
  }
}

/** An image address, kept when it is on one of these hosts, at the size asked for */
function imageAt(url: unknown, hosts: string[], size?: [string, string]): string | null {
  const safe = hosts.map((h) => safeUrl(url, h)).find(Boolean);
  if (!safe) return null;
  const u = new URL(safe);
  if (size) u.searchParams.set(size[0], size[1]);
  return u.href;
}

/** The bytes of a logo from the tool (at most 2 MB), or null: a logo is never worth failing an import */
export async function readLogo(t: SourceAccess, logo: { url: string; auth: boolean }): Promise<Uint8Array | null> {
  try {
    const res = await (t.fetch ?? outboundFetch)(logo.url, {
      headers: logo.auth ? auth(t) : {},
      // With the token, no redirect is followed: it never goes anywhere else
      redirect: logo.auth ? "manual" : "follow",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      return null;
    }
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return new Uint8Array(Buffer.concat(chunks));
  } catch {
    return null;
  }
}

// GitHub: the repositories of an organization (or a person's account), or the milestones of one repository.
// GitHub Enterprise Server: its API under /api/v3.

const githubHost = (t: SourceAccess) => trim(t.config.url || "https://github.com");
const githubApi = (t: SourceAccess) => {
  const base = githubHost(t);
  return /^https:\/\/github\.com$/i.test(base) ? "https://api.github.com" : `${base}/api/v3`;
};

/** Where GitHub keeps avatars: its own host for GitHub Enterprise Server */
const avatarHosts = (t: SourceAccess) => {
  const host = hostOf(githubHost(t));
  return host === "github.com" ? ["avatars.githubusercontent.com"] : [host];
};

function fromGithubRepo(t: SourceAccess, r: Record<string, unknown>): SourceItem {
  const avatar = imageAt((r.owner as { avatar_url?: unknown } | undefined)?.avatar_url, avatarHosts(t), ["s", "256"]);
  return item({
    // A repository has no image of its own on GitHub: its organization's is its logo
    logo: avatar ? { url: avatar, auth: false } : null,
    id: `${githubHost(t).toLowerCase()}#repo:${count(r.id)}`,
    ref: String(count(r.id)),
    key: str(r.full_name, 200),
    name: str(r.name, 100),
    ...splitDescription(str(r.description, 20_000), repoExtras(r.homepage, r.topics)),
    status: r.archived === true ? "done" : null,
    url: safeUrl(r.html_url, hostOf(githubHost(t))),
  });
}

function fromGithubMilestone(t: SourceAccess, m: Record<string, unknown>): SourceItem {
  const done = count(m.closed_issues);
  const total = done === null ? null : done + (count(m.open_issues) ?? 0);
  const title = str(m.title, 200);
  return item({
    // Its global id: the same milestone after the repository is renamed or moved
    id: `${githubHost(t).toLowerCase()}#milestone:${count(m.id)}`,
    // Without its global id it could not be told apart: left out like any item without an id
    ref: count(m.id) === null ? "null" : String(count(m.number)),
    key: title,
    name: milestoneName(t.config.repo ?? "", title),
    ...splitDescription(str(m.description, 20_000)),
    status: m.state === "closed" ? "done" : "active",
    targetDate: day(m.due_on),
    url: safeUrl(m.html_url, hostOf(githubHost(t))),
    // The repository's organization's image (GitHub redirects to it)
    logo: /^[\w.-]+$/.test((t.config.repo ?? "").split("/")[0] ?? "")
      ? { url: `${githubHost(t)}/${(t.config.repo ?? "").split("/")[0]}.png?size=256`, auth: false }
      : null,
    done,
    total,
    progress: ratio(done, total),
  });
}

/**
 * An organization's repositories; when the name is not an organization's, a person's: all of them when the
 * token is theirs, their public ones otherwise
 */
async function githubRepos(t: SourceAccess): Promise<unknown> {
  const owner = t.config.owner ?? "";
  const query = `per_page=${SOURCE_LIMIT}&sort=pushed`;
  try {
    return await call(t, `${githubApi(t)}/orgs/${encodeURIComponent(owner)}/repos?type=all&${query}`);
  } catch (e) {
    if (!(e instanceof SourceError) || e.code !== "notFound") throw e;
  }
  if (t.token) {
    const me = (await call(t, `${githubApi(t)}/user`)) as { login?: unknown } | null;
    if (typeof me?.login === "string" && me.login.toLowerCase() === owner.toLowerCase())
      return call(t, `${githubApi(t)}/user/repos?affiliation=owner&visibility=all&${query}`);
  }
  return call(t, `${githubApi(t)}/users/${encodeURIComponent(owner)}/repos?type=owner&${query}`);
}

// GitLab: the projects of a group (its subgroups included), or the milestones of one project, their issues
// counted apart

const gitlabHost = (t: SourceAccess) => trim(t.config.url || "https://gitlab.com");
const gitlabProject = (t: SourceAccess) => `${gitlabHost(t)}/api/v4/projects/${encodeURIComponent(t.config.project ?? "")}`;

/** A GitLab project's image, or its group's; on the GitLab server, read with the token (it may be private) */
function gitlabLogo(t: SourceAccess, p: Record<string, unknown>): SourceItem["logo"] {
  const url =
    imageAt(p.avatar_url, [hostOf(gitlabHost(t))]) ??
    imageAt((p.namespace as { avatar_url?: unknown } | undefined)?.avatar_url, [hostOf(gitlabHost(t))]);
  return tokenLogo(url, gitlabHost(t));
}

function fromGitlabProject(t: SourceAccess, p: Record<string, unknown>): SourceItem {
  return item({
    logo: gitlabLogo(t, p),
    id: `${gitlabHost(t).toLowerCase()}#project:${count(p.id)}`,
    ref: String(count(p.id)),
    key: str(p.path_with_namespace, 200),
    name: str(p.name, 100),
    ...splitDescription(str(p.description, 20_000), repoExtras(null, p.topics ?? p.tag_list)),
    status: p.archived === true ? "done" : null,
    url: safeUrl(p.web_url, hostOf(gitlabHost(t))),
  });
}

function fromGitlabMilestone(t: SourceAccess, m: Record<string, unknown>): SourceItem {
  const title = str(m.title, 200);
  return item({
    id: `${gitlabHost(t).toLowerCase()}#${count(m.id)}`,
    ref: String(count(m.id)),
    key: title,
    name: milestoneName(t.config.project ?? "", title),
    ...splitDescription(str(m.description, 20_000)),
    status: m.state === "closed" ? "done" : "active",
    startDate: day(m.start_date),
    targetDate: day(m.due_date),
    url: safeUrl(m.web_url, hostOf(gitlabHost(t))),
  });
}

async function gitlabCounts(t: SourceAccess, i: SourceItem): Promise<SourceItem> {
  try {
    const r = (await call(t, `${gitlabProject(t)}/issues_statistics?milestone=${encodeURIComponent(i.key)}`)) as {
      statistics?: { counts?: { all?: unknown; closed?: unknown } };
    } | null;
    const total = count(r?.statistics?.counts?.all);
    const done = count(r?.statistics?.counts?.closed);
    return { ...i, done, total, progress: ratio(done, total) };
  } catch {
    return { ...i, counted: false };
  }
}

// Jira: the epics of a project, their child issues counted apart

const JIRA_STATUS: Record<string, ProjectStatus> = { new: "proposed", indeterminate: "active", done: "done" };
const JIRA_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

/** Jira descriptions are documents (ADF): back to Markdown, roughly */
export function adfToMarkdown(node: unknown, depth = 0): string {
  const n = node as {
    type?: string;
    text?: string;
    content?: unknown[];
    attrs?: { level?: number };
    marks?: { type: string; attrs?: { href?: string } }[];
  };
  if (!n || typeof n !== "object" || depth > 40) return "";
  const inner = (sep = "") => (n.content ?? []).map((c) => adfToMarkdown(c, depth + 1)).join(sep);
  switch (n.type) {
    case "text": {
      const link = n.marks?.find((m) => m.type === "link")?.attrs?.href;
      return link ? `[${n.text ?? ""}](${link})` : (n.text ?? "");
    }
    case "hardBreak":
      return "\n";
    case "paragraph":
      return inner();
    case "heading":
      return `${"#".repeat(Math.min(6, n.attrs?.level ?? 2))} ${inner()}`;
    case "bulletList":
      return (n.content ?? []).map((li) => `- ${adfToMarkdown(li, depth + 1)}`).join("\n");
    case "orderedList":
      return (n.content ?? []).map((li, i) => `${i + 1}. ${adfToMarkdown(li, depth + 1)}`).join("\n");
    case "listItem":
      return inner(" ");
    case "codeBlock":
      return `\`\`\`\n${inner()}\n\`\`\``;
    default:
      return inner("\n\n");
  }
}

const jiraSite = (t: SourceAccess) => trim(t.config.site ?? "");
/** The sync reads less than the import: the description stays as it was imported */
const JIRA_LIGHT = ["summary", "status", "duedate", "assignee"];
const JIRA_FIELDS = [...JIRA_LIGHT, "description"];

function fromJira(t: SourceAccess, i: Record<string, unknown>): SourceItem {
  const f = (i.fields ?? {}) as {
    summary?: unknown;
    description?: unknown;
    status?: { statusCategory?: { key?: string } };
    duedate?: unknown;
    assignee?: { emailAddress?: unknown } | null;
  };
  const key = str(i.key, 40);
  const id = count(Number(i.id));
  return item({
    id: `${jiraSite(t).toLowerCase()}#${id}`,
    ref: String(id),
    key,
    name: str(f.summary, 100) || key,
    ...splitDescription(adfToMarkdown(f.description).trim()),
    status: JIRA_STATUS[f.status?.statusCategory?.key ?? ""] ?? "active",
    targetDate: day(f.duedate),
    url: JIRA_KEY.test(key) ? `${jiraSite(t)}/browse/${key}` : "",
    leadEmail: typeof f.assignee?.emailAddress === "string" ? f.assignee.emailAddress : null,
  });
}

async function jiraCount(t: SourceAccess, jql: string): Promise<number | null> {
  const r = (await call(t, `${jiraSite(t)}/rest/api/3/search/approximate-count`, { method: "POST", json: { jql } })) as {
    count?: unknown;
  } | null;
  return count(r?.count);
}

async function jiraCounts(t: SourceAccess, i: SourceItem): Promise<SourceItem> {
  // The key came from the same site; checked anyway before it goes into a query
  if (!JIRA_KEY.test(i.key)) return { ...i, counted: false };
  try {
    const total = await jiraCount(t, `parent = ${i.key}`);
    const done = await jiraCount(t, `parent = ${i.key} AND statusCategory = Done`);
    return { ...i, done, total, progress: ratio(done, total) };
  } catch {
    return { ...i, counted: false };
  }
}

// Linear: the projects of the workspace, or of the team a saved tracker names. The list and the sync read
// the light fields; the import reads the document and the people of the projects picked.

const LINEAR_STATUS: Record<string, ProjectStatus> = {
  backlog: "proposed",
  planned: "proposed",
  started: "active",
  paused: "paused",
  completed: "done",
  canceled: "cancelled",
};

const LINEAR_LIGHT = "id name description url startDate targetDate progress status { type }";
const LINEAR_FULL = `${LINEAR_LIGHT} content lead { email } members(first: 50) { nodes { email } }`;

async function linear(t: SourceAccess, query: string, variables: Record<string, unknown> = {}) {
  const body = (await call(t, "https://api.linear.app/graphql", { method: "POST", json: { query, variables } })) as {
    data?: Record<string, unknown>;
  } | null;
  const error = linearError(body);
  if (error) throw error;
  return body?.data ?? {};
}

function fromLinear(p: Record<string, unknown>): SourceItem {
  const progress = typeof p.progress === "number" && Number.isFinite(p.progress) ? Math.min(1, Math.max(0, p.progress)) : null;
  const lead = p.lead as { email?: unknown } | null | undefined;
  const members = (p.members as { nodes?: { email?: unknown }[] } | null | undefined)?.nodes ?? [];
  const name = str(p.name, 100);
  return item({
    id: str(p.id, 100),
    ref: str(p.id, 100),
    key: name,
    name,
    summary: str(p.description, 200).trim(),
    description: str(p.content, 20_000).trim(),
    status: LINEAR_STATUS[(p.status as { type?: string } | null)?.type ?? ""] ?? "active",
    startDate: day(p.startDate),
    targetDate: day(p.targetDate),
    url: safeUrl(p.url, "linear.app"),
    progress,
    leadEmail: typeof lead?.email === "string" ? lead.email : null,
    memberEmails: members.map((m) => m.email).filter((e): e is string => typeof e === "string"),
  });
}

const nodesOf = (v: unknown) => listOf((v as { nodes?: unknown } | undefined)?.nodes ?? []).map(fromLinear);

/** Linear projects by id, in batches */
async function linearByIds(t: SourceAccess, ids: string[], fields: string): Promise<SourceItem[]> {
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += 50) batches.push(ids.slice(i, i + 50));
  const pages = await mapLimit(batches, 2, async (batch) =>
    nodesOf(
      (await linear(t, `query($ids: [ID!]) { projects(first: 50, filter: { id: { in: $ids } }) { nodes { ${fields} } } }`, { ids: batch }))
        .projects,
    ),
  );
  return pages.flat();
}

/** What the source holds, the most recent first (at most SOURCE_LIMIT), and whether it holds more */
export async function listSource(t: SourceAccess): Promise<{ items: SourceItem[]; more: boolean }> {
  let raw: Record<string, unknown>[];
  let items: SourceItem[];
  switch (t.kind) {
    case "github":
      if (t.what === "repos") {
        raw = listOf(await githubRepos(t));
        // A fork is somebody else's project
        items = raw.filter((r) => r.fork !== true).map((r) => fromGithubRepo(t, r));
      } else {
        raw = listOf(
          await call(t, `${githubApi(t)}/repos/${t.config.repo}/milestones?state=all&sort=due_on&direction=desc&per_page=${SOURCE_LIMIT}`),
        );
        items = raw.map((m) => fromGithubMilestone(t, m));
      }
      break;
    case "gitlab":
      if (t.what === "projects") {
        const group = encodeURIComponent(t.config.group ?? "");
        raw = listOf(
          await call(
            t,
            `${gitlabHost(t)}/api/v4/groups/${group}/projects?include_subgroups=true&order_by=last_activity_at&per_page=${SOURCE_LIMIT}`,
          ),
        );
        items = raw.map((p) => fromGitlabProject(t, p));
      } else {
        raw = listOf(await call(t, `${gitlabProject(t)}/milestones?per_page=${SOURCE_LIMIT}`));
        items = raw.map((m) => fromGitlabMilestone(t, m));
      }
      break;
    case "jira": {
      const r = (await call(t, `${jiraSite(t)}/rest/api/3/search/jql`, {
        method: "POST",
        json: {
          jql: `project = "${t.config.project}" AND issuetype = Epic ORDER BY created DESC`,
          maxResults: SOURCE_LIMIT,
          fields: JIRA_FIELDS,
        },
      })) as { issues?: unknown } | null;
      raw = listOf(r?.issues ?? []);
      items = raw.map((i) => fromJira(t, i));
      break;
    }
    case "linear": {
      // The team of a saved tracker, by its id or its key (ENG)
      const team = (t.config.team ?? "").trim();
      const projects = `projects(first: ${SOURCE_LIMIT}) { nodes { ${LINEAR_LIGHT} } }`;
      const data = !team
        ? (await linear(t, `query { ${projects} }`)).projects
        : /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(team)
          ? ((await linear(t, `query($id: String!) { team(id: $id) { ${projects} } }`, { id: team })) as { team?: { projects?: unknown } })
              .team?.projects
          : await (async () => {
              const found = (
                (await linear(t, `query($key: String!) { teams(filter: { key: { eqIgnoreCase: $key } }) { nodes { ${projects} } } }`, {
                  key: team,
                })) as { teams?: { nodes?: { projects?: unknown }[] } }
              ).teams?.nodes?.[0];
              // A key the account does not see: said, not an empty list
              if (!found) throw new SourceError("notFound");
              return found.projects;
            })();
      raw = listOf((data as { nodes?: unknown } | undefined)?.nodes ?? []);
      items = raw.map(fromLinear);
      break;
    }
  }
  // Each item once, with an id: what the tool sent twice or without one is left out
  const seen = new Set<string>();
  const unique = items.filter((i) => i.ref && i.ref !== "null" && !seen.has(i.id) && !!seen.add(i.id));
  return { items: unique.slice(0, SOURCE_LIMIT), more: raw.length >= SOURCE_LIMIT };
}

/** The image of the project the milestones or epics belong to, their logo; null when it has none or cannot be read */
async function parentLogo(t: SourceAccess): Promise<SourceItem["logo"]> {
  try {
    if (t.kind === "gitlab") {
      const p = (await call(t, gitlabProject(t))) as Record<string, unknown> | null;
      return p ? gitlabLogo(t, p) : null;
    }
    if (t.kind === "jira") {
      const p = (await call(t, `${jiraSite(t)}/rest/api/3/project/${encodeURIComponent(t.config.project ?? "")}`)) as {
        avatarUrls?: Record<string, unknown>;
      } | null;
      // The largest size Jira has, as PNG (its built-in avatars are SVG otherwise)
      const url = imageAt(p?.avatarUrls?.["48x48"], [hostOf(jiraSite(t))], ["size", "xxlarge"]);
      if (!url) return null;
      const png = new URL(url);
      png.searchParams.set("format", "png");
      return tokenLogo(png.href, jiraSite(t));
    }
  } catch {
    // A logo is never worth failing an import
  }
  return null;
}

/** What the import adds to the items picked: their issues counted, Linear's document and people, their logo */
export async function completeForImport(t: SourceAccess, items: SourceItem[]): Promise<SourceItem[]> {
  if (!items.length) return items;
  if ((t.kind === "gitlab" && t.what === "milestones") || t.kind === "jira") {
    const logo = await parentLogo(t);
    return mapLimit(items, CONCURRENCY, async (i) => ({ ...(await (t.kind === "jira" ? jiraCounts(t, i) : gitlabCounts(t, i))), logo }));
  }
  if (t.kind === "linear") {
    const full = new Map(
      (
        await linearByIds(
          t,
          items.map((i) => i.ref),
          LINEAR_FULL,
        )
      ).map((i) => [i.ref, i]),
    );
    return items.map((i) => full.get(i.ref) ?? i);
  }
  return items;
}

/** Reads one item where its id says, or null when the tool no longer finds it */
async function readOne(read: () => Promise<unknown>): Promise<Record<string, unknown> | null> {
  try {
    const r = await read();
    return r && typeof r === "object" ? (r as Record<string, unknown>) : null;
  } catch (e) {
    if (e instanceof SourceError && e.code === "notFound") return null;
    throw e;
  }
}

/** An item that could not be read this time, and why */
export type ReadFailure = { failed: SourceProblem };

/**
 * One item read on its own: when it fails, the others are still read; a refused token or a rate limit stops
 * them all (each would fail the same way)
 */
async function alone<T>(read: () => Promise<T>): Promise<T | ReadFailure> {
  try {
    return await read();
  } catch (e) {
    if (e instanceof SourceError && (e.code === "refused" || e.code === "rateLimited")) throw e;
    return { failed: e instanceof SourceError ? e.code : "failed" };
  }
}

/**
 * Reads the given items again, one by one, with their progress; null for one the tool no longer finds, a
 * failure for one that could not be read this time
 */
export async function readSource(t: SourceAccess, refs: string[]): Promise<Map<string, SourceItem | null | ReadFailure>> {
  const unique = [...new Set(refs)];
  const found = new Map<string, SourceItem | null | ReadFailure>(unique.map((r) => [r, null]));
  if (!unique.length) return found;
  let items: (SourceItem | null | ReadFailure)[];
  switch (t.kind) {
    case "github":
      items = await mapLimit(unique, CONCURRENCY, (ref) =>
        alone(async () => {
          const url =
            t.what === "repos"
              ? `${githubApi(t)}/repositories/${encodeURIComponent(ref)}`
              : `${githubApi(t)}/repos/${t.config.repo}/milestones/${encodeURIComponent(ref)}`;
          const r = await readOne(() => call(t, url));
          return r && (t.what === "repos" ? fromGithubRepo(t, r) : fromGithubMilestone(t, r));
        }),
      );
      break;
    case "gitlab":
      items = await mapLimit(unique, CONCURRENCY, (ref) =>
        alone(async () => {
          if (t.what === "projects") {
            const p = await readOne(() => call(t, `${gitlabHost(t)}/api/v4/projects/${encodeURIComponent(ref)}`));
            return p && fromGitlabProject(t, p);
          }
          const m = await readOne(() => call(t, `${gitlabProject(t)}/milestones/${encodeURIComponent(ref)}`));
          return m && (await gitlabCounts(t, fromGitlabMilestone(t, m)));
        }),
      );
      break;
    case "jira":
      items = await mapLimit(unique, CONCURRENCY, (ref) =>
        alone(async () => {
          const issue = await readOne(() =>
            call(t, `${jiraSite(t)}/rest/api/3/issue/${encodeURIComponent(ref)}?fields=${JIRA_LIGHT.join(",")}`),
          );
          return issue && (await jiraCounts(t, fromJira(t, issue)));
        }),
      );
      break;
    case "linear":
      items = await linearByIds(t, unique, LINEAR_LIGHT);
      break;
  }
  items.forEach((i, n) => {
    // A failure belongs to the ref it was read for; an item, to its own
    if (i && "failed" in i) found.set(unique[n]!, i);
    else if (i && found.has(i.ref)) found.set(i.ref, i);
  });
  return found;
}
