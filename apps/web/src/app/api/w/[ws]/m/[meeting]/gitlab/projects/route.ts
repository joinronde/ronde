import type { GitlabProject } from "@ronde/core/types";
import { matchesProjects } from "@ronde/core/util";
import { NextResponse } from "next/server";
import { AccessError, OpError } from "@/lib/server/errors";
import { accessOrInstance, meetingSources } from "@/lib/server/forges";
import { gitlabGroupProjects } from "@/lib/server/gitlab";
import type { MeetingCtx } from "@/lib/server/meeting/context";
import { meetingRoute } from "@/lib/server/meeting/route";

// Projects of a GitLab connection's groups: full list for whoever configures the meeting (?connection=…&groups=…,
// the followed projects), or ?q=… search through every connection the meeting uses, for everyone (project
// autocompletion in check-ins)
export const dynamic = "force-dynamic";

const groupsOf = (v: string) =>
  v
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);

export const GET = meetingRoute("meeting.read", async (ctx, req) => {
  const params = new URL(req.url).searchParams;
  const q = params.get("q");
  if (q !== null) return NextResponse.json(await search(ctx, q), { headers: { "Cache-Control": "no-store" } });
  if (!ctx.can("meeting.configure")) throw new AccessError(403, "accessDenied");
  const access = await accessOrInstance(ctx.ws.db, params.get("connection") ?? "", ctx.meeting.id, "gitlab");
  if (!access?.token) throw new OpError("gitlabTokenFirst");
  const groups = groupsOf(params.get("groups") ?? "");
  if (!groups.length) return NextResponse.json([]);
  return NextResponse.json(await gitlabGroupProjects(access, groups), { headers: { "Cache-Control": "no-store" } });
});

/** 12 projects at most: those followed by the team first, then those whose name starts with the input */
async function search(ctx: MeetingCtx, q: string): Promise<GitlabProject[]> {
  const sources = (await meetingSources(ctx.ws.db, ctx.meeting.id, "gitlab")).filter(
    (s) => s.access.token && groupsOf(s.source.groups).length,
  );
  if (!sources.length) return [];
  // An empty search warms up the (cached) lists as soon as the person enters the field
  const lists = await Promise.all(
    sources.map(async ({ source, access }) =>
      (await gitlabGroupProjects(access, groupsOf(source.groups)).catch(() => [])).map((p) => ({ p, followed: source.projects.trim() })),
    ),
  );
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const score = ({ p, followed }: { p: GitlabProject; followed: string }) =>
    (followed && matchesProjects(p.path, followed) ? 0 : 2) + (p.name.toLowerCase().startsWith(needle) ? 0 : 1);
  return lists
    .flat()
    .filter(({ p }) => p.name.toLowerCase().includes(needle) || p.path.toLowerCase().includes(needle))
    .sort((a, b) => score(a) - score(b) || a.p.name.localeCompare(b.p.name))
    .slice(0, 12)
    .map(({ p }) => p);
}
