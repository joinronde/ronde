import "server-only";
import { buildMinutes, minutesToMarkdown } from "@ronde/core/minutes";
import { digestEmail } from "@ronde/core/notifications";
import { parseRecord } from "@ronde/core/record";
import { prisma } from "@ronde/db";
import { emailBrand } from "../branding";
import { sendEmail } from "../mailer";
import { notifiedMeeting } from "../notified-meeting";
import { minutesPayload, notifyEvent } from "../notify/dispatch";
import { publishSession } from "../wikis";
import { closeDueSessions } from "./close-due";

// Async mode: a session without a live meeting is archived at its planned time, then its digest is emailed

/** Emails the minutes of an archived session to the participants who receive the meeting's emails */
export async function sendDigest(meetingId: string, sessionId: string): Promise<number> {
  const nm = await notifiedMeeting(meetingId);
  const s = await prisma.session.findFirst({ where: { id: sessionId, meetingId, status: "archived" } });
  const record = parseRecord(s?.record);
  if (!nm || !s || !record) return 0;
  const minutes = minutesToMarkdown(buildMinutes(record, nm.locale, { summary: s.summary }));
  const people = await prisma.meetingParticipant.findMany({
    where: { meetingId, remind: true, role: { not: "observer" }, person: { active: true } },
    select: { person: { select: { email: true, firstName: true } } },
  });
  const brand = await emailBrand(nm.meeting.workspaceId);
  let sent = 0;
  for (const { person } of people) {
    if (!person.email) continue;
    const mail = digestEmail({
      teamName: nm.meeting.name,
      locale: nm.locale,
      date: s.date,
      name: person.firstName,
      minutes,
      url: nm.appUrl ? `${nm.appUrl}/me` : "",
      brand,
    });
    try {
      await sendEmail({ to: person.email, ...mail });
      sent++;
    } catch (e) {
      console.error(`[digest] sending to a participant of meeting ${meetingId} failed`, e);
    }
  }
  return sent;
}

/** After an async session is archived: screens refresh, the notification rules and the digest go out */
export async function afterPublish(
  meetingId: string,
  s: { id: string; date: string; time: string },
  record: Parameters<typeof minutesPayload>[0],
) {
  await notifyEvent(meetingId, "minutes.published", s.id, minutesPayload(record, s));
  await sendDigest(meetingId, s.id);
  await publishSession(s.id);
}

/** Job: archives the sessions of async meetings whose planned time has come, and sends their digest */
export async function closeAsyncSessions(now = new Date()): Promise<number> {
  const due = await prisma.session.findMany({
    where: {
      status: "current",
      startedAt: null,
      startsAt: { lte: now },
      meeting: {
        archivedAt: null,
        workspace: { deletedAt: null, suspendedAt: null },
        modules: { some: { moduleId: "async", enabled: true } },
      },
    },
    include: { meeting: { include: { workspace: true } } },
  });
  return closeDueSessions(due, {
    still: { startedAt: null },
    after: (meetingId, session, record) => afterPublish(meetingId, session, record),
    what: "async session",
  });
}
