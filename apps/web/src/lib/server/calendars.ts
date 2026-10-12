import "server-only";
import { createHash } from "node:crypto";
import { localDate, localTime, occurrences } from "@ronde/core/schedule";
import { type Busy, freeSlots, overlaps } from "@ronde/core/slots";
import { type Prisma, prisma, scoped } from "@ronde/db";
import type { CalendarAccess, CalendarKind } from "@ronde/editions/ee";
import { z } from "zod";
import { enterprise } from "@/ee-bridge";
import { audit } from "./audit";
import type { WorkspaceContext } from "./authz";
import { publish } from "./bus";
import { AccessError, OpError } from "./errors";
import { featureOn, isCloud, type PlanScope } from "./license";
import type { MeetingCtx } from "./meeting/context";
import { personName } from "./meeting/dto";
import { loadSchedule, resyncSession, timeZoneOf } from "./meeting/schedule";
import { outboundFetch } from "./outbound";
import { publicUrl } from "./public-url";
import { canEncrypt, decryptSecret, encryptSecret } from "./secrets";

// Calendar sync (Team), both ways: the sessions of a meeting become events of the organizer with the participants
// invited, kept up to date; what changes in the calendar comes back (a session moved or deleted there is moved or
// skipped here, the attendees' answers become their RSVPs), and busy times to spot conflicts and find a slot.

export const calendarSyncOn = (ws: PlanScope) => featureOn("scheduling.calendarSync", ws);

export const CALENDAR_KINDS = ["google", "microsoft", "caldav"] as const;

/** Sessions written ahead into the calendars */
const HORIZON_DAYS = 56;
/** What is read back each run: the coming four weeks, a dozen events at most */
const READ_BACK_DAYS = 28;
const READ_BACK_MAX = 12;
/** Meetings synced at once, and the time a run may take (it comes back every 15 minutes) */
const SYNC_AT_ONCE = 4;
const SYNC_BUDGET_MS = 10 * 60_000;

const CONFIG: Record<CalendarKind, z.ZodType<Record<string, string>>> = {
  google: z.object({ clientEmail: z.string().email().max(200), organizer: z.string().email().max(200) }),
  microsoft: z.object({ tenant: z.string().min(1).max(100), clientId: z.string().min(1).max(100), organizer: z.string().email().max(200) }),
  // The server's address (or the calendar's), the account's user name; its password is the secret
  caldav: z.object({
    url: z
      .string()
      .url()
      .max(500)
      .refine((u) => u.startsWith("https://") || u.startsWith("http://"), "https://…"),
    username: z.string().min(1).max(200),
    organizer: z.string().email().max(200),
  }),
};

export interface CalendarAccountView {
  id: string;
  kind: CalendarKind;
  name: string;
  config: Record<string, string>;
}

export interface CalendarAccountInput {
  id?: string;
  kind: CalendarKind;
  name: string;
  config: Record<string, string>;
  secret?: string;
}

type Db = WorkspaceContext["db"];

export async function listCalendarAccounts(db: Db): Promise<CalendarAccountView[]> {
  const rows = await db.calendarAccount.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, config: r.config as Record<string, string> }));
}

