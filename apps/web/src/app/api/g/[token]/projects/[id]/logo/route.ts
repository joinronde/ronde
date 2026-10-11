import { NextResponse } from "next/server";
import { requireGuest } from "@/lib/server/guest-links";
import { errorResponse } from "@/lib/server/http";

// Logos of the projects the meeting follows, for a guest's screen
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string; id: string }> }) {
  try {
    const { token, id } = await params;
    const ctx = await requireGuest(token);
    // Only the projects of this meeting
    const followed = await ctx.ws.db.meetingProject.findFirst({
      where: { meetingId: ctx.meeting.id, projectId: id },
      select: { project: { select: { logo: true } } },
    });
    const logo = followed?.project.logo;
    if (!logo) return new NextResponse(null, { status: 404 });
    return new NextResponse(Buffer.from(logo.data), {
      headers: { "Content-Type": logo.type, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
