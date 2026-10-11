// "Find a slot": times when everyone is free, in working hours of the meeting's time zone

import { localDate, zonedInstant } from "./schedule";

export interface Busy {
  start: number;
  end: number;
}

export interface SlotQuery {
  /** First instant to consider (ms) */
  from: number;
  days: number;
  durationMin: number;
  timeZone: string;
  /** Working hours, "HH:MM" */
  dayStart?: string;
  dayEnd?: string;
  /** ISO weekdays allowed: 1 Monday … 7 Sunday */
  weekdays?: number[];
  /** Minutes between two candidates */
  stepMin?: number;
  limit?: number;
  /** Minutes kept free before and after every busy time */
  bufferMin?: number;
}

const DAY = 86_400_000;
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const toMinutes = (t: string) => {
  const [h = 0, m = 0] = t.split(":").map(Number);
  return h * 60 + m;
};

/** Whether an interval overlaps any busy time */
export const overlaps = (start: number, end: number, busy: Busy[]) => busy.some((b) => b.start < end && start < b.end);

/** Free slots for everyone, earliest first: { date, time } in the time zone, with their instant */
export function freeSlots(busy: Busy[], q: SlotQuery): { date: string; time: string; startsAt: number }[] {
  const { dayStart = "09:00", dayEnd = "18:00", weekdays = [1, 2, 3, 4, 5], stepMin = 30, limit = 8, bufferMin = 0 } = q;
  const margin = bufferMin * 60_000;
  if (margin) busy = busy.map((b) => ({ start: b.start - margin, end: b.end + margin }));
  const out: { date: string; time: string; startsAt: number }[] = [];
  const first = localDate(q.from, q.timeZone);
  for (let d = 0; d < q.days && out.length < limit; d++) {
    const date = new Date(Date.parse(`${first}T12:00:00Z`) + d * DAY).toISOString().slice(0, 10);
    const weekday = ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
    if (!weekdays.includes(weekday)) continue;
    for (let m = toMinutes(dayStart); m + q.durationMin <= toMinutes(dayEnd) && out.length < limit; m += stepMin) {
      const time = hhmm(m);
      const startsAt = zonedInstant(date, time, q.timeZone);
      if (startsAt < q.from) continue;
      if (!overlaps(startsAt, startsAt + q.durationMin * 60_000, busy)) {
        out.push({ date, time, startsAt });
        // One proposal per day reads better than eight on the same morning
        break;
      }
    }
  }
  return out;
}
