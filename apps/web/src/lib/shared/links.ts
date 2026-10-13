import { withBasePath } from "@/lib/shared/base-path";
import { SOURCE_WHATS, type SourceKind, type SourceWhat } from "@/lib/shared/project-sources";

// Addresses the pages build for people to follow: a GitHub issue from a feedback message, the video call, where a
// saved issue tracker leads. Pure, so the server-free tests check what goes into them

export const REPO = "https://github.com/joinronde/ronde";

/** What issueUrl reads of a feedback message: never its author nor their workspace */
export interface FeedbackForIssue {
  kind: string;
  message: string;
  context: Record<string, string | undefined>;
}

/** The first `n` UTF-16 units of a text, one fewer rather than half of an emoji or a rare character */
function cut(text: string, n: number): string {
  const out = text.slice(0, n);
  const last = out.charCodeAt(out.length - 1);
  return out.length < text.length && last >= 0xd800 && last <= 0xdbff ? out.slice(0, -1) : out;
}

/** A new issue of the Ronde project, filled with the message and what helps reproduce it, without names */
export function issueUrl(f: FeedbackForIssue): string {
  // Workspaces, meetings, people, projects and guest links are named by their ids or slugs: only the kind of page
  // stays (the server dropped the query, the hash and long segments when it kept the message: cleanPath)
  const path = (f.context.path ?? "").replace(/\/w\/[^/]+/, "/w/…").replace(/\/(m|people|projects|g)\/[^/]+/g, "/$1/…");
  const firstLine = cut(f.message.split("\n")[0]!, 90);
  const about = [
    `Ronde ${f.context.version ?? "?"} · ${[f.context.browser, f.context.viewport].filter(Boolean).join(" · ")}`,
    path && `Page: \`${path}\``,
    f.context.errorRef && `Error reference: \`${f.context.errorRef}\``,
  ].filter(Boolean);
  // Addresses past a few kilobytes are refused: a long message (Chinese, Hindi take up to 9 characters each once
  // encoded) is shortened, the admin can paste the rest
  const message = f.message.length > 1200 ? `${cut(f.message, 1200)}…` : f.message;
  const body = `${message}\n\n---\n${about.join("\n")}`;
  const q = new URLSearchParams({ title: firstLine, body, labels: f.kind === "bug" ? "bug" : "enhancement" });
  return `${REPO}/issues/new?${q}`;
}

/** Link of the video call: Ronde's own entry (BigBlueButton) under the base path; Jitsi gets the person's name */
export function joinLink(settings: { videoUrl: string; video: { provider: string } }, name: string): string {
  const url = settings.videoUrl;
  if (url.startsWith("/")) return withBasePath(url);
  if (settings.video.provider === "jitsi" && name) return `${url}#userInfo.displayName=${encodeURIComponent(JSON.stringify(name))}`;
  return url;
}

/** A saved issue tracker, as the import dialog knows it */
export interface TrackerPlace {
  kind: SourceKind;
  /** Its repository, project or team, to tell two trackers apart */
  where: string;
}

/** What a saved tracker leads to, for each choice: its repository's organization, or the repository itself */
export function trackerTarget(tr: TrackerPlace, what: SourceWhat): string | null {
  if (tr.kind === "github" && what === "repos") return tr.where.split("/")[0] || null;
  if (tr.kind === "gitlab" && what === "projects") return tr.where.split("/").slice(0, -1).join("/") || null;
  return tr.where;
}

/** What a tool, or a saved tracker, can turn into projects (a GitLab tracker naming its project by number has no group to list) */
export const whatsOf = (kind: SourceKind, tracker?: TrackerPlace) =>
  SOURCE_WHATS[kind].filter((w) => !tracker || (kind !== "github" && kind !== "gitlab") || trackerTarget(tracker, w));
