// iCalendar feed (RFC 5545) of meetings: one recurring event per schedule rule, cancelled dates as EXDATE,
// moved dates as overriding instances (RECURRENCE-ID). Calendar apps then show the same dates as Ronde.

import { ruleDates, type ScheduleException, type ScheduleRule, zonedInstant } from "./schedule";

export interface IcsMeeting {
  id: string;
  name: string;
  timeZone: string;
  rules: ScheduleRule[];
  exceptions: ScheduleException[];
  /** Link to the meeting in Ronde (empty when unknown) */
  url: string;
  description?: string;
  /** Sessions set on a date by hand, outside the schedule */
  extra?: { date: string; time: string; durationMin: number }[];
}

const DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** Text value: backslash, semicolon, comma and line breaks escaped */
export const icsText = (v: string) => v.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 octets are folded: CRLF then a space (never splitting a UTF-8 character) */
export function foldLine(line: string): string {
  const bytes = new TextEncoder();
  if (bytes.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  for (const ch of line) {
    const limit = out.length ? 74 : 75;
    if (bytes.encode(cur + ch).length > limit) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const local = (date: string, time: string) => `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
const utc = (ms: number) => `${new Date(ms).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
const duration = (min: number) => `PT${Math.floor(min / 60) ? `${Math.floor(min / 60)}H` : ""}${min % 60 ? `${min % 60}M` : ""}` || "PT0M";

export function rrule(rule: ScheduleRule, timeZone: string): string {
  const parts = [`FREQ=${rule.freq.toUpperCase()}`, `INTERVAL=${Math.max(1, rule.interval)}`];
  if (rule.freq === "monthly" && rule.setPos && rule.byDay.length) parts.push(`BYDAY=${rule.setPos}${DAYS[rule.byDay[0]! - 1]}`);
  else if (rule.freq === "monthly") parts.push(`BYMONTHDAY=${rule.monthDay ?? Number(rule.startDate.slice(8))}`);
  else if (rule.byDay.length) parts.push(`BYDAY=${rule.byDay.map((d) => DAYS[d - 1]).join(",")}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  else if (rule.until) parts.push(`UNTIL=${utc(zonedInstant(rule.until, rule.time, timeZone))}`);
  parts.push("WKST=MO");
  return parts.join(";");
}

/** A whole calendar, with the meetings' events */
export function icsCalendar(name: string, meetings: IcsMeeting[], now = Date.now()): string {
  const stamp = utc(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ronde//Ronde//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(name)}`,
  ];
  if (meetings.length === 1) lines.push(`X-WR-TIMEZONE:${meetings[0]!.timeZone}`);
  for (const m of meetings) {
    const tz = m.timeZone;
    const common = [
      `SUMMARY:${icsText(m.name)}`,
      ...(m.url ? [`URL:${m.url}`] : []),
      ...(m.description ? [`DESCRIPTION:${icsText(m.description)}`] : []),
    ];
    for (const rule of m.rules) {
      // DTSTART is the first real occurrence: calendar apps always count it as one
      const first = ruleDates(rule, "2100-12-31")[0];
      if (!first) continue;
      const uid = `${rule.id}@ronde`;
      const own = m.exceptions.filter((e) => e.ruleId === rule.id);
      const skipped = own.filter((e) => e.kind === "cancel");
      lines.push(
        "BEGIN:VEVENT",
        `UID:${uid}`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=${tz}:${local(first, rule.time)}`,
        `DURATION:${duration(rule.durationMin)}`,
      );
      lines.push(`RRULE:${rrule(rule, tz)}`);
      for (const e of skipped) lines.push(`EXDATE;TZID=${tz}:${local(e.originalDate, rule.time)}`);
      lines.push(...common, "END:VEVENT");
      for (const e of own.filter((x) => x.kind === "move")) {
        lines.push(
          "BEGIN:VEVENT",
          `UID:${uid}`,
          `DTSTAMP:${stamp}`,
          `RECURRENCE-ID;TZID=${tz}:${local(e.originalDate, rule.time)}`,
          `DTSTART;TZID=${tz}:${local(e.date ?? e.originalDate, e.time ?? rule.time)}`,
          `DURATION:${duration(e.durationMin ?? rule.durationMin)}`,
          ...common,
          "END:VEVENT",
        );
      }
    }
    for (const x of m.extra ?? [])
      lines.push(
        "BEGIN:VEVENT",
        `UID:${m.id}-${x.date}@ronde`,
        `DTSTAMP:${stamp}`,
        `DTSTART;TZID=${tz}:${local(x.date, x.time)}`,
        `DURATION:${duration(x.durationMin)}`,
        ...common,
        "END:VEVENT",
      );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
