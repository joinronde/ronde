import type { ForgeItem } from "@ronde/core/types";
import { NextResponse } from "next/server";
import { OpError } from "@/lib/server/errors";
import { forgeItems, meetingSources } from "@/lib/server/forges";
import { gitlabItemsFor } from "@/lib/server/gitlab";
import { participantInclude, toMember } from "@/lib/server/meeting/dto";
import { meetingRoute } from "@/lib/server/meeting/route";

export const dynamic = "force-dynamic";

// Recent GitLab issues and merge requests of the viewer (or of every participant with ?all=1), through every
// GitLab connection the meeting uses
export const GET = meetingRoute("meeting.read", async (ctx, req) => {
  const sources = (await meetingSources(ctx.ws.db, ctx.meeting.id, "gitlab")).filter((s) => s.access.token);
  if (!sources.length) throw new OpError("gitlabNotConfigured");
  const all = new URL(req.url).searchParams.get("all") === "1";
  const participants = await ctx.ws.db.meetingParticipant.findMany({
    where: { meetingId: ctx.meeting.id, ...(all ? {} : { personId: ctx.viewer.memberId ?? "-" }) },
    include: participantInclude,
  });
  const items: ForgeItem[] = [];
  for (const p of participants.map(toMember)) {
    if (!p.gitlabUsername) continue;
    const username = p.gitlabUsername;
    const list = await forgeItems(sources, ({ source, access }) => gitlabItemsFor(access, username, source.projects));
    items.push(...list.map((i) => ({ ...i, assignee: p.id })));
  }
  items.sort((a, b) => b.updatedAt - a.updatedAt);
  return NextResponse.json(items);
});
