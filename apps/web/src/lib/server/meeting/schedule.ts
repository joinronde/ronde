import "server-only";
import {
  describeSchedule,
  localDate,
  nextOccurrence,
  type Occurrence,
  occurrenceKey,
  occurrences,
  ruleDates,
  type ScheduleException,
  type ScheduleRule,
  zonedInstant,
} from "@ronde/core/schedule";
import type { RotatingRole, ScheduleDTO } from "@ronde/core/types";
import type { ScopedClient, ScopedTx, Session } from "@ronde/db";
import { type Locale, resolveLocale } from "@ronde/i18n";
import { readConfig } from "@ronde/module-sdk";
import { icebreaker, pickIcebreaker, rotation } from "@ronde/modules";
import { awayPeople } from "../absences";
import { holidayCountries, holidayRegions, holidaysOf, publicHolidays } from "../holidays";
import { personName } from "./dto";

/** Workspace-scoped client or transaction (background work scopes its client to the workspace too) */
type Db = ScopedClient | ScopedTx;

/** Time zone of a meeting: its own, otherwise its workspace's */
export const timeZoneOf = (meeting: { timezone: string | null }, workspace: { timezone: string }) =>
  meeting.timezone || workspace.timezone || "UTC";

/** How far public holidays are applied to the schedule: a little behind (sessions just past), two years ahead */
const HOLIDAYS_BACK = 60;
const HOLIDAYS_AHEAD = 730;

/**
 * Rules and exceptions of a meeting. The public holidays it follows are added as cancelled occurrences (with the
 * holiday's name), unless the host held or moved that occurrence: every reader of the schedule (next session,
 * reminders, calendars, feeds) skips them without knowing about holidays.
 */
