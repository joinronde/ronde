// Flexible recurrence: several rules per meeting, each with its own time, and exceptions per occurrence
// (cancelled, moved, another time). Dates are computed in the local calendar of the meeting, then turned
// into instants in its time zone, so daylight-saving changes never shift a meeting.
//
// Supported subset of RFC 5545: DAILY, WEEKLY, MONTHLY; INTERVAL; BYDAY (with an ordinal for MONTHLY,
// e.g. the first Monday or the last Friday); BYMONTHDAY; COUNT; UNTIL.

import { type Locale, translator } from "@ronde/i18n";
import { Temporal } from "temporal-polyfill";

export type Frequency = "daily" | "weekly" | "monthly";

export interface ScheduleRule {
  id: string;
  freq: Frequency;
  /** Every N days, weeks or months */
  interval: number;
  /** ISO weekdays, 1 (Monday) to 7 (Sunday). Weekly: the days; daily: a filter (e.g. weekdays); monthly with `setPos`: the day */
  byDay: number[];
  /** Monthly: nth weekday of the month (1 to 4, or -1 for the last one) */
  setPos: number | null;
  /** Monthly: day of the month (1 to 31; skipped in shorter months), or -1 for the last day of every month */
  monthDay: number | null;
  /** First possible date, YYYY-MM-DD; also sets the phase of "every other week" */
  startDate: string;
  /** Last possible date, inclusive */
  until: string | null;
  /** Number of occurrences at most */
  count: number | null;
  /** Local time "HH:MM" */
  time: string;
  durationMin: number;
}

/** Skipped, moved, or held although a public holiday would skip it */
export type ExceptionKind = "cancel" | "move" | "keep";

/** Change to one occurrence, identified by its rule and its original date */
export interface ScheduleException {
  ruleId: string;
  originalDate: string;
  kind: ExceptionKind;
  /** Moved occurrence: new date, time, duration (each optional) */
  date?: string | null;
  time?: string | null;
  durationMin?: number | null;
  /** The public holiday on that date: a cancel computed from the meeting's holidays (never stored), or a keep */
  holiday?: string | null;
}

export interface Occurrence {
  /** Stable identity: "<ruleId>:<originalDate>" */
  key: string;
  ruleId: string;
  originalDate: string;
  /** Actual date, time and duration (after a move) */
  date: string;
  time: string;
  durationMin: number;
  /** Start instant, in ms */
  startsAt: number;
  moved: boolean;
  cancelled: boolean;
  /** Name of the public holiday on its date: skipped for it, or held anyway when `kept` */
  holiday?: string | null;
  /** Held although a public holiday falls on it */
  kept?: boolean;
}

export const occurrenceKey = (ruleId: string, originalDate: string) => `${ruleId}:${originalDate}`;

/** A "YYYY-MM-DD" that exists on the calendar (not February 30th) */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  try {
    return Temporal.PlainDate.from(value, { overflow: "reject" }).toString() === value;
  } catch {
    return false;
  }
}

const plain = (iso: string) => Temporal.PlainDate.from(iso);
/** Monday of the week of a date */
const weekStart = (d: Temporal.PlainDate) => d.subtract({ days: d.dayOfWeek - 1 });

/** Instant of a local date and time in a time zone (the next valid time when it falls in a DST gap) */
export function zonedInstant(date: string, time: string, timeZone: string): number {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const d = plain(date);
  return Temporal.ZonedDateTime.from({ timeZone, year: d.year, month: d.month, day: d.day, hour, minute }, { disambiguation: "compatible" })
    .epochMilliseconds;
}

/** Local date "YYYY-MM-DD" of an instant in a time zone */
export function localDate(at: number, timeZone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(timeZone).toPlainDate().toString();
}

