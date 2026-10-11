import "server-only";
import { createHash } from "node:crypto";
import { occurrences } from "@ronde/core/schedule";
import { type Busy, freeSlots, overlaps } from "@ronde/core/slots";
import { type Prisma, prisma, scoped } from "@ronde/db";
import type { CalendarAccess, CalendarKind } from "@ronde/editions/ee";
import { z } from "zod";
import { enterprise } from "@/ee-bridge";
import { audit } from "./audit";
import type { WorkspaceContext } from "./authz";
import { publish } from "./bus";
import { AccessError, OpError } from "./errors";
import { featureOn, type PlanScope } from "./license";
import type { MeetingCtx } from "./meeting/context";
import { personName } from "./meeting/dto";
import { loadSchedule, timeZoneOf } from "./meeting/schedule";
import { outboundFetch } from "./outbound";
import { publicUrl } from "./public-url";
import { canEncrypt, decryptSecret, encryptSecret } from "./secrets";

// Calendar sync (Team): the sessions of a meeting become events of the organizer with the participants
// invited, kept up to date; their busy times come back to spot conflicts and find a slot.

export const calendarSyncOn = (ws: PlanScope) => featureOn("scheduling.calendarSync", ws);

export const CALENDAR_KINDS = ["google", "microsoft"] as const;

/** Sessions written ahead into the calendars */
const HORIZON_DAYS = 56;

const CONFIG: Record<CalendarKind, z.ZodType<Record<string, string>>> = {
  google: z.object({ clientEmail: z.string().email().max(200), organizer: z.string().email().max(200) }),
  microsoft: z.object({ tenant: z.string().min(1).max(100), clientId: z.string().min(1).max(100), organizer: z.string().email().max(200) }),
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
  const data = { name, config: config.data as Prisma.InputJsonObject, ...(secret ? { secret: encryptSecret(secret.slice(0, 5000)) } : {}) };
  const row = existing
    ? await ctx.db.calendarAccount.update({ where: { id: existing.id }, data })
    : await ctx.db.calendarAccount.create({ data: { ...data, workspaceId: ctx.workspace.id, kind: input.kind } });
  await audit(ctx, ctx.db, {
    action: existing ? "calendar.update" : "calendar.add",
    targetType: "calendarAccount",
    targetId: row.id,
    data: { kind: input.kind },
  });
  return { id: row.id };
}

export async function deleteCalendarAccount(ctx: WorkspaceContext, id: string): Promise<void> {
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

async function removeEvents(workspaceId: string, meetingId: string, which: (e: { accountId: string; startsAt: Date }) => boolean) {
  const db = scoped(prisma, workspaceId);
  const events = await db.calendarEvent.findMany({ where: { meetingId }, include: { account: true } });
  for (const e of events.filter(which)) {
    if (e.startsAt.getTime() > Date.now())
      await enterprise.calendar.remove(access(e.account), e.eventId).catch((err) => console.error(`[calendar] removing ${e.eventId}`, err));
    await db.calendarEvent.delete({ where: { id: e.id } });
  }
}

/**
 * Brings the organizer's calendar in line with the coming sessions: creates the missing events, updates the
 * changed ones (moved, renamed, people added or gone), removes the cancelled ones. Returns how many changed.
 */
export async function syncMeetingCalendar(meetingId: string): Promise<number> {
  const meeting = await prisma.meeting.findFirst({
    where: { id: meetingId, archivedAt: null, calendarAccountId: { not: null } },
    include: { workspace: { select: { slug: true, timezone: true, plan: true } } },
  });
  if (!meeting?.calendarAccountId || !calendarSyncOn(meeting.workspace)) return 0;
  const db = scoped(prisma, meeting.workspaceId);
  const account = await db.calendarAccount.findFirst({ where: { id: meeting.calendarAccountId } });
  if (!account) return 0;
  const cal = access(account);
  const organizer = (cal.config.organizer ?? "").toLowerCase();
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
  const coming = occurrences(schedule.rules, schedule.exceptions, timeZoneOf(meeting, meeting.workspace), {
    from: today,
    to: until,
  }).filter((o) => !o.cancelled && o.startsAt > now);
  const attendees = [...new Set(participants.map((p) => p.person.email.toLowerCase()))].filter((e) => e && e !== organizer).sort();
  const link = await publicUrl(`/w/${meeting.workspace.slug}/m/${meetingId}/me`);
  const byKey = new Map(mapped.map((e) => [e.occurrenceKey, e]));
  let changed = 0;
  for (const o of coming) {
    const event = {
      title: meeting.name,
      description: `${meeting.name}: ${link}`,
      start: new Date(o.startsAt).toISOString(),
      end: new Date(o.startsAt + o.durationMin * 60_000).toISOString(),
      attendees,
      location: meeting.videoUrl,
    };
    const hash = createHash("sha256").update(JSON.stringify(event)).digest("hex").slice(0, 32);
    const known = byKey.get(o.key);
    byKey.delete(o.key);
    if (known?.hash === hash && known.accountId === account.id) continue;
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
          startsAt: new Date(o.startsAt),
        },
        update: { accountId: account.id, eventId, hash, startsAt: new Date(o.startsAt) },
      });
      changed++;
    } catch (e) {
      console.error(`[calendar] session ${o.key} of meeting ${meetingId}`, e);
    }
  }
  // What is left was cancelled, or moved out of the window: removed when still to come
  for (const e of byKey.values()) {
    if (e.startsAt.getTime() > now) {
      await enterprise.calendar.remove(cal, e.eventId).catch((err) => console.error(`[calendar] removing ${e.eventId}`, err));
      changed++;
    }
    await db.calendarEvent.delete({ where: { id: e.id } });
  }
  return changed;
}

/** Every 15 minutes: the calendars of every meeting that has one */
export async function syncCalendars(): Promise<number> {
  const meetings = await prisma.meeting.findMany({ where: { archivedAt: null, calendarAccountId: { not: null } }, select: { id: true } });
  let changed = 0;
  for (const m of meetings) changed += await syncMeetingCalendar(m.id).catch(() => 0);
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
