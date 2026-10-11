import { parseRecord, recordCheckIn, recordSections } from "@ronde/core/record";
import type { PastCheckIn } from "@ronde/core/types";
import { NextResponse } from "next/server";
import { requestLocale } from "@/lib/server/locale";
import { meetingRoute } from "@/lib/server/meeting/route";

export const dynamic = "force-dynamic";

// Past check-ins of the viewer: those presented at archived sessions of the meeting
export const GET = meetingRoute("meeting.read", async (ctx) => {
  const me = ctx.viewer.memberId;
  if (!me) return NextResponse.json([]);
  const locale = await requestLocale();
  const rows = await ctx.ws.db.session.findMany({
    where: { meetingId: ctx.meeting.id, status: "archived" },
    orderBy: { date: "desc" },
    take: 104,
    select: { date: true, record: true },
  });
  const items: PastCheckIn[] = [];
  for (const r of rows) {
    const record = parseRecord(r.record);
    const checkIn = record && recordCheckIn(record, me);
    if (!record || !checkIn) continue;
    items.push({
      date: r.date,
      checkIn,
      sections: recordSections(record, locale),
      spent: record.spent[me] ?? 0,
      projects: record.projects.filter((p) => checkIn.byProject?.[p.id]).map(({ id, name }) => ({ id, name })),
    });
  }
  return NextResponse.json(items, { headers: { "Cache-Control": "no-store" } });
});
