import type { ForgeItem } from "@ronde/core/types";
import { NextResponse } from "next/server";
import { githubItemsFor, meetingGithub } from "@/lib/server/github";
import { participantInclude, toMember } from "@/lib/server/meeting/dto";
import { meetingRoute } from "@/lib/server/meeting/route";

export const dynamic = "force-dynamic";

// Recent GitHub issues and pull requests of the viewer (or of every participant with ?all=1)
export const GET = meetingRoute("meeting.read", async (ctx, req) => {
  const { cfg, repos } = await meetingGithub(ctx.ws.db, ctx.meeting.id);
  const all = new URL(req.url).searchParams.get("all") === "1";
  const participants = await ctx.ws.db.meetingParticipant.findMany({
    where: { meetingId: ctx.meeting.id, ...(all ? {} : { personId: ctx.viewer.memberId ?? "-" }) },
    include: participantInclude,
  });
  const items: ForgeItem[] = [];
  for (const p of participants.map(toMember)) {
    if (!p.githubUsername) continue;
    const list = await githubItemsFor(cfg, p.githubUsername, repos);
    items.push(...list.map((i) => ({ ...i, assignee: p.id })));
  }
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return NextResponse.json(items);
});
