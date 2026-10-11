import { NextResponse } from "next/server";
import { authorize } from "@/lib/server/authz";
import { publish } from "@/lib/server/bus";
import { OpError } from "@/lib/server/errors";
import { errorResponse } from "@/lib/server/http";
import { sniffImage } from "@/lib/server/images";
import { requireMeeting } from "@/lib/server/meeting/context";

// A meeting's own picture (a logo, a team photo), shown in place of its icon in the menus: readable by the
// workspace like the meeting's name, changed by the people who configure the meeting
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ ws: string; meeting: string }> };

/** Maximum size received: the image is already cropped to a 256 px square in the browser */
const MAX_BYTES = 300_000;

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const { ws, meeting } = await params;
    const ctx = await authorize(ws);
    const image = await ctx.db.meetingImage.findFirst({ where: { meetingId: meeting } });
    if (!image) return new NextResponse(null, { status: 404 });
    // The URL carries the version (?v=…): the image can stay cached
    return new NextResponse(Buffer.from(image.data), {
      headers: { "Content-Type": image.type, "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: Request, { params }: Ctx) {
  try {
    const { ws, meeting } = await params;
    const m = await requireMeeting(ws, meeting, "meeting.configure");
    const data = new Uint8Array(await req.arrayBuffer());
    if (!data.length || data.length > MAX_BYTES) throw new OpError("avatarTooLarge", { max: MAX_BYTES / 1000 });
    const type = sniffImage(data);
    if (!type) throw new OpError("avatarFormat");
    await m.ws.db.meetingImage.upsert({
      where: { meetingId: meeting },
      create: { meetingId: meeting, workspaceId: m.ws.workspace.id, data, type },
      update: { data, type },
    });
    await publish(meeting, { kind: "state" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { ws, meeting } = await params;
    const m = await requireMeeting(ws, meeting, "meeting.configure");
    await m.ws.db.meetingImage.deleteMany({ where: { meetingId: meeting } });
    await publish(meeting, { kind: "state" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