export async function loadSchedule(db: Db, meetingId: string): Promise<{ rules: ScheduleRule[]; exceptions: ScheduleException[] }> {
  const [ruleRows, exceptionRows, meeting] = await Promise.all([
    db.scheduleRule.findMany({ where: { meetingId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
    db.scheduleException.findMany({ where: { meetingId } }),
    db.meeting.findFirst({
      where: { id: meetingId },
      select: { holidays: true, timezone: true, locale: true, workspace: { select: { timezone: true, locale: true, settings: true } } },
    }),
  ]);
  const rules: ScheduleRule[] = ruleRows.map((r) => ({
    id: r.id,
    freq: r.freq,
    interval: r.interval,
    byDay: r.byDay,
    setPos: r.setPos,
    monthDay: r.monthDay,
    startDate: r.startDate,
    until: r.until,
    count: r.count,
    time: r.time,
    durationMin: r.durationMin,
  }));
  const exceptions: ScheduleException[] = exceptionRows.map((e) => ({
    ruleId: e.ruleId,
    originalDate: e.originalDate,
    kind: e.kind,
    date: e.date,
    time: e.time,
    durationMin: e.durationMin,
  }));
  const code = meeting ? holidaysOf(meeting, meeting.workspace) : null;
  if (!meeting || !code || !rules.length) return { rules, exceptions };
  const now = today(timeZoneOf(meeting, meeting.workspace));
  const from = plusDays(now, -HOLIDAYS_BACK);
  const to = plusDays(now, HOLIDAYS_AHEAD);
  const days = publicHolidays(code, from, to, resolveLocale(meeting.locale ?? meeting.workspace.locale));
  if (!days.size) return { rules, exceptions };
  const own = new Map(exceptions.map((e) => [occurrenceKey(e.ruleId, e.originalDate), e]));
  const skipped: ScheduleException[] = [];
  for (const rule of rules)
    for (const date of ruleDates(rule, to)) {
      const name = date >= from ? days.get(date) : undefined;
      if (!name) continue;
      const ex = own.get(occurrenceKey(rule.id, date));
      // Held anyway: it says which holiday; moved or skipped by hand: the host's choice stands
      if (ex) {
        if (ex.kind === "keep") ex.holiday = name;
        continue;
      }
      skipped.push({ ruleId: rule.id, originalDate: date, kind: "cancel", holiday: name });
    }
  return { rules, exceptions: [...exceptions, ...skipped] };
}

const today = (timeZone: string) => localDate(Date.now(), timeZone);
const plusDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Recurrence of a meeting for the browser: rules, exceptions, the next 8 dates (cancelled ones flagged) */
export async function scheduleDTO(
  db: Db,
  meeting: { id: string; timezone: string | null; holidays: string | null },
  workspace: { timezone: string; settings?: { bufferMin?: number; holidays?: string } },
  locale: Locale,
): Promise<ScheduleDTO> {
  const { rules, exceptions } = await loadSchedule(db, meeting.id);
  const timeZone = timeZoneOf(meeting, workspace);
  const from = today(timeZone);
  const upcoming = occurrences(rules, exceptions, timeZone, { from, to: plusDays(from, 400), withCancelled: true }).slice(0, 8);
  const conflicts = await scheduleConflicts(db, meeting.id, workspace, upcoming, workspace.settings?.bufferMin ?? 0);
  return {
    timeZone,
    meetingTimeZone: meeting.timezone,
    rules,
    exceptions,
    upcoming,
    summary: describeSchedule(rules, timeZone, locale),
    conflicts,
    holidays: {
      value: meeting.holidays,
      workspace: workspace.settings?.holidays ?? null,
      countries: holidayCountries(),
      // The regions of the country chosen (the meeting's, otherwise the workspace's), to pick one
      regions: holidayRegions((holidaysOf(meeting, workspace) ?? meeting.holidays ?? "").split("-")[0]!),
    },
  };
}

/**
 * Upcoming occurrences that come too close to another meeting of the same people: they overlap, or leave
 * less than the workspace's margin between them. For each, the other meeting and the people concerned.
 */
export async function scheduleConflicts(
  db: Db,
  meetingId: string,
  workspace: { timezone: string },
  upcoming: Occurrence[],
  bufferMin: number,
): Promise<ScheduleDTO["conflicts"]> {
  const live = upcoming.filter((o) => !o.cancelled);
  if (!live.length) return {};
  const mine = await db.meetingParticipant.findMany({ where: { meetingId, role: { not: "observer" } }, select: { personId: true } });
  const people = mine.map((p) => p.personId);
  if (!people.length) return {};
  const others = await db.meeting.findMany({
    where: { id: { not: meetingId }, archivedAt: null, participants: { some: { personId: { in: people }, role: { not: "observer" } } } },
    select: {
      id: true,
      name: true,
      timezone: true,
      participants: {
        where: { personId: { in: people }, role: { not: "observer" } },
        select: { person: { select: { id: true, firstName: true, lastName: true, email: true } } },
      },
    },
  });
  if (!others.length) return {};
  const first = live[0]!.date;
  const last = live[live.length - 1]!.date;
  const margin = bufferMin * 60_000;
  const out: ScheduleDTO["conflicts"] = {};
  for (const other of others) {
    const { rules, exceptions } = await loadSchedule(db, other.id);
    const theirs = occurrences(rules, exceptions, timeZoneOf(other, workspace), { from: plusDays(first, -1), to: plusDays(last, 1) });
    const names = other.participants.map((p) => personName(p.person));
    for (const o of live) {
      const start = o.startsAt - margin;
      const end = o.startsAt + o.durationMin * 60_000 + margin;
      if (theirs.some((t) => t.startsAt < end && start < t.startsAt + t.durationMin * 60_000))
        (out[o.key] ??= []).push({ meeting: other.name, names });
    }
  }
  return out;
}

/** Next occurrence for a new session: on or after `from` (today by default), on a date with no session yet */
export async function nextSessionOccurrence(
  db: Db,
  meeting: { id: string; timezone: string | null },
  workspace: { timezone: string },
  from?: string,
): Promise<Occurrence | null> {
  const timeZone = timeZoneOf(meeting, workspace);
  const { rules, exceptions } = await loadSchedule(db, meeting.id);
  const used = await db.session.findMany({ where: { meetingId: meeting.id }, select: { date: true } });
  const start = from && from > today(timeZone) ? from : today(timeZone);
  return nextOccurrence(rules, exceptions, timeZone, start, { skipDates: new Set(used.map((s) => s.date)) });
}

/** Session columns for an occurrence */
export const occurrenceData = (o: Occurrence) => ({
  date: o.date,
  time: o.time,
  durationMin: o.durationMin,
  startsAt: new Date(o.startsAt),
  occurrenceKey: o.key,
});

/** People who answered "no" for an occurrence: absent from its session */
async function declined(db: Db, meetingId: string, key: string): Promise<string[]> {
  const rows = await db.attendance.findMany({ where: { meetingId, occurrenceKey: key, status: "no" }, select: { personId: true } });
  return rows.map((r) => r.personId);
}

/** Speaking order of a new session: the participants who speak, in round-table order */
export async function freshOrder(db: Db, meetingId: string): Promise<string[]> {
  const rows = await db.meetingParticipant.findMany({
    // Someone who left the workspace, or was removed by its directory, has no turn
    where: { meetingId, active: true, role: { not: "observer" }, person: { active: true, deprovisionedAt: null } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: { personId: true },
  });
  return rows.map((r) => r.personId);
}

/** Rotating roles of a new session: each role goes to the person after last session's, in round-table order */
async function nextAssignments(
  db: Db,
  meetingId: string,
  order: string[],
  absent: string[],
): Promise<Partial<Record<RotatingRole, string>>> {
  const mod = await db.moduleInstallation.findFirst({ where: { meetingId, moduleId: "rotation" } });
  if (!mod?.enabled) return {};
  const { roles } = readConfig(rotation, mod.config);
  const last = await db.session.findFirst({
    where: { meetingId, status: "archived" },
    orderBy: { date: "desc" },
    select: { assignments: true },
  });
  const previous = (last?.assignments ?? {}) as Partial<Record<RotatingRole, string>>;
  const present = order.filter((id) => !absent.includes(id));
  if (!present.length) return {};
  const out: Partial<Record<RotatingRole, string>> = {};
  for (const role of roles) {
    const i = previous[role] ? order.indexOf(previous[role]!) : -1;
    // The next present person after last time's, wrapping around; never twice the same person for two roles
    const candidates = [...order.slice(i + 1), ...order.slice(0, i + 1)].filter((id) => present.includes(id));
    out[role] = candidates.find((id) => !Object.values(out).includes(id)) ?? candidates[0];
  }
  return out;
}

/** Opens the next session of a meeting: next occurrence of its schedule (or the given date) */
export async function openSession(
  db: ScopedTx,
  meeting: { id: string; workspaceId: string; timezone: string | null },
  workspace: { timezone: string },
  options: { date?: string; after?: string; avoidIcebreaker?: string | null } = {},
): Promise<Session | null> {
  const occurrence = options.date
    ? null
    : await nextSessionOccurrence(db, meeting, workspace, options.after ? plusDays(options.after, 1) : undefined);
  if (!options.date && !occurrence) return null;
  const timeZone = timeZoneOf(meeting, workspace);
  const ice = await db.moduleInstallation.findFirst({ where: { meetingId: meeting.id, moduleId: "icebreaker" } });
  const bank = !ice || ice.enabled ? readConfig(icebreaker, ice?.config).bank : [];
  const order = await freshOrder(db, meeting.id);
  const declinedIds = occurrence ? await declined(db, meeting.id, occurrence.key) : [];
  const timeData = occurrence
    ? occurrenceData(occurrence)
    : { date: options.date!, time: "10:00", durationMin: 30, startsAt: null, occurrenceKey: null };
  // A date picked by hand takes the time of the next occurrence when there is one
  if (!occurrence) {
    const hint = await nextSessionOccurrence(db, meeting, workspace);
    if (hint) Object.assign(timeData, { time: hint.time, durationMin: hint.durationMin });
    timeData.startsAt = new Date(zonedInstant(timeData.date, timeData.time, timeZone));
  }
  // Those who said no, and those away that day
  const away = await awayPeople(db, timeData.date, order);
  const absent = order.filter((id) => declinedIds.includes(id) || away.includes(id));
  return db.session.create({
    data: {
      workspaceId: meeting.workspaceId,
      meetingId: meeting.id,
      ...timeData,
      order,
      absent,
      assignments: await nextAssignments(db, meeting.id, order, absent),
      icebreaker: pickIcebreaker(bank, options.avoidIcebreaker),
    },
  });
}

/**
 * After a schedule change: the session not started yet follows the schedule. It moves to the next occurrence
 * when its own one is cancelled, moved, or no longer exists, or when an earlier one appeared. A session
 * created on a date picked by hand stays where it is.
 */
export async function resyncSession(
  db: ScopedTx,
  meeting: { id: string; workspaceId: string; timezone: string | null },
  workspace: { timezone: string },
) {
  const session = await db.session.findFirst({ where: { meetingId: meeting.id, status: "current" } });
  if (session?.startedAt) return;
  if (session && !session.occurrenceKey) return;
  const timeZone = timeZoneOf(meeting, workspace);
  const { rules, exceptions } = await loadSchedule(db, meeting.id);
  const archived = new Set(
    (await db.session.findMany({ where: { meetingId: meeting.id, status: "archived" }, select: { date: true } })).map((s) => s.date),
  );
  const next = nextOccurrence(rules, exceptions, timeZone, today(timeZone), { skipDates: archived });
  if (!session) {
    if (next) await openSession(db, meeting, workspace);
    return;
  }
  if (!next) return;
  if (
    next.key === session.occurrenceKey &&
    next.date === session.date &&
    next.time === session.time &&
    next.durationMin === session.durationMin
  )
    return;
  const absent = (await declined(db, meeting.id, next.key)).filter((id) => session.order.includes(id));
  await db.session.update({ where: { id: session.id }, data: { ...occurrenceData(next), absent } });
}
