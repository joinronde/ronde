import "server-only";
import { createHash } from "node:crypto";
import type { ForgeItem } from "@ronde/core/types";
import { IntegrationError } from "./errors";
import { outboundFetch } from "./outbound";

// Recent issues and pull requests of a person, through the GitHub search API, with one of the connections the
// meeting uses (forges.ts); without a token, public repositories only

interface GhIssue {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  html_url: string;
  updated_at: string;
  repository_url: string;
  pull_request?: { merged_at: string | null };
}

type GithubConfig = { url: string; token: string };

/** The repository follows the filter: "owner/repo", or a whole "owner"; an empty filter follows everything */
export function followsRepo(fullName: string, filter: string): boolean {
  const wanted = filter
    .split(/[\s,]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  if (!wanted.length) return true;
  const name = fullName.toLowerCase();
  return wanted.some((w) => (w.includes("/") ? name === w : name.startsWith(`${w}/`)));
}

const cache = new Map<string, { at: number; items: ForgeItem[] }>();

async function search(cfg: GithubConfig, q: string): Promise<GhIssue[]> {
  const res = await outboundFetch(`${cfg.url}/search/issues?q=${encodeURIComponent(q)}&sort=updated&order=desc&per_page=50`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Ronde",
      ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new IntegrationError("githubUnreachable", { url: cfg.url });
  });
  if (res.status === 401) throw new IntegrationError("githubTokenRefused");
  if (res.status === 403 || res.status === 429) throw new IntegrationError("githubRateLimited");
  if (!res.ok) throw new IntegrationError("githubStatus", { status: res.status });
  return ((await res.json()) as { items?: GhIssue[] }).items ?? [];
}

export async function githubItemsFor(cfg: GithubConfig, username: string, repos: string): Promise<ForgeItem[]> {
  // The token too, as a hash: two workspaces' tokens do not see the same private repositories
  const key = `${cfg.url}|${createHash("sha256")
    .update(cfg.token ?? "")
    .digest("hex")
    .slice(0, 16)}|${username}|${repos}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.items;
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const [issues, pulls] = await Promise.all([
    search(cfg, `is:issue assignee:${username} updated:>=${since}`),
    search(cfg, `is:pr author:${username} updated:>=${since}`),
  ]);
  const repoOf = (x: GhIssue) => x.repository_url.split("/repos/")[1] ?? "";
  const map = (x: GhIssue): ForgeItem => ({
    id: `${x.pull_request ? "pr" : "issue"}-${x.id}`,
    ref: `#${x.number}`,
    title: x.title,
    project: repoOf(x).split("/").pop() ?? "",
    path: repoOf(x),
    state: x.state === "open" ? "opened" : x.pull_request?.merged_at ? "merged" : "closed",
    assignee: username,
    updatedAt: Date.parse(x.updated_at),
    url: x.html_url,
  });
  const items = [...issues, ...pulls]
    .filter((x) => followsRepo(repoOf(x), repos))
    .map(map)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  cache.set(key, { at: Date.now(), items });
  return items;
}
