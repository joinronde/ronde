// The workspace calendar: what each day holds, its sessions by day for the agenda, when a session ends. Pure, so
// the server-free tests check them

/** "09:30" and 45 minutes → "10:15" (past midnight, the next day's time) */
export function endTime(time: string, durationMin: number): string {
  const [h, m] = time.split(":").map(Number) as [number, number];
  const total = (h * 60 + m + durationMin) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** The first sessions of a day that fit its cell, and how many more there are */
export function dayCap<T>(list: T[], cap: number): { shown: T[]; more: number } {
  return list.length <= cap ? { shown: list, more: 0 } : { shown: list.slice(0, cap - 1), more: list.length - cap + 1 };
}

/** Sessions by day, in order, for the agenda */
export function byDay<T extends { date: string; time: string }>(events: T[]): { date: string; items: T[] }[] {
  const days = new Map<string, T[]>();
  for (const e of [...events].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))) {
    const list = days.get(e.date) ?? [];
    list.push(e);
    days.set(e.date, list);
  }
  return [...days].map(([date, items]) => ({ date, items }));
}

/** Days from today to a date ("2026-10-15" from "2026-10-13": 2), whatever the time zone of the browser */
export const daysUntil = (date: string, today: string) =>
  Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);

/** The session to show first: one going on, whatever day it started, otherwise the first planned from today */
export function nextEvent<E extends { date: string; status: string }>(events: readonly E[], today: string): E | undefined {
  return events.find((e) => e.status === "live") ?? events.find((e) => e.status === "planned" && e.date >= today);
}
