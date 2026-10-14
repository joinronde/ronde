import "server-only";
import { createHash } from "node:crypto";
import type { ForgeItem, GitlabProject } from "@ronde/core/types";
import { matchesProjects } from "@ronde/core/util";
import { IntegrationError } from "./errors";
import { outboundFetch } from "./outbound";

// Recent issues and merge requests of a person, through the GitLab API, with one of the connections the meeting
// uses (forges.ts)

interface GlIssue {
  id: number;
  iid: number;
  title: string;
  state: string;
  web_url: string;
  updated_at: string;
  references?: { full?: string };
}

interface GlProject {
  name: string;
  path_with_namespace: string;
  archived?: boolean;
}

/** The server and the token: a personal token or an OAuth access token, both sent as "Authorization: Bearer" */
type GitlabConfig = { url: string; token: string };

const cache = new Map<string, { at: number; items: ForgeItem[] }>();

/**
 * What a cached answer depends on: the server, the token (two workspaces' tokens do not see the same projects)
 * and the request. The token is kept as a hash.
 */
const cacheKey = (cfg: GitlabConfig, ...parts: string[]) =>
  [cfg.url, createHash("sha256").update(cfg.token).digest("hex").slice(0, 16), ...parts].join("|");

async function glFetch(cfg: GitlabConfig, path: string): Promise<Response> {
  const res = await outboundFetch(`${cfg.url}/api/v4${path}`, {
    headers: { Authorization: `Bearer ${cfg.token}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new IntegrationError("gitlabUnreachable", { url: cfg.url });
  });
  if (res.status === 401) throw new IntegrationError("gitlabTokenRefused");
  if (res.status === 404) throw new IntegrationError("gitlabNotFound", { path: path.split("?")[0] ?? "" });
  if (!res.ok) throw new IntegrationError("gitlabStatus", { status: res.status, path: path.split("?")[0] ?? "" });
  return res;
}

async function glGet<T>(cfg: GitlabConfig, path: string): Promise<T> {
  return (await (await glFetch(cfg, path)).json()) as T;
}

const projectOf = (ref: string | undefined) => (ref ?? "").split(/[#!]/)[0] ?? "";

export async function gitlabItemsFor(cfg: GitlabConfig, username: string, projectsFilter: string): Promise<ForgeItem[]> {
  const key = cacheKey(cfg, username, projectsFilter);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.items;
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const u = encodeURIComponent(username);
  const [issues, mrs] = await Promise.all([
    glGet<GlIssue[]>(cfg, `/issues?scope=all&assignee_username=${u}&updated_after=${since}&per_page=50`),
    glGet<GlIssue[]>(cfg, `/merge_requests?scope=all&author_username=${u}&updated_after=${since}&per_page=50`),
  ]);
  const keep = (x: GlIssue) => matchesProjects(x.references?.full, projectsFilter);
  const map = (x: GlIssue, kind: "issue" | "mr"): ForgeItem => ({
    id: `${kind}-${x.id}`,
    ref: (kind === "mr" ? "!" : "#") + x.iid,
    title: x.title,
    project: projectOf(x.references?.full).split("/").pop() ?? "",
    path: projectOf(x.references?.full),
    state: x.state === "merged" ? "merged" : x.state === "opened" ? "opened" : "closed",
    assignee: username,
    updatedAt: Date.parse(x.updated_at),
    url: x.web_url,
  });
  const items = [...issues.filter(keep).map((x) => map(x, "issue")), ...mrs.filter(keep).map((x) => map(x, "mr"))].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  cache.set(key, { at: Date.now(), items });
  return items;
}

const projectsCache = new Map<string, { at: number; list: GitlabProject[] }>();

/** Non-archived projects of the groups (subgroups included), to pick the followed projects */
export async function gitlabGroupProjects(cfg: GitlabConfig, groups: string[]): Promise<GitlabProject[]> {
  const key = cacheKey(cfg, groups.join(","));
  const hit = projectsCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.list;
  const lists = await Promise.all(
    groups.map(async (group) => {
      const out: GitlabProject[] = [];
      // 30 pages of 100: enough for a large group without looping forever
      for (let page = 1; page && page <= 30; ) {
        const res = await glFetch(
          cfg,
          `/groups/${encodeURIComponent(group)}/projects?include_subgroups=true&archived=false&simple=true&order_by=path&sort=asc&per_page=100&page=${page}`,
        ).catch((e: unknown) => {
          if (e instanceof IntegrationError && e.key === "gitlabNotFound") throw new IntegrationError("gitlabGroupNotFound", { group });
          throw e;
        });
        const batch = (await res.json()) as GlProject[];
        out.push(...batch.filter((p) => !p.archived).map((p) => ({ path: p.path_with_namespace, name: p.name, group })));
        page = Number(res.headers.get("x-next-page")) || 0;
      }
      return out;
    }),
  );
  const seen = new Set<string>();
  const list = lists.flat().filter((p) => !seen.has(p.path) && seen.add(p.path));
  projectsCache.set(key, { at: Date.now(), list });
  return list;
}
