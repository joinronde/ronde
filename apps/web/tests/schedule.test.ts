import type { ScheduleRule } from "@ronde/core/schedule";
import { afterEach, describe, expect, it } from "vitest";
import { addDays, isoDow, newRule, sameDays, withFreq } from "@/lib/shared/schedule";

// The schedule editor and the calendar grid: weekdays and days after a date, the same in every time zone

const ZONES = [
  "UTC",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
  "Pacific/Kiritimati",
  "Pacific/Pago_Pago",
];
const zone = process.env.TZ;
afterEach(() => {
  // Assigning undefined would set the text "undefined"
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});

/** Runs the checks in each time zone, as a browser there would */
const inEveryZone = (check: () => void) => {
  for (const tz of ZONES) {
    process.env.TZ = tz;
    check();
  }
};

describe("the time zones of these checks", () => {
  it("really change the local time, so the checks below prove something", () => {
    const offsets = new Set<number>();
    inEveryZone(() => offsets.add(new Date("2026-10-13T12:00:00Z").getTimezoneOffset()));
    expect(offsets.size).toBe(ZONES.length);
  });
});

describe("the ISO weekday of a date", () => {
  it("runs from Monday 1 to Sunday 7", () => {
    // 12 to 18 October 2026, Monday to Sunday
    expect(["12", "13", "14", "15", "16", "17", "18"].map((d) => isoDow(`2026-10-${d}`))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("is the same in every time zone, on the days summer time changes", () => {
    inEveryZone(() => {
      expect(isoDow("2026-03-29")).toBe(7); // Europe goes to summer time
      expect(isoDow("2026-10-25")).toBe(7); // and back
      expect(isoDow("2026-03-08")).toBe(7); // the US
      expect(isoDow("2026-11-01")).toBe(7);
      expect(isoDow("2026-10-04")).toBe(7); // Sydney
    });
  });

  it("knows leap days and the turn of a year", () => {
    expect(isoDow("2028-02-29")).toBe(2);
    expect(isoDow("2026-12-31")).toBe(4);
    expect(isoDow("2027-01-01")).toBe(5);
  });

  it("is not a number for a date that is not one", () => {
    expect(isoDow("")).toBeNaN();
    expect(isoDow("2026-13-01")).toBeNaN();
  });
});

describe("a date some days later", () => {
  it("is the next day, or the day before when negative, or the same day", () => {
    expect(addDays("2026-10-13", 1)).toBe("2026-10-14");
    expect(addDays("2026-10-13", -1)).toBe("2026-10-12");
    expect(addDays("2026-10-13", 0)).toBe("2026-10-13");
  });

  it("crosses months, leap days and years", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2026-10-13", 365)).toBe("2027-10-13");
  });

  it("never skips nor repeats a day when summer time changes, in any time zone", () => {
    inEveryZone(() => {
      expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
      expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
      expect(addDays("2026-10-24", 1)).toBe("2026-10-25");
      expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
      expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
      expect(addDays("2026-04-05", 1)).toBe("2026-04-06");
    });
  });

  it("walks a month's grid of six weeks day by day, as the calendar does", () => {
    inEveryZone(() => {
      const days: string[] = [];
      for (let d = "2026-09-28"; d <= "2026-11-08"; d = addDays(d, 1)) days.push(d);
      expect(days).toHaveLength(42);
      expect(new Set(days).size).toBe(42);
      expect(days.at(-1)).toBe("2026-11-08");
    });
  });

  it("throws for a date that is not one, rather than giving a wrong one", () => {
    expect(() => addDays("", 1)).toThrow(RangeError);
  });
});

describe("comparing weekdays", () => {
  const WORKDAYS = [1, 2, 3, 4, 5];

  it("sees the work week in any order", () => {
    expect(sameDays([5, 4, 3, 2, 1], WORKDAYS)).toBe(true);
    expect(sameDays([1, 2, 3, 4, 5], WORKDAYS)).toBe(true);
  });

  it("tells a day more or less", () => {
    expect(sameDays([1, 2, 3, 4], WORKDAYS)).toBe(false);
    expect(sameDays([1, 2, 3, 4, 5, 6], WORKDAYS)).toBe(false);
    expect(sameDays([1, 2, 3, 4, 6], WORKDAYS)).toBe(false);
  });

  it("does not take a repeated day for the missing one", () => {
    expect(sameDays([1, 1, 2, 3, 4], WORKDAYS)).toBe(false);
  });

  it("sees two empty lists as the same", () => {
    expect(sameDays([], [])).toBe(true);
    expect(sameDays([], WORKDAYS)).toBe(false);
  });

  it("reads its second list as a set: duplicates there are not checked both ways", () => {
    // Only ever called with WORKDAYS as `b`; documented here so a new caller knows
    expect(sameDays([1, 2], [1, 1])).toBe(true);
  });
});

const rule = (patch: Partial<ScheduleRule> = {}): ScheduleRule => ({ ...newRule("2026-10-14", "09:30"), id: "r1", interval: 2, ...patch });

describe("changing a rule's frequency", () => {
  it("to daily drops the days and the monthly settings", () => {
    expect(withFreq(rule({ byDay: [1, 3] }), "daily")).toEqual({ freq: "daily", byDay: [], setPos: null, monthDay: null });
  });

  it("to weekly keeps the days of a weekly rule", () => {
    expect(withFreq(rule({ byDay: [2, 4] }), "weekly")).toEqual({ freq: "weekly", byDay: [2, 4], setPos: null, monthDay: null });
  });

  it("to weekly takes the start's weekday when there are no days to keep", () => {
    // A Wednesday
    expect(withFreq(rule({ byDay: [] }), "weekly").byDay).toEqual([3]);
    // A daily rule's days are a filter, not the meeting days
    expect(withFreq(rule({ freq: "daily", byDay: [1, 2, 3, 4, 5] }), "weekly").byDay).toEqual([3]);
    expect(withFreq(rule({ freq: "monthly", byDay: [5], setPos: 2 }), "weekly").byDay).toEqual([3]);
  });

  it("to monthly meets on the start's day of the month", () => {
    expect(withFreq(rule({ byDay: [3] }), "monthly")).toEqual({ freq: "monthly", byDay: [], setPos: null, monthDay: 14 });
    expect(withFreq(rule({ startDate: "2026-01-31" }), "monthly").monthDay).toBe(31);
    expect(withFreq(rule({ startDate: "2026-03-01" }), "monthly").monthDay).toBe(1);
  });

  it("leaves the time, duration, start, end and interval as they are", () => {
    for (const f of ["daily", "weekly", "monthly"] as const) {
      const change = withFreq(rule({ until: "2027-01-01", count: 5 }), f);
      for (const k of ["time", "durationMin", "startDate", "until", "count", "interval", "id"] as const)
        expect(change).not.toHaveProperty(k);
    }
  });

  it("is the same in every time zone", () => {
    inEveryZone(() => expect(withFreq(rule({ startDate: "2026-10-25", byDay: [] }), "weekly").byDay).toEqual([7]));
  });
});

describe("a new rule", () => {
  it("meets weekly on its first date's weekday, for half an hour at ten", () => {
    expect(newRule("2026-10-18")).toEqual({
      id: "",
      freq: "weekly",
      interval: 1,
      byDay: [7],
      setPos: null,
      monthDay: null,
      startDate: "2026-10-18",
      until: null,
      count: null,
      time: "10:00",
      durationMin: 30,
    });
  });

  it("takes the time of the rule before it", () => {
    expect(newRule("2026-10-13", "17:45").time).toBe("17:45");
  });

  it("falls back to ten when there is no rule before it", () => {
    expect(newRule("2026-10-13", undefined).time).toBe("10:00");
  });

  it("gets a fresh list of days each time", () => {
    const a = newRule("2026-10-13");
    a.byDay.push(5);
    expect(newRule("2026-10-13").byDay).toEqual([2]);
  });
});
