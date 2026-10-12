import { followedProjects, sheetWritten, toProjectDTO } from "./meeting/projects";
import "server-only";
import path from "node:path";
import { agendaOf, hasTurns } from "@ronde/core/agenda";
import { notificationCheckInUrl, REMINDER_LOGO_CID, reminderEmail } from "@ronde/core/notifications";
import { isCheckInReady, reminderDate } from "@ronde/core/util";
import { prisma, type Session, scoped } from "@ronde/db";
import { formatters, translator } from "@ronde/i18n";
import nodemailer from "nodemailer";
import { emailBrand } from "./branding";
import { env } from "./env";
import { inboundAddress, inboundOn, replyMessageId } from "./inbound";
import { isSampleAddress } from "./mailer";
import { lastPlans, loadCheckIns } from "./meeting/checkins";
import { personName } from "./meeting/dto";
import { type NotifiedMeeting, notifiedMeeting } from "./notified-meeting";
import { birthdayPayload, notifyEvent, overduePayload, sessionPayload } from "./notify/dispatch";
import { type PushMessage, pushOn, sendPush } from "./push";
import { remindInSlack, slackReminders } from "./slack";
import { remindInTeams, teamsReminders } from "./teams";

// Session reminders: by email (or by Slack direct message, when the workspace added the Slack app and the
// person is found there) to each participant whose check-in is not ready, and through the meeting's
// notification rules ("session soon", "check-in reminder"). Checked every minute for every meeting; each
// send is reserved (atomic update or unique delivery key), so several replicas never send twice.

