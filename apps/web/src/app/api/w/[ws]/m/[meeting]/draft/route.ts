import { NextResponse } from "next/server";
import { OpError } from "@/lib/server/errors";
import { meetingRoute } from "@/lib/server/meeting/route";
import { buildRecord } from "@/lib/server/meeting/session";

export const dynamic = "force-dynamic";

// Record of the current session as it would be archived now: the control room builds the draft minutes
// from it, in any language and with the parts the host picks
export const GET = meetingRoute("minutes.edit", async (ctx) => {
  const record = await ctx.ws.db.$transaction(async (tx) => {
    const s = await tx.session.findFirst({ where: { meetingId: ctx.meeting.id, status: "current" } });
    if (!s) throw new OpError("noMeeting");
    return buildRecord(tx, ctx, s);
  });
  return NextResponse.json({ record }, { headers: { "Cache-Control": "no-store" } });
});
