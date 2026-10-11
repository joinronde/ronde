import { NextResponse } from "next/server";
import { z } from "zod";
import { OpError } from "@/lib/server/errors";
import { errorResponse } from "@/lib/server/http";
import { requireMeeting } from "@/lib/server/meeting/context";
import { MAX_CHUNK_BYTES, processChunk, transcriptionConfig } from "@/lib/server/transcripts";

// A piece of the session's sound, recorded by the control room while the recording is on (Team).
// Its timing and the steps it covers come in headers; it is transcribed right away, then deleted.
export const dynamic = "force-dynamic";

const steps = z.array(z.object({ at: z.number().int().positive(), key: z.string().max(200) })).max(200);
const TYPES = ["audio/webm", "audio/ogg", "audio/mp4"];

export async function POST(req: Request, { params }: { params: Promise<{ ws: string; meeting: string }> }) {
  try {
    const { ws, meeting } = await params;
    const m = await requireMeeting(ws, meeting, "session.run");
    if (!m.meeting.transcription || !transcriptionConfig(m.ws.workspace.settings, m.ws.workspace)) throw new OpError("transcriptionOff");
    const session = await m.ws.db.session.findFirst({ where: { meetingId: meeting, status: "current" } });
    if (!session?.recordingSince) throw new OpError("notRecording");
    const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim();
    if (!TYPES.includes(type)) throw new OpError("invalidRequest");
    // A body announced too big is refused before it is read
    if (Number(req.headers.get("content-length") ?? 0) > MAX_CHUNK_BYTES) throw new OpError("audioTooLarge");
    const data = new Uint8Array(await req.arrayBuffer());
    if (!data.length || data.length > MAX_CHUNK_BYTES) throw new OpError("audioTooLarge");
    const startAt = Number(req.headers.get("x-ronde-start"));
    const endAt = Number(req.headers.get("x-ronde-end"));
    let announced: unknown = null;
    try {
      announced = JSON.parse(req.headers.get("x-ronde-steps") ?? "[]");
    } catch {}
    const timeline = steps.safeParse(announced);
    if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || endAt < startAt || !timeline.success) throw new OpError("invalidRequest");
    // Only what was said while the recording was on
    if (endAt < session.recordingSince.getTime() - 5_000) throw new OpError("notRecording");
    const chunk = await m.ws.db.audioChunk.create({
      data: {
        workspaceId: m.ws.workspace.id,
        sessionId: session.id,
        data,
        type,
        startAt: new Date(startAt),
        endAt: new Date(endAt),
        steps: timeline.data,
      },
    });
    // Transcribed now; a failure is tried again by the job
    void processChunk(chunk.id).catch((e) => console.error("[transcript]", e));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
