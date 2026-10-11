import { NextResponse } from "next/server";
import { personName } from "@/lib/server/meeting/dto";
import { meetingRoute } from "@/lib/server/meeting/route";

export const dynamic = "force-dynamic";

/** People of the workspace directory who do not take part in the meeting yet, to add them */
export const GET = meetingRoute("participants.manage", async (ctx) => {
  const people = await ctx.ws.db.person.findMany({
    where: { active: true, participations: { none: { meetingId: ctx.meeting.id } } },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    select: { id: true, firstName: true, lastName: true, email: true, userId: true, jobCategory: { select: { name: true } } },
  });
  return NextResponse.json(
    people.map((p) => ({ id: p.id, name: personName(p), email: p.email, jobCategory: p.jobCategory?.name ?? "", hasAccount: !!p.userId })),
    { headers: { "Cache-Control": "no-store" } },
  );
});