export async function saveCalendarAccount(ctx: WorkspaceContext, input: CalendarAccountInput): Promise<{ id: string }> {
  if (!CALENDAR_KINDS.includes(input.kind)) throw new OpError("invalidRequest");
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new OpError("nameRequired");
  const config = CONFIG[input.kind].safeParse(input.config);
  if (!config.success) throw new OpError("connectorInvalid", { detail: config.error.issues[0]?.message ?? "" });
  const existing = input.id ? await ctx.db.calendarAccount.findFirst({ where: { id: input.id } }) : null;
  if (input.id && !existing) throw new OpError("notFound");
  const secret = input.secret?.trim();
  if (!secret && !existing?.secret) throw new OpError("connectorSecretRequired");
  if (secret && !canEncrypt()) throw new OpError("encryptionNotConfigured");
  // A CalDAV password does not travel in clear across the internet
  if (input.kind === "caldav" && isCloud() && !String(config.data.url).startsWith("https://"))
    throw new OpError("connectorInvalid", { detail: "https://…" });
  const data = { name, config: config.data as Prisma.InputJsonObject, ...(secret ? { secret: encryptSecret(secret.slice(0, 5000)) } : {}) };
  // Another organizer, server or account: the events written with the old one are removed with it (its ids mean
  // nothing to the new one, which would read them as deleted), then written again with the new one
  const moved = existing && JSON.stringify(existing.config) !== JSON.stringify(config.data);
  const meetings = moved ? await ctx.db.meeting.findMany({ where: { calendarAccountId: existing.id }, select: { id: true } }) : [];
  for (const m of meetings) await removeEvents(ctx.workspace.id, m.id, (e) => e.accountId === existing!.id);
  const row = existing
    ? await ctx.db.calendarAccount.update({ where: { id: existing.id }, data })
    : await ctx.db.calendarAccount.create({ data: { ...data, workspaceId: ctx.workspace.id, kind: input.kind } });
  for (const m of meetings) void syncMeetingCalendar(m.id).catch(() => 0);
  await audit(ctx, ctx.db, {
    action: existing ? "calendar.update" : "calendar.add",
    targetType: "calendarAccount",
    targetId: row.id,
    data: { kind: input.kind },
  });
  return { id: row.id };
}

export async function deleteCalendarAccount(ctx: WorkspaceContext, id: string): Promise<void> {
  // Its coming events leave the calendar with it
  for (const m of await ctx.db.meeting.findMany({ where: { calendarAccountId: id }, select: { id: true } }))
    await removeEvents(ctx.workspace.id, m.id, (e) => e.accountId === id);
  await ctx.db.meeting.updateMany({ where: { calendarAccountId: id }, data: { calendarAccountId: null } });
  await ctx.db.calendarAccount.deleteMany({ where: { id } });
  await audit(ctx, ctx.db, { action: "calendar.delete", targetType: "calendarAccount", targetId: id });
}

const access = (row: { kind: CalendarKind; config: unknown; secret: string }): CalendarAccess => ({
  kind: row.kind,
  config: row.config as Record<string, string>,
  secret: decryptSecret(row.secret),
  fetch: outboundFetch,
});

export async function testCalendarAccount(ctx: WorkspaceContext, id: string) {
  const row = await ctx.db.calendarAccount.findFirst({ where: { id } });
  if (!row) throw new OpError("notFound");
  return enterprise.calendar.test(access(row));
}

/** Picks the calendar account of a meeting (null: none, its events are removed), then syncs */
export async function setMeetingCalendar(m: MeetingCtx, accountId: string | null): Promise<number> {
  if (!calendarSyncOn(m.ws.workspace)) throw new AccessError(403, "featureNotInPlan");
  if (!m.can("meeting.configure")) throw new AccessError(403, "accessDenied");
  if (accountId && !(await m.ws.db.calendarAccount.findFirst({ where: { id: accountId }, select: { id: true } })))
    throw new OpError("notFound");
  const meetingId = m.meeting.id;
  // Events written with another account are removed from its calendar first
  await removeEvents(m.ws.workspace.id, meetingId, (e) => e.accountId !== accountId);
  await m.ws.db.meeting.update({ where: { id: meetingId }, data: { calendarAccountId: accountId } });
  await audit(m.ws, m.ws.db, { action: "calendar.meeting", targetType: "meeting", targetId: meetingId, meetingId, data: { accountId } });
  const changed = accountId ? await syncMeetingCalendar(meetingId) : 0;
  await publish(meetingId, { kind: "state" });
  return changed;
}

/** A meeting archived or deleted, a workspace deleted: its coming sessions leave the calendars */
export async function removeMeetingEvents(workspaceId: string, meetingId: string): Promise<void> {
  await removeEvents(workspaceId, meetingId, () => true);
}

async function removeEvents(workspaceId: string, meetingId: string, which: (e: { accountId: string; startsAt: Date }) => boolean) {
  const db = scoped(prisma, workspaceId);
  const events = await db.calendarEvent.findMany({ where: { meetingId }, include: { account: true } });
  for (const e of events.filter(which)) {
    if (e.startsAt.getTime() > Date.now())
      try {
        await enterprise.calendar.remove(access(e.account), e.eventId);
      } catch (err) {
        // Kept, to be removed by a later sync (cleanCalendars): an event left in someone's calendar is not forgotten
        console.error(`[calendar] removing ${e.eventId}`, err);
        continue;
      }
    await db.calendarEvent.delete({ where: { id: e.id } });
  }
}

