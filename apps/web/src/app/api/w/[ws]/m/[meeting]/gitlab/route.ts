import type { ForgeItem } from "@ronde/core/types";
import { NextResponse } from "next/server";
import { OpError } from "@/lib/server/errors";
import { gitlabItemsFor, meetingGitlab } from "@/lib/server/gitlab";
import { participantInclude, toMember } from "@/lib/server/meeting/dto";
import { meetingRoute } from "@/lib/server/meeting/route";

export const dynamic = "force-dynamic";

// Recent GitLab issues and merge requests of the viewer (or of every participant with ?all=1)
export const GET = meetingRoute("meeting.read", async (ctx, req) => {
  const { cfg, projects } = await meetingGitlab(ctx.ws.db, ctx.meeting.id);
  if (!cfg.token) throw new OpError("gitlabNotConfigured");
  const all = new URL(req.url).searchParams.get("all") === "1";
  const participants = await ctx.ws.db.meetingParticipant.findMany({
    where: { meetingId: ctx.meeting.id, ...(all ? {} : { personId: ctx.viewer.memberId ?? "-" }) },
    include: participantInclude,
  });
  const items: ForgeItem[] = [];
  for (const p of participants.map(toMember)) {
    if (!p.gitlabUsername) continue;
    const list = await gitlabItemsFor(cfg, p.gitlabUsername, projects);
    items.push(...list.map((i) => ({ ...i, assignee: p.id })));
  }
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return NextResponse.json(items);
});
