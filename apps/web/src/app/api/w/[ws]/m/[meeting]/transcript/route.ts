import { NextResponse } from "next/server";
import { OpError } from "@/lib/server/errors";
import { errorResponse } from "@/lib/server/http";
import { requireMeeting } from "@/lib/server/meeting/context";
import { sessionTranscript } from "@/lib/server/transcripts";

// Transcript of a session (?date=): read by the people of the meeting, a draft's by the hosts only
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ ws: string; meeting: string }> }) {
  try {
    const { ws, meeting } = await params;
    const m = await requireMeeting(ws, meeting, "meeting.read");
    const date = new URL(req.url).searchParams.get("date") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new OpError("invalidRequest");
    // Those who do not write the minutes read the transcript of the session under way, or of published minutes:
    // never one of a draft, which stays with the hosts until it is published
    const session = await m.ws.db.session.findFirst({
      where: {
        meetingId: meeting,
        date,
        ...(m.can("minutes.edit") ? {} : { OR: [{ status: "current" }, { status: "archived", minutesPublishedAt: { not: null } }] }),
      },
      select: { id: true },
    });
    if (!session) throw new OpError("notFound");
    return NextResponse.json({ lines: await sessionTranscript(m.ws.db, session.id) });
  } catch (e) {
    return errorResponse(e);
  }
}