const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);

type MappedEvent = Awaited<ReturnType<Db["calendarEvent"]["findMany"]>>[number];

/**
 * What changed in the calendar since it was written comes back, for the sessions still to come: deleted or
 * cancelled there, the session is skipped here; moved there, it is moved here (unless another session already
 * takes that day); a new answer of an attendee becomes their RSVP. A session already started is left alone.
 * Returns how many things changed.
 */
async function readBack(
  db: Db,
  meeting: { id: string; workspaceId: string },
  account: { id: string },
  cal: CalendarAccess,
  events: MappedEvent[],
  timeZone: string,
): Promise<number> {
  const now = Date.now();
  // The coming four weeks, a dozen events at most per run: the next runs follow as the weeks go by
  const mine = events
    .filter((e) => e.accountId === account.id && e.startsAt.getTime() > now && e.startsAt.getTime() < now + READ_BACK_DAYS * 86_400_000)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, READ_BACK_MAX);
  if (!mine.length) return 0;
  const meetingId = meeting.id;
  const [rules, people, started, open] = await Promise.all([
    db.scheduleRule.findMany({ where: { meetingId } }),
    db.meetingParticipant.findMany({ where: { meetingId }, select: { personId: true, person: { select: { email: true } } } }),
    db.session.findMany({ where: { meetingId, startedAt: { not: null } }, select: { occurrenceKey: true } }),
    db.session.findFirst({
      where: { meetingId, status: "current", startedAt: null },
      select: { id: true, occurrenceKey: true, absent: true },
    }),
  ]);
  const absent = new Set(open?.absent ?? []);
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const personByEmail = new Map(people.map((p) => [p.person.email.toLowerCase(), p.personId]));
  const begun = new Set(started.map((s) => s.occurrenceKey));
  let changed = 0;
  for (const e of mine) {
    const at = e.occurrenceKey.lastIndexOf(":");
    const rule = ruleById.get(e.occurrenceKey.slice(0, at));
    const originalDate = e.occurrenceKey.slice(at + 1);
    if (!rule || begun.has(e.occurrenceKey)) continue;
    let state: Awaited<ReturnType<typeof enterprise.calendar.read>>;
    try {
      state = await enterprise.calendar.read(cal, e.eventId);
    } catch (err) {
      // The calendar does not answer: nothing more is asked of it this time (the next run tries again)
      console.error(`[calendar] reading ${e.eventId}`, err);
      break;
    }
    const where = { ruleId_originalDate: { ruleId: rule.id, originalDate } };
    if (!state || state.cancelled) {
      await db.scheduleException.upsert({
        where,
        create: { workspaceId: meeting.workspaceId, meetingId, ruleId: rule.id, originalDate, kind: "cancel" },
        update: { kind: "cancel", date: null, time: null, durationMin: null },
      });
      await db.calendarEvent.delete({ where: { id: e.id } });
      changed++;
      continue;
    }
    // Answers given since the last read: yes or no in Ronde (a "maybe" changes nothing). An event written before
    // the answers were kept only records them: what people answered in Ronde since stays theirs
    const before = (e.answers ?? {}) as Record<string, string>;
    const firstRead = !e.endsAt;
    for (const [email, answer] of Object.entries(state.answers)) {
      const personId = personByEmail.get(email);
      if (firstRead || !personId || before[email] === answer || (answer !== "accepted" && answer !== "declined")) continue;
      const status = answer === "accepted" ? "yes" : "no";
      await db.attendance.upsert({
        where: { meetingId_occurrenceKey_personId: { meetingId, occurrenceKey: e.occurrenceKey, personId } },
        create: { workspaceId: meeting.workspaceId, meetingId, occurrenceKey: e.occurrenceKey, personId, status },
        update: { status },
      });
      // The session of that occurrence, not started yet: absences follow the answers, as in Ronde
      if (open?.occurrenceKey === e.occurrenceKey) {
        if (status === "no") absent.add(personId);
        else absent.delete(personId);
      }
      changed++;
    }
    const data: { answers?: Prisma.InputJsonObject; startsAt?: Date; endsAt?: Date; hash?: string } = {};
    if (JSON.stringify(state.answers) !== JSON.stringify(before)) data.answers = state.answers;
    // Moved in the calendar (a minute or more), the end known since Ronde wrote it
    const start = state.start ? Date.parse(state.start) : null;
    const end = state.end ? Date.parse(state.end) : null;
    if (
      start !== null &&
      end !== null &&
      end > start &&
      e.endsAt &&
      (Math.abs(start - e.startsAt.getTime()) >= 60_000 || Math.abs(end - e.endsAt.getTime()) >= 60_000)
    ) {
      const date = localDate(start, timeZone);
      const time = localTime(start, timeZone);
      const durationMin = Math.min(480, Math.max(5, Math.round((end - start) / 60_000)));
      // Two sessions cannot share a day: then Ronde keeps its date, and the calendar is put back
      const { rules: all, exceptions } = await loadSchedule(db, meetingId);
      const taken =
        date !== originalDate &&
        (occurrences(all, exceptions, timeZone, { from: date, to: date }).some((x) => x.key !== e.occurrenceKey) ||
          !!(await db.session.findFirst({ where: { meetingId, date, NOT: { occurrenceKey: e.occurrenceKey } }, select: { id: true } })));
      // Taken: the event is written again as Ronde has it
      if (taken) data.hash = "";
      else {
        const move = {
          kind: "move" as const,
          date: date !== originalDate ? date : null,
          time: time !== rule.time ? time : null,
          durationMin: durationMin !== rule.durationMin ? durationMin : null,
        };
        if (!move.date && !move.time && !move.durationMin)
          await db.scheduleException.deleteMany({ where: { ruleId: rule.id, originalDate } });
        else
          await db.scheduleException.upsert({
            where,
            create: { workspaceId: meeting.workspaceId, meetingId, ruleId: rule.id, originalDate, ...move },
            update: move,
          });
        // The calendar already shows it: nothing to write back
        data.startsAt = new Date(start);
        data.endsAt = new Date(end);
        changed++;
      }
    }
    if (Object.keys(data).length) await db.calendarEvent.update({ where: { id: e.id }, data });
  }
  if (open && [...absent].sort().join() !== [...open.absent].sort().join())
    await db.session.update({ where: { id: open.id }, data: { absent: [...absent] } });
  return changed;
}

