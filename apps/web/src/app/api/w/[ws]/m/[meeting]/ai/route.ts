import { buildMinutes, minutesToMarkdown } from "@ronde/core/minutes";
import { parseRecord } from "@ronde/core/record";
import { translator } from "@ronde/i18n";
import { NextResponse } from "next/server";
import { z } from "zod";
import { enterprise } from "@/ee-bridge";
import { aiConfig, aiOn } from "@/lib/server/ai";
import { audit } from "@/lib/server/audit";
import { AccessError, OpError } from "@/lib/server/errors";
import { errorResponse } from "@/lib/server/http";
import { requireMeeting } from "@/lib/server/meeting/context";
import { personName } from "@/lib/server/meeting/dto";
import { notifiedMeeting } from "@/lib/server/notified-meeting";
import { sessionTranscript, transcriptText } from "@/lib/server/transcripts";

// The AI assistant on an archived session: a draft of its summary, or follow-up actions to add (Team)
export const dynamic = "force-dynamic";

const body = z.object({ task: z.enum(["summary", "actions"]), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export async function POST(req: Request, { params }: { params: Promise<{ ws: string; meeting: string }> }) {
  try {
    const { ws, meeting } = await params;
    const m = await requireMeeting(ws, meeting, "minutes.edit");
    if (!aiOn(m.ws.workspace)) throw new AccessError(403, "featureNotInPlan");
    const config = aiConfig(m.ws.workspace.settings, m.ws.workspace);
    if (!config) throw new OpError("aiNotConfigured");
    const { task, date } = body.parse(await req.json());
    const session = await m.ws.db.session.findFirst({ where: { meetingId: meeting, date, status: "archived" } });
    const record = parseRecord(session?.record);
    const nm = await notifiedMeeting(meeting);
    if (!session || !record || !nm) throw new OpError("notFound");
    const lines = await sessionTranscript(m.ws.db, session.id);
    const input = {
      meeting: m.meeting.name,
      minutes: minutesToMarkdown(buildMinutes(record, nm.locale, { summary: null })),
      locale: nm.locale,
      ...(lines.length ? { transcript: transcriptText(lines, translator(nm.locale, "transcript")("others")) } : {}),
    };
    // What leaves for the provider is kept in the audit log
    await audit(m.ws, m.ws.db, { action: `ai.${task}`, targetType: "meeting", targetId: meeting, meetingId: meeting, data: { date } });
    try {
      if (task === "summary") return NextResponse.json({ summary: await enterprise.ai.summarize(input, config) });
      const people = await m.ws.db.meetingParticipant.findMany({
        where: { meetingId: meeting, role: { not: "observer" } },
        select: { person: { select: { id: true, firstName: true, lastName: true, email: true } } },
      });
      const actions = await enterprise.ai.suggestActions(
        { ...input, people: people.map((p) => ({ id: p.person.id, name: personName(p.person) })) },
        config,
      );
      return NextResponse.json({ actions });
    } catch (e) {
      const code = (e as { code?: string }).code;
      throw new OpError(code === "aiKey" ? "aiKey" : code === "aiAnswer" ? "aiAnswer" : "aiUnavailable");
    }
  } catch (e) {
    return errorResponse(e);
  }
}
