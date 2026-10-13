import type { ScheduleRule } from "@ronde/core/schedule";

// What the schedule editor and the calendar compute from plain dates (YYYY-MM-DD). Every date is read at noon
// UTC: the weekday and the next day never depend on the browser's time zone or a change of summer time

/** ISO weekday of a date: 1 (Monday) to 7 (Sunday) */
export const isoDow = (iso: string) => ((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** A date some days later (or earlier, when negative) */
export const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The same weekdays, in any order (`b` is a set of days without duplicates, like the work week) */
export const sameDays = (a: number[], b: number[]) => a.length === b.length && b.every((d) => a.includes(d));

/** A rule moved to another frequency, keeping what still applies (time, duration, start, end, interval) */
export function withFreq(r: ScheduleRule, freq: ScheduleRule["freq"]): Partial<ScheduleRule> {
  const day = isoDow(r.startDate);
  if (freq === "daily") return { freq, byDay: [], setPos: null, monthDay: null };
  if (freq === "weekly") return { freq, byDay: r.freq === "weekly" && r.byDay.length ? r.byDay : [day], setPos: null, monthDay: null };
  return { freq, byDay: [], setPos: null, monthDay: Number(r.startDate.slice(8)) };
}

/** A new rule: every week on the weekday of its first date, for half an hour */
export const newRule = (from: string, time = "10:00"): ScheduleRule => ({
  id: "",
  freq: "weekly",
  interval: 1,
  byDay: [isoDow(from)],
  setPos: null,
  monthDay: null,
  startDate: from,
  until: null,
  count: null,
  time,
  durationMin: 30,
});
