import { NextResponse } from "next/server";
import { requireGuest } from "@/lib/server/guest-links";
import { errorResponse } from "@/lib/server/http";

// Photos of the meeting's people, for a guest's screen
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  try {
    const { token, id } = await params;
    const ctx = await requireGuest(token);
    // Only people of this meeting
    const inMeeting = await ctx.ws.db.meetingParticipant.findFirst({
      where: { meetingId: ctx.meeting.id, personId: id },
      select: { id: true },
    });
    const a = inMeeting ? await ctx.ws.db.personAvatar.findFirst({ where: { personId: id } }) : null;
    if (!a) return new NextResponse(null, { status: 404 });
    return new NextResponse(Buffer.from(a.data), {
      headers: { "Content-Type": a.type, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