/** Local date and minutes since midnight of an instant, in a time zone */
export function zonedClock(now: Date, timeZone: string): { date: string; minutes: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const minutesOf = (hhmm: string, fallback: number) => {
  const [h, m] = hhmm.split(":").map(Number);
  return Number.isFinite(h) ? (h ?? 0) * 60 + (m ?? 0) : fallback;
};

/** Checks every meeting that has something to send; returns the number of emails sent */
export async function checkReminders(now = new Date()): Promise<number> {
  const meetings = await prisma.meeting.findMany({
    where: {
      archivedAt: null,
      // A sample meeting sends nothing
      sample: false,
      workspace: { deletedAt: null, suspendedAt: null },
      OR: [
        { reminderEnabled: true },
        { notificationRules: { some: { enabled: true, event: { in: ["session_soon", "checkin_reminder"] } } } },
      ],
    },
    select: { id: true },
  });
  let sent = 0;
  for (const { id } of meetings) {
    try {
      sent += await checkMeeting(id, now);
    } catch (e) {
      console.error(`[reminders] meeting ${id}`, e);
    }
  }
  return sent;
}

/** The date before a "YYYY-MM-DD" */
const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

async function checkMeeting(meetingId: string, now: Date): Promise<number> {
  const n = await notifiedMeeting(meetingId);
  if (!n) return 0;
  const m = n.meeting;
  // Reminders follow the session prepared by the host, on the date they picked
  const session = await prisma.session.findFirst({ where: { meetingId, status: "current" } });
  if (!session || session.startedAt) return 0;
  const target = session.date;
  const clock = zonedClock(now, n.timezone);

  // "Session soon" a few minutes before the time (not after: a late session needs no second announcement)
  const start = minutesOf(session.time, 600);
  // (a session just after midnight is announced from the evening before)
  const minutesTo = clock.date === target ? start - clock.minutes : clock.date === dayBefore(target) ? start + 1440 - clock.minutes : -1;
  if (minutesTo > 0)
    await notifyEvent(
      meetingId,
      "session.soon",
      `${session.id}@${target}`,
      { ...sessionPayload(session), minutesBefore: minutesTo },
      {
        filter: (o) => minutesTo <= Number(o.minutesBefore ?? 10),
      },
    );

  const sameDay = m.reminderWhen === "sameDay";
  if (clock.date !== reminderDate(target, sameDay ? "sameDay" : "dayBefore")) return 0;
  // A same-day reminder set after the session goes out an hour before it instead
  const remindAt = minutesOf(m.reminderTime, 900);
  if (clock.minutes < (sameDay ? Math.min(remindAt, start - 60) : remindAt)) return 0;

  // No turn in the agenda (a retrospective on its board alone): no check-in to ask for
  if (!hasTurns(agendaOf(m.agenda))) return 0;

  // Collective check-in reminder, with the progress counted when sending
  await notifyEvent(meetingId, "checkin.reminder", `${session.id}@${target}`, { ...sessionPayload(session), progress: true });

  if (!m.reminderEnabled || m.reminderLastSentFor === target) return 0;
  const [slack, teams] = await Promise.all([slackReminders(m.workspaceId), teamsReminders(m.workspaceId)]);
  // Some way to reach people: email, Slack, Teams or their devices
  if (!env.smtpUrl() && !slack && !teams && !pushOn()) return 0;
  const { count } = await prisma.meeting.updateMany({
    where: { id: meetingId, OR: [{ reminderLastSentFor: null }, { reminderLastSentFor: { not: target } }] },
    data: { reminderLastSentFor: target },
  });
  if (count !== 1) return 0;
  return sendReminders(n, session, slack, teams);
}

async function sendReminders(
  n: NotifiedMeeting,
  session: Session,
  slack: Awaited<ReturnType<typeof slackReminders>>,
  teams: Awaited<ReturnType<typeof teamsReminders>>,
): Promise<number> {
  const meetingId = n.meeting.id;
  const db = scoped(prisma, n.meeting.workspaceId);
  const [participants, checkIns, actions, last, plans, followed] = await Promise.all([
    prisma.meetingParticipant.findMany({
      where: { meetingId, active: true, remind: true, role: { not: "observer" }, personId: { notIn: session.absent } },
      include: { person: { select: { firstName: true, lastName: true, email: true, active: true, handles: true, userId: true } } },
    }),
    loadCheckIns(db, meetingId, n.settings.sections),
    prisma.action.findMany({ where: { meetingId, status: { not: "done" } } }),
    prisma.session.findFirst({ where: { meetingId, status: "archived" }, orderBy: { date: "desc" }, select: { archivedAt: true } }),
    lastPlans(db, meetingId),
    followedProjects(db, meetingId),
  ]);
  // Sheets of the active projects still to write, per person working on them
  const sheetsOf = (personId: string) =>
    followed
      .filter((p) => p.status === "active" && toProjectDTO(p).memberIds.includes(personId))
      .filter((p) => !sheetWritten(p.sheet))
      .map((p) => p.name);
  const lastArchivedAt = last?.archivedAt?.getTime() ?? null;
  const brand = await emailBrand(n.meeting.workspaceId);
  const transport = env.smtpUrl() ? nodemailer.createTransport(env.smtpUrl()) : null;
  const checkInUrl = n.appUrl ? notificationCheckInUrl(n.appUrl) : "";
  let sent = 0;
  // On the devices of the people who turned push notifications on, besides the email or Slack message
  const tp = translator(n.locale, "push");
  const when = translator(n.locale, "notifications")("when", { date: formatters(n.locale).dateShort(session.date), time: session.time });
  const pushes: { userId: string; message: PushMessage }[] = [];
  for (const p of participants) {
    // Check-in ready and project sheets written, or person no longer in the directory: no reminder
    const sheets = sheetsOf(p.personId);
    if (!p.person.active || (isCheckInReady(checkIns[p.personId], lastArchivedAt) && !sheets.length)) continue;
    if (p.person.userId && checkInUrl)
      pushes.push({
        userId: p.person.userId,
        message: {
          title: tp("reminder", { meeting: n.settings.teamName }),
          body: tp("reminderBody", { when }),
          url: checkInUrl,
          tag: `reminder:${session.id}`,
        },
      });
    const planned = plans[p.personId]?.items.map((i) => i.text) ?? [];
    const mine = actions.filter((a) => a.ownerId === p.personId);
    // In Teams or Slack, by personal message, when the person is found there; by email otherwise
    const reminder = {
      locale: n.locale,
      teamName: n.settings.teamName,
      meetingId,
      date: session.date,
      time: session.time,
      name: personName(p.person),
      checkInUrl,
      planned,
      actions: mine,
      sheets,
    };
    const who = { id: p.personId, ...p.person };
    if ((teams && (await remindInTeams(teams, who, reminder))) || (slack && (await remindInSlack(slack, who, reminder)))) {
      sent++;
      continue;
    }
    // Someone of a sample meeting's fictitious team, added to a real meeting: no inbox to write to
    if (!transport || isSampleAddress(p.person.email)) continue;
    const message = reminderEmail({
      settings: n.settings,
      locale: n.locale,
      date: session.date,
      time: session.time,
      name: personName(p.person),
      checkInUrl,
      planned,
      actions: mine,
      sheets,
      brand,
      reply: inboundOn(),
    });
    // Replies are read: they go to the inbound address, and their In-Reply-To names this person and meeting
    const messageId = replyMessageId(p.personId, meetingId);
    try {
      await transport.sendMail({
        from: env.mailFrom(),
        to: p.person.email,
        ...(messageId ? { messageId, replyTo: inboundAddress()! } : {}),
        ...message,
        attachments: brand
          ? []
          : [
              {
                filename: "ronde.png",
                path: path.join(process.cwd(), "public", "icon.png"),
                cid: REMINDER_LOGO_CID,
                contentType: "image/png",
                contentDisposition: "inline",
              },
            ],
      });
      sent++;
    } catch (e) {
      console.error(`[reminders] sending to person ${p.personId} failed`, e);
    }
  }
  console.log(`[reminders] ${sent} reminder(s) sent for the ${session.date} session of meeting ${meetingId}`);
  await sendPush(pushes, "reminder", { ttl: 12 * 3600 });
  return sent;
}

/**
 * Daily notifications, checked every hour: overdue follow-up actions and birthdays, sent once a day from
 * 09:00 in the meeting's time zone.
 */
export async function checkDaily(now = new Date()): Promise<number> {
  const rules = await prisma.notificationRule.findMany({
    where: {
      enabled: true,
      event: { in: ["action_overdue", "birthday"] },
      meeting: { archivedAt: null, sample: false, workspace: { deletedAt: null, suspendedAt: null } },
    },
    select: {
      meetingId: true,
      event: true,
      options: true,
      meeting: { select: { timezone: true, workspace: { select: { timezone: true } } } },
    },
  });
  let queued = 0;
  for (const rule of rules) {
    try {
      const clock = zonedClock(now, rule.meeting.timezone || rule.meeting.workspace.timezone || "UTC");
      if (clock.minutes < 9 * 60) continue;
      if (rule.event === "birthday") {
        const payload = await birthdayPayload(rule.meetingId, clock.date.slice(5));
        if (payload) queued += await notifyEvent(rule.meetingId, "birthday", clock.date, payload);
      } else {
        const days = Math.max(1, Number((rule.options as { days?: number }).days ?? 7));
        const payload = await overduePayload(rule.meetingId, days);
        if (payload)
          queued += await notifyEvent(rule.meetingId, "action.overdue", clock.date, payload, {
            filter: (o) => Number(o.days ?? 7) === days,
          });
      }
    } catch (e) {
      console.error(`[notify] daily check of meeting ${rule.meetingId}`, e);
    }
  }
  return queued;
}