/**
 * Brings the meeting and the organizer's calendar in line, both ways: first what changed in the calendar (see
 * readBack), then the coming sessions written there: missing events created, changed ones updated (moved,
 * renamed, people added or gone), cancelled ones removed. Returns how many changed.
 */
export function syncMeetingCalendar(meetingId: string): Promise<number> {
  // One sync of a meeting at a time: two at once (a schedule change, the job) could each take the other's write
  // for a change made in the calendar
  const previous = running.get(meetingId) ?? Promise.resolve(0);
  const next = previous.catch(() => 0).then(() => syncNow(meetingId));
  running.set(meetingId, next);
  void next
    .finally(() => {
      if (running.get(meetingId) === next) running.delete(meetingId);
    })
    .catch(() => {});
  return next;
}

const running = new Map<string, Promise<number>>();

async function syncNow(meetingId: string): Promise<number> {
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, archivedAt: null, calendarAccountId: { not: null }, workspace: { deletedAt: null, suspendedAt: null } },
    include: { workspace: { select: { slug: true, timezone: true, plan: true } } },
  });
  if (!meeting?.calendarAccountId || !calendarSyncOn(meeting.workspace)) return 0;
  const db = scoped(prisma, meeting.workspaceId);
  const account = await db.calendarAccount.findFirst({ where: { id: meeting.calendarAccountId } });
  if (!account) return 0;
  const cal = access(account);
  const organizer = (cal.config.organizer ?? "").toLowerCase();
  const timeZone = timeZoneOf(meeting, meeting.workspace);
  let changed = await readBack(db, meeting, account, cal, await db.calendarEvent.findMany({ where: { meetingId } }), timeZone);
  if (changed) {
    await resyncSession(db, meeting, meeting.workspace);
    await publish(meetingId, { kind: "state" });
  }
  const [schedule, participants, mapped] = await Promise.all([
    loadSchedule(db, meetingId),
    db.meetingParticipant.findMany({
      where: { meetingId, role: { not: "observer" }, person: { active: true, deprovisionedAt: null } },
      select: { person: { select: { email: true } } },
    }),
    db.calendarEvent.findMany({ where: { meetingId } }),
  ]);
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const until = new Date(now + HORIZON_DAYS * 86_400_000).toISOString().slice(0, 10);
  const coming = occurrences(schedule.rules, schedule.exceptions, timeZone, {
    from: today,
    to: until,
  }).filter((o) => !o.cancelled && o.startsAt > now);
  const attendees = [...new Set(participants.map((p) => p.person.email.toLowerCase()))].filter((e) => e && e !== organizer).sort();
  // Sessions further than the window still exist: their events stay where they are (moved there from the calendar)
  const later = new Set(
    occurrences(schedule.rules, schedule.exceptions, timeZone, {
      from: until,
      to: new Date(now + 366 * 86_400_000).toISOString().slice(0, 10),
    })
      .filter((o) => !o.cancelled)
      .map((o) => o.key),
  );
  const link = await publicUrl(`/w/${meeting.workspace.slug}/m/${meetingId}/me`);
  const byKey = new Map(mapped.map((e) => [e.occurrenceKey, e]));
  for (const o of coming) {
    const startMs = o.startsAt;
    const endMs = o.startsAt + o.durationMin * 60_000;
    const event = {
      title: meeting.name,
      description: `${meeting.name}: ${link}`,
      start: new Date(startMs).toISOString(),
      end: new Date(endMs).toISOString(),
      attendees,
      location: meeting.videoUrl,
    };
    // What the event says apart from its times; the times are kept beside it
    const hash = sha({ title: event.title, description: event.description, attendees, location: event.location });
    const known = byKey.get(o.key);
    byKey.delete(o.key);
    if (known?.accountId === account.id) {
      if (known.endsAt) {
        if (known.hash === hash && known.startsAt.getTime() === startMs && known.endsAt.getTime() === endMs) continue;
      } else if (known.hash === sha(event)) {
        // Written before the end was kept (the hash then covered the times): unchanged, recorded the new way
        await db.calendarEvent.update({ where: { id: known.id }, data: { hash, endsAt: new Date(endMs) } });
        continue;
      }
    }
    try {
      const eventId = await enterprise.calendar.upsert(cal, event, known?.accountId === account.id ? known.eventId : undefined);
      await db.calendarEvent.upsert({
        where: { meetingId_occurrenceKey: { meetingId, occurrenceKey: o.key } },
        create: {
          workspaceId: meeting.workspaceId,
          meetingId,
          accountId: account.id,
          occurrenceKey: o.key,
          eventId,
          hash,
          startsAt: new Date(startMs),
          endsAt: new Date(endMs),
        },
        update: { accountId: account.id, eventId, hash, startsAt: new Date(startMs), endsAt: new Date(endMs) },
      });
      changed++;
    } catch (e) {
      // The calendar does not take it: the next run tries again, without waiting on every session now
      console.error(`[calendar] session ${o.key} of meeting ${meetingId}`, e);
      for (const k of coming.map((x) => x.key)) byKey.delete(k);
      break;
    }
  }
  // What is left was cancelled or is gone: removed when still to come (one beyond the window stays)
  for (const e of byKey.values()) {
    if (later.has(e.occurrenceKey)) continue;
    if (e.startsAt.getTime() > now) {
      await enterprise.calendar.remove(cal, e.eventId).catch((err) => console.error(`[calendar] removing ${e.eventId}`, err));
      changed++;
    }
    await db.calendarEvent.delete({ where: { id: e.id } });
  }
  return changed;
}