/** Local time "HH:MM" of an instant in a time zone */
export function localTime(at: number, timeZone: string): string {
  const t = Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(timeZone);
  return `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
}

/** Whether a date matches a rule, ignoring COUNT (which needs every previous occurrence) */
function matches(rule: ScheduleRule, d: Temporal.PlainDate, start: Temporal.PlainDate): boolean {
  if (Temporal.PlainDate.compare(d, start) < 0) return false;
  if (rule.until && Temporal.PlainDate.compare(d, plain(rule.until)) > 0) return false;
  const interval = Math.max(1, rule.interval);
  if (rule.freq === "daily") {
    const days = start.until(d, { largestUnit: "days" }).days;
    return days % interval === 0 && (!rule.byDay.length || rule.byDay.includes(d.dayOfWeek));
  }
  if (rule.freq === "weekly") {
    const weeks = weekStart(start).until(weekStart(d), { largestUnit: "days" }).days / 7;
    const days = rule.byDay.length ? rule.byDay : [start.dayOfWeek];
    return weeks % interval === 0 && days.includes(d.dayOfWeek);
  }
  const months = (d.year - start.year) * 12 + (d.month - start.month);
  if (months % interval !== 0) return false;
  if (rule.setPos && rule.byDay.length) {
    if (!rule.byDay.includes(d.dayOfWeek)) return false;
    return rule.setPos > 0 ? Math.ceil(d.day / 7) === rule.setPos : d.day + 7 > d.daysInMonth;
  }
  if (rule.monthDay === -1) return d.day === d.daysInMonth;
  return d.day === (rule.monthDay ?? start.day);
}

/**
 * Original dates of a rule up to `to` (inclusive), COUNT applied. From its start, or from `from` when the rule
 * has no COUNT (whether a date matches depends on the start alone, so the days before need no walking); `max`
 * stops at that many dates.
 */
export function ruleDates(rule: ScheduleRule, to: string, o: { from?: string; max?: number } = {}): string[] {
  const start = plain(rule.startDate);
  const end = plain(to);
  const out: string[] = [];
  const first = !rule.count && o.from && o.from > rule.startDate ? plain(o.from) : start;
  // Walking day by day keeps the rules simple; the walk covers the dates asked for, not the rule's whole past
  for (let d = first; Temporal.PlainDate.compare(d, end) <= 0; d = d.add({ days: 1 })) {
    if (!matches(rule, d, start)) continue;
    out.push(d.toString());
    if ((rule.count && out.length >= rule.count) || (o.max && out.length >= o.max)) break;
  }
  return out;
}

/** Whether a date is one of a rule's original dates */
function isRuleDate(rule: ScheduleRule, date: string): boolean {
  if (date < rule.startDate) return false;
  return rule.count ? ruleDates(rule, date).at(-1) === date : matches(rule, plain(date), plain(rule.startDate));
}

export interface OccurrenceQuery {
  /** First date to return (by actual date), inclusive */
  from: string;
  /** Last date to return, inclusive */
  to: string;
  /** Return cancelled occurrences too (flagged), for the schedule preview */
  withCancelled?: boolean;
}

/** Recent answers of occurrences(): every screen of a meeting asks the same thing again at each change */
const remembered = new Map<string, Occurrence[]>();
const REMEMBERED = 500;

/** Occurrences of every rule between two dates, exceptions applied, sorted by start */
export function occurrences(
  rules: ScheduleRule[],
  exceptions: ScheduleException[],
  timeZone: string,
  query: OccurrenceQuery,
): Occurrence[] {
  const key = JSON.stringify([rules, exceptions, timeZone, query.from, query.to, !!query.withCancelled]);
  let hit = remembered.get(key);
  if (hit) remembered.delete(key);
  else {
    hit = computeOccurrences(rules, exceptions, timeZone, query);
    if (remembered.size >= REMEMBERED) remembered.delete(remembered.keys().next().value!);
  }
  remembered.set(key, hit);
  // Copies: a caller changing what it got changes nothing for the next one
  return hit.map((o) => ({ ...o }));
}

function computeOccurrences(
  rules: ScheduleRule[],
  exceptions: ScheduleException[],
  timeZone: string,
  { from, to, withCancelled = false }: OccurrenceQuery,
): Occurrence[] {
  const byKey = new Map(exceptions.map((e) => [occurrenceKey(e.ruleId, e.originalDate), e]));
  const out: Occurrence[] = [];
  for (const rule of rules) {
    // The original dates in the range, and those moved into it from elsewhere
    const movedIn = exceptions
      .filter(
        (e) =>
          e.ruleId === rule.id &&
          e.kind === "move" &&
          !!e.date &&
          e.date >= from &&
          e.date <= to &&
          (e.originalDate < from || e.originalDate > to) &&
          isRuleDate(rule, e.originalDate),
      )
      .map((e) => e.originalDate);
    for (const originalDate of [...ruleDates(rule, to, { from }), ...movedIn]) {
      const key = occurrenceKey(rule.id, originalDate);
      const ex = byKey.get(key);
      const cancelled = ex?.kind === "cancel";
      if (cancelled && !withCancelled) continue;
      const moved = ex?.kind === "move";
      const date = (moved && ex.date) || originalDate;
      const time = (moved && ex.time) || rule.time;
      if (date < from || date > to) continue;
      out.push({
        key,
        ruleId: rule.id,
        originalDate,
        date,
        time,
        durationMin: (moved && ex.durationMin) || rule.durationMin,
        startsAt: zonedInstant(date, time, timeZone),
        moved,
        cancelled,
        ...(ex?.holiday ? { holiday: ex.holiday, kept: ex.kind === "keep" } : {}),
      });
    }
  }
  return out.sort((a, b) => a.startsAt - b.startsAt || a.key.localeCompare(b.key));
}

/** First occurrence on or after a date (and after `afterKey`'s occurrence when given), or null */
export function nextOccurrence(
  rules: ScheduleRule[],
  exceptions: ScheduleException[],
  timeZone: string,
  from: string,
  options: { skipDates?: ReadonlySet<string>; horizonDays?: number } = {},
): Occurrence | null {
  const to = plain(from)
    .add({ days: options.horizonDays ?? 400 })
    .toString();
  return occurrences(rules, exceptions, timeZone, { from, to }).find((o) => !options.skipDates?.has(o.date)) ?? null;
}

/** Rule for "every N weeks on this weekday at this time", starting on the next such date */
export function weeklyRule(id: string, weekday: number, time: string, everyWeeks = 1, from: string, durationMin = 30): ScheduleRule {
  let d = plain(from);
  while (d.dayOfWeek !== weekday) d = d.add({ days: 1 });
  return {
    id,
    freq: "weekly",
    interval: everyWeeks,
    byDay: [weekday],
    setPos: null,
    monthDay: null,
    startDate: d.toString(),
    until: null,
    count: null,
    time,
    durationMin,
  };
}

const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * A readable summary: "Every other Monday, alternating 10:00 and 15:00 (Europe/Paris)". The time zone is said
 * only when it is not the reader's own (`viewerZone`, when known).
 */
export function describeSchedule(rules: ScheduleRule[], timeZone: string, locale: Locale, viewerZone?: string | null): string {
  const t = translator(locale, "schedule");
  const list = new Intl.ListFormat(locale, { style: "long", type: "conjunction" });
  const dayName = (iso: number) =>
    new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, iso)));
  const days = (d: number[]) => list.format([...d].sort().map(dayName));
  if (!rules.length) return t("none");
  const zoned = (schedule: string) => (viewerZone === timeZone ? schedule : t("withZone", { schedule, timeZone }));
  // Two "every other week" rules on the same days, one week apart: one alternating pattern
  const [a, b] = rules;
  if (
    rules.length === 2 &&
    a &&
    b &&
    a.freq === "weekly" &&
    b.freq === "weekly" &&
    a.interval === 2 &&
    b.interval === 2 &&
    sameDays(a.byDay, b.byDay) &&
    a.time !== b.time &&
    (weekStart(plain(a.startDate)).until(weekStart(plain(b.startDate)), { largestUnit: "days" }).days / 7) % 2 !== 0
  ) {
    const [first, second] = a.startDate <= b.startDate ? [a, b] : [b, a];
    return zoned(t("alternating", { days: days(a.byDay), first: first.time, second: second.time }));
  }
  const one = (r: ScheduleRule) => {
    const time = r.time;
    if (r.freq === "daily")
      return !r.byDay.length
        ? t("daily", { count: r.interval, time })
        : sameDays(r.byDay, [1, 2, 3, 4, 5]) && r.interval === 1
          ? t("weekdays", { time })
          : t("dailyOn", { count: r.interval, days: days(r.byDay), time });
    if (r.freq === "weekly") return t("weekly", { count: r.interval, days: days(r.byDay), time });
    if (r.setPos && r.byDay.length) return t("monthlyNth", { count: r.interval, nth: String(r.setPos), day: dayName(r.byDay[0]!), time });
    if (r.monthDay === -1) return t("monthlyLast", { count: r.interval, time });
    return t("monthlyDay", { count: r.interval, day: r.monthDay ?? plain(r.startDate).day, time });
  };
  // "Every Monday at 10:00 and every Thursday at 15:00": only the first part starts with a capital
  const parts = rules.map(one).map((p, i) => (i ? p.charAt(0).toLocaleLowerCase(locale) + p.slice(1) : p));
  return zoned(list.format(parts));
}
