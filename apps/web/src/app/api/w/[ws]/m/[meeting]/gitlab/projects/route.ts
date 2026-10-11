import type { GitlabProject } from "@ronde/core/types";
import { matchesProjects } from "@ronde/core/util";
import { NextResponse } from "next/server";
import { AccessError, OpError } from "@/lib/server/errors";
import { gitlabGroupProjects, meetingGitlab } from "@/lib/server/gitlab";
import type { MeetingCtx } from "@/lib/server/meeting/context";
import { meetingRoute } from "@/lib/server/meeting/route";

// Projects of the meeting's GitLab groups: full list for whoever configures the meeting (followed
// projects), or ?q=… search for everyone (project autocompletion in check-ins)
export const dynamic = "force-dynamic";

const groupsOf = (v: string) =>
  v
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);

export const GET = meetingRoute("meeting.read", async (ctx, req) => {
  const q = new URL(req.url).searchParams.get("q");
  if (q !== null) return NextResponse.json(await search(ctx, q), { headers: { "Cache-Control": "no-store" } });
  if (!ctx.can("meeting.configure")) throw new AccessError(403, "accessDenied");
  const gl = await meetingGitlab(ctx.ws.db, ctx.meeting.id);
  if (!gl.cfg.token) throw new OpError("gitlabTokenFirst");
  const groups = groupsOf(gl.groups);
  if (!groups.length) return NextResponse.json([]);
  return NextResponse.json(await gitlabGroupProjects(gl.cfg, groups), { headers: { "Cache-Control": "no-store" } });
});

/** 12 projects at most: those followed by the team first, then those whose name starts with the input */
async function search(ctx: MeetingCtx, q: string): Promise<GitlabProject[]> {
  const { cfg, projects, groups: groupList } = await meetingGitlab(ctx.ws.db, ctx.meeting.id);
  const groups = groupsOf(groupList);
  if (!cfg.token || !groups.length) return [];
  // An empty search warms up the (cached) list as soon as the person enters the field
  const all = await gitlabGroupProjects(cfg, groups);
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const followed = projects.trim();
  const score = (p: GitlabProject) =>
    (followed && matchesProjects(p.path, followed) ? 0 : 2) + (p.name.toLowerCase().startsWith(needle) ? 0 : 1);
  return all
    .filter((p) => p.name.toLowerCase().includes(needle) || p.path.toLowerCase().includes(needle))
    .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name))
    .slice(0, 12);
}