/** Every 15 minutes: the calendars of every meeting that has one, a few at once, within the run's budget */
/** Coming events of meetings archived or moved to another account, whose removal failed before: tried again */
async function cleanCalendars(): Promise<void> {
  const stale = await prisma.calendarEvent.findMany({
    where: {
      startsAt: { gt: new Date() },
      OR: [{ meeting: { archivedAt: { not: null } } }, { meeting: { calendarAccountId: null } }, { meeting: { workspace: { deletedAt: { not: null } } } }],
    },
    distinct: ["meetingId"],
    select: { workspaceId: true, meetingId: true },
    take: 50,
  });
  for (const e of stale) await removeMeetingEvents(e.workspaceId, e.meetingId).catch(() => undefined);
}

export async function syncCalendars(): Promise<number> {
  await cleanCalendars();
  const meetings = await prisma.meeting.findMany({
    where: { archivedAt: null, calendarAccountId: { not: null }, workspace: { deletedAt: null, suspendedAt: null } },
    select: { id: true },
  });
  const deadline = Date.now() + SYNC_BUDGET_MS;
  let changed = 0;
  let next = 0;
  const worker = async () => {
    while (next < meetings.length && Date.now() < deadline) {
      const m = meetings[next++]!;
      changed += await syncMeetingCalendar(m.id).catch(() => 0);
    }
  };
  await Promise.all(Array.from({ length: SYNC_AT_ONCE }, worker));
  return changed;
}

