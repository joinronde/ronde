import { rrulestr } from "rrule";
import { describe, expect, it } from "vitest";
import { foldLine, icsCalendar, icsText, rrule } from "../src/ics";
import type { ScheduleRule } from "../src/schedule";

const rule = (r: Partial<ScheduleRule>): ScheduleRule => ({
  id: "r1",
  freq: "weekly",
  interval: 1,
  byDay: [1],
  setPos: null,
  monthDay: null,
  startDate: "2026-10-12",
  until: null,
  count: null,
  time: "10:00",
  durationMin: 30,
  ...r,
});

describe("ICS feed", () => {
  it("writes one recurring event per rule, with skipped and moved dates", () => {
    const ics = icsCalendar(
      "Weekly",
      [
        {
          id: "m1",
          name: "Weekly, product",
          timeZone: "Europe/Paris",
          url: "https://app.example.com/w/acme/m/m1",
          rules: [rule({ interval: 2 })],
          exceptions: [
            { ruleId: "r1", originalDate: "2026-10-26", kind: "cancel" },
            { ruleId: "r1", originalDate: "2026-11-09", kind: "move", date: "2026-11-10", time: "15:00" },
          ],
        },
      ],
      Date.UTC(2026, 9, 6),
    );
    const lines = ics.split("\r\n");
    expect(lines).toContain("DTSTART;TZID=Europe/Paris:20261012T100000");
    expect(lines).toContain("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;WKST=MO");
    expect(lines).toContain("EXDATE;TZID=Europe/Paris:20261026T100000");
    expect(lines).toContain("RECURRENCE-ID;TZID=Europe/Paris:20261109T100000");
    expect(lines).toContain("DTSTART;TZID=Europe/Paris:20261110T150000");
    expect(lines).toContain("SUMMARY:Weekly\\, product");
    expect(lines.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(2);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("starts on the first real occurrence and writes rules rrule can read back", () => {
    // Starts on a Tuesday, but only Mondays match: DTSTART is the following Monday
    const r = rule({ startDate: "2026-10-13", until: "2026-12-31" });
    const ics = icsCalendar("x", [{ id: "m", name: "x", timeZone: "UTC", url: "", rules: [r], exceptions: [] }]);
    expect(ics).toContain("DTSTART;TZID=UTC:20261019T100000");
    expect(rrule(r, "UTC")).toBe("FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;UNTIL=20261231T100000Z;WKST=MO");
    expect(rrule(rule({ freq: "monthly", byDay: [5], setPos: -1 }), "UTC")).toBe("FREQ=MONTHLY;INTERVAL=1;BYDAY=-1FR;WKST=MO");
    expect(rrule(rule({ freq: "monthly", byDay: [], monthDay: 15, count: 6 }), "UTC")).toBe(
      "FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15;COUNT=6;WKST=MO",
    );
    const parsed = rrulestr(`DTSTART:20261019T100000Z\nRRULE:${rrule(r, "UTC")}`);
    expect(parsed.all().length).toBe(11);
  });

  it("escapes text and folds long lines without breaking characters", () => {
    expect(icsText("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    // A lone CR is a line break too; a control character cannot end the line either
    expect(icsText("a\rb\r\nc\u0000d\te")).toBe("a\\nb\\ncd\te");
    const long = `DESCRIPTION:${"é".repeat(60)}`;
    const folded = foldLine(long);
    for (const part of folded.split("\r\n")) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n ").join("")).toBe(long);
  });
});
