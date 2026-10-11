import "server-only";
import { z } from "zod";
import { AccessError, OpError } from "../../errors";
import { transcriptionConfig, transcriptionOn } from "../../transcripts";
import { defineOp } from "./define";

// Transcript of the sessions (Team): allowed per meeting, recording started by the host and seen by everyone,
// turns left out at each person's request

export const transcriptOps = [
  defineOp({
    name: "transcription.allow",
    permission: "meeting.configure",
    audit: true,
    input: z.object({ allowed: z.boolean() }),
    run: async ({ db, m, meetingId }, o) => {
      if (o.allowed && !transcriptionOn(m.ws.workspace)) throw new AccessError(403, "featureNotInPlan");
      await db.meeting.update({ where: { id: meetingId }, data: { transcription: o.allowed } });
      // No recording goes on once the meeting stops allowing it
      if (!o.allowed)
        await db.session.updateMany({ where: { meetingId, status: "current" }, data: { recordingSince: null, recordingBy: null } });
    },
  }),
  defineOp({
    name: "recording.start",
    permission: "session.run",
    audit: true,
    session: "lock",
    input: z.object({}),
    run: async ({ db, m, requireSession }) => {
      if (!m.meeting.transcription || !transcriptionConfig(m.ws.workspace.settings, m.ws.workspace)) throw new OpError("transcriptionOff");
      const s = requireSession();
      if (s.recordingSince) return;
      await db.session.update({ where: { id: s.id }, data: { recordingSince: new Date(), recordingBy: m.ws.member.personId } });
    },
  }),
  defineOp({
    name: "recording.stop",
    permission: "session.run",
    audit: true,
    session: "lock",
    input: z.object({}),
    run: async ({ db, requireSession }) => {
      const s = requireSession();
      await db.session.update({ where: { id: s.id }, data: { recordingSince: null, recordingBy: null } });
    },
  }),
  defineOp({
    name: "transcript.optOut",
    permission: "session.participate",
    session: "lock",
    input: z.object({ out: z.boolean() }),
    run: async ({ db, m, requireSession }, o) => {
      const s = requireSession();
      const me = m.ws.member.personId;
      const list = new Set(s.transcriptOptOut);
      if (o.out) list.add(me);
      else list.delete(me);
      await db.session.update({ where: { id: s.id }, data: { transcriptOptOut: [...list] } });
      // What was already transcribed of their turns goes too
      if (o.out) await db.transcriptSegment.deleteMany({ where: { sessionId: s.id, speakerId: me } });
    },
  }),
];
