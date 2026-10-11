import "server-only";
import type { ForgeItem, GitlabProject } from "@ronde/core/types";
import { matchesProjects } from "@ronde/core/util";
import type { ScopedClient } from "@ronde/db";
import { readConfig } from "@ronde/module-sdk";
import { gitlab } from "@ronde/modules";
import { env } from "./env";
import { AccessError, IntegrationError } from "./errors";
import { outboundFetch } from "./outbound";
import { decryptSecret } from "./secrets";

// Recent issues and merge requests of a person, through the GitLab API.
// The token is the one entered in the settings, otherwise the GITLAB_TOKEN variable.

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

type GitlabConfig = { url: string; token: string };

/** GitLab module of a meeting: its access (own token, otherwise the instance one) and followed projects */
export async function meetingGitlab(db: ScopedClient, meetingId: string) {
  const row = await db.moduleInstallation.findFirst({ where: { meetingId, moduleId: "gitlab" } });
  if (row && !row.enabled) throw new AccessError(403, "moduleDisabled");
  const config = readConfig(gitlab, row?.config);
  const cfg: GitlabConfig = { url: env.gitlabUrl(), token: decryptSecret(row?.secret ?? "") || env.gitlabToken() };
  return { cfg, projects: config.projects, groups: config.groups };
}

const cache = new Map<string, { at: number; items: ForgeItem[] }>();

async function glFetch(cfg: GitlabConfig, path: string): Promise<Response> {
  const res = await outboundFetch(`${cfg.url}/api/v4${path}`, {
    headers: { "PRIVATE-TOKEN": cfg.token },
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
  const hit = cache.get(username);
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
  cache.set(username, { at: Date.now(), items });
  return items;
}

const projectsCache = new Map<string, { at: number; list: GitlabProject[] }>();

/** Non-archived projects of the groups (subgroups included), to pick the followed projects */
export async function gitlabGroupProjects(cfg: GitlabConfig, groups: string[]): Promise<GitlabProject[]> {
  const key = groups.join(",");
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