export interface Availability {
  /** Coming sessions, with the people busy at that time */
  sessions: { date: string; time: string; busy: string[] }[];
  /** Times when everyone is free, for the meeting's duration */
  slots: { date: string; time: string }[];
  /** People whose calendar could not be read */
  unknown: string[];
}

/** Conflicts of the coming sessions, and free slots over the next two weeks */
export async function meetingAvailability(m: MeetingCtx): Promise<Availability> {
  if (!calendarSyncOn(m.ws.workspace)) throw new AccessError(403, "featureNotInPlan");
  const meeting = m.meeting;
  if (!meeting.calendarAccountId) throw new OpError("calendarNotSet");
  const account = await m.ws.db.calendarAccount.findFirst({ where: { id: meeting.calendarAccountId } });
  if (!account) throw new OpError("calendarNotSet");
  const people = await m.ws.db.meetingParticipant.findMany({
    where: { meetingId: meeting.id, role: { not: "observer" }, person: { active: true } },
    select: { person: { select: { email: true, firstName: true, lastName: true } } },
  });
  const now = Date.now();
  const days = 14;
  const range = { from: new Date(now).toISOString(), to: new Date(now + days * 86_400_000).toISOString() };
  let busy: Record<string, { start: string; end: string }[]>;
  try {
    busy = await enterprise.calendar.busy(
      access(account),
      people.map((p) => p.person.email),
      range,
    );
  } catch (e) {
    throw new OpError("calendarFailed", { detail: e instanceof Error ? e.message : "" });
  }
  // Our own events of the meeting are not conflicts
  const own = new Set(
    (await m.ws.db.calendarEvent.findMany({ where: { meetingId: meeting.id }, select: { startsAt: true } })).map((e) =>
      e.startsAt.getTime(),
    ),
  );
  const blocks = (email: string): Busy[] =>
    (busy[email] ?? []).map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) })).filter((b) => !own.has(b.start));
  const tz = timeZoneOf(meeting, m.ws.workspace);
  const schedule = await loadSchedule(m.ws.db, meeting.id);
  const coming = occurrences(schedule.rules, schedule.exceptions, tz, {
    from: range.from.slice(0, 10),
    to: range.to.slice(0, 10),
  }).filter((o) => o.startsAt > now);
  const duration = coming[0]?.durationMin ?? schedule.rules[0]?.durationMin ?? 30;
  return {
    sessions: coming.slice(0, 8).map((o) => ({
      date: o.date,
      time: o.time,
      busy: people
        .filter((p) => overlaps(o.startsAt, o.startsAt + o.durationMin * 60_000, blocks(p.person.email)))
        .map((p) => personName(p.person)),
    })),
    slots: freeSlots(
      people.flatMap((p) => blocks(p.person.email)),
      { from: now, days, durationMin: duration, timeZone: tz, bufferMin: m.ws.workspace.settings.bufferMin ?? 0 },
    ).map(({ date, time }) => ({ date, time })),
    unknown: people.filter((p) => !(p.person.email in busy)).map((p) => personName(p.person)),
  };
}
