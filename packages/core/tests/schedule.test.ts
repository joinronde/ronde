import { RRule } from "rrule";
import { describe, expect, it } from "vitest";
import {
  describeSchedule,
  localDate,
  nextOccurrence,
  occurrences,
  ruleDates,
  type ScheduleRule,
  weeklyRule,
  zonedInstant,
} from "../src/schedule";

const rule = (r: Partial<ScheduleRule>): ScheduleRule => ({
  id: "r",
  freq: "weekly",
  interval: 1,
  byDay: [1],
  setPos: null,
  monthDay: null,
  startDate: "2026-01-05",
  until: null,
  count: null,
  time: "10:00",
  durationMin: 30,
  ...r,
});

/** Dates the rrule library gives for the same rule (used as an oracle, in UTC: dates only) */
function oracle(r: ScheduleRule, to: string): string[] {
  const days = [RRule.MO, RRule.TU, RRule.WE, RRule.TH, RRule.FR, RRule.SA, RRule.SU];
  const byweekday = r.byDay.map((d) => (r.setPos ? days[d - 1]!.nth(r.setPos) : days[d - 1]!));
  const rr = new RRule({
    freq: { daily: RRule.DAILY, weekly: RRule.WEEKLY, monthly: RRule.MONTHLY }[r.freq],
    interval: r.interval,
    dtstart: new Date(`${r.startDate}T00:00:00Z`),
    wkst: RRule.MO,
    ...(r.byDay.length ? { byweekday } : {}),
    ...(r.monthDay ? { bymonthday: r.monthDay } : {}),
    ...(r.until ? { until: new Date(`${r.until}T23:59:59Z`) } : {}),
    ...(r.count ? { count: r.count } : {}),
  });
  return rr.between(new Date(`${r.startDate}T00:00:00Z`), new Date(`${to}T23:59:59Z`), true).map((d) => d.toISOString().slice(0, 10));
}

describe("rule dates", () => {
  const cases: [string, Partial<ScheduleRule>][] = [
    ["every Monday", {}],
    ["every other Monday", { interval: 2 }],
    ["every 3 weeks on Tuesday and Thursday", { interval: 3, byDay: [2, 4], startDate: "2026-01-06" }],
    ["every weekday", { freq: "daily", byDay: [1, 2, 3, 4, 5] }],
    ["every 2 days", { freq: "daily", interval: 2, byDay: [] }],
    ["first Monday of every month", { freq: "monthly", byDay: [1], setPos: 1 }],
    ["last Friday of every other month", { freq: "monthly", interval: 2, byDay: [5], setPos: -1, startDate: "2026-01-02" }],
    ["the 31st of every month", { freq: "monthly", byDay: [], monthDay: 31, startDate: "2026-01-31" }],
    ["the last day of every month", { freq: "monthly", byDay: [], monthDay: -1, startDate: "2026-01-31" }],
    ["the last day of every quarter", { freq: "monthly", interval: 3, byDay: [], monthDay: -1, startDate: "2026-03-31" }],
    ["Mondays, Wednesdays and Fridays", { freq: "daily", byDay: [1, 3, 5] }],
    ["every 9 weeks", { interval: 9 }],
    ["10 Mondays", { count: 10 }],
    ["Mondays until June", { until: "2026-06-30" }],
  ];
  it.each(cases)("matches rrule for %s", (_, r) => {
    expect(ruleDates(rule(r), "2027-12-31")).toEqual(oracle(rule(r), "2027-12-31"));
  });
});

describe("occurrences", () => {
  it("keeps the local time across daylight-saving changes (Paris, New York)", () => {
    // Paris: UTC+1 in winter, UTC+2 from March 29, 2026, back on October 25, 2026
    expect(new Date(zonedInstant("2026-03-23", "10:00", "Europe/Paris")).toISOString()).toBe("2026-03-23T09:00:00.000Z");
    expect(new Date(zonedInstant("2026-03-30", "10:00", "Europe/Paris")).toISOString()).toBe("2026-03-30T08:00:00.000Z");
    expect(new Date(zonedInstant("2026-10-26", "10:00", "Europe/Paris")).toISOString()).toBe("2026-10-26T09:00:00.000Z");
    // New York switches on March 8 and November 1, 2026
    expect(new Date(zonedInstant("2026-03-09", "09:30", "America/New_York")).toISOString()).toBe("2026-03-09T13:30:00.000Z");
    expect(new Date(zonedInstant("2026-11-02", "09:30", "America/New_York")).toISOString()).toBe("2026-11-02T14:30:00.000Z");
    const weekly = occurrences([rule({ startDate: "2026-03-16" })], [], "Europe/Paris", { from: "2026-03-16", to: "2026-04-06" });
    expect(weekly.map((o) => new Date(o.startsAt).toLocaleTimeString("en-GB", { timeZone: "Europe/Paris" }))).toEqual(
      Array(4).fill("10:00:00"),
    );
  });

  it("alternates two times, one week apart", () => {
    const rules = [
      rule({ id: "am", interval: 2, startDate: "2026-01-05", time: "10:00" }),
      rule({ id: "pm", interval: 2, startDate: "2026-01-12", time: "15:00" }),
    ];
    const list = occurrences(rules, [], "Europe/Paris", { from: "2026-01-01", to: "2026-02-08" });
    expect(list.map((o) => `${o.date} ${o.time}`)).toEqual([
      "2026-01-05 10:00",
      "2026-01-12 15:00",
      "2026-01-19 10:00",
      "2026-01-26 15:00",
      "2026-02-02 10:00",
    ]);
  });

  it("applies cancellations and moves, keyed by the original date", () => {
    const r = rule({});
    const exceptions = [
      { ruleId: "r", originalDate: "2026-01-12", kind: "cancel" as const },
      { ruleId: "r", originalDate: "2026-01-19", kind: "move" as const, date: "2026-01-20", time: "14:00" },
    ];
    const list = occurrences([r], exceptions, "Europe/Paris", { from: "2026-01-05", to: "2026-01-26" });
    expect(list.map((o) => [o.key, o.date, o.time, o.moved])).toEqual([
      ["r:2026-01-05", "2026-01-05", "10:00", false],
      ["r:2026-01-19", "2026-01-20", "14:00", true],
      ["r:2026-01-26", "2026-01-26", "10:00", false],
    ]);
    const preview = occurrences([r], exceptions, "Europe/Paris", { from: "2026-01-05", to: "2026-01-26", withCancelled: true });
    expect(preview.find((o) => o.originalDate === "2026-01-12")?.cancelled).toBe(true);
  });

  it("says which public holiday skips an occurrence, and which one it is held on", () => {
    const r = rule({});
    const exceptions = [
      { ruleId: "r", originalDate: "2026-04-06", kind: "cancel" as const, holiday: "Easter Monday" },
      { ruleId: "r", originalDate: "2026-05-25", kind: "keep" as const, holiday: "Whit Monday" },
    ];
    const list = occurrences([r], exceptions, "Europe/Paris", { from: "2026-04-06", to: "2026-05-25", withCancelled: true });
    expect(list[0]).toMatchObject({ date: "2026-04-06", cancelled: true, holiday: "Easter Monday", kept: false });
    expect(list.at(-1)).toMatchObject({ date: "2026-05-25", cancelled: false, holiday: "Whit Monday", kept: true });
    expect(list[1]).not.toHaveProperty("holiday");
    // Without the cancelled ones, the holiday is not on the list; the held one is
    const live = occurrences([r], exceptions, "Europe/Paris", { from: "2026-04-06", to: "2026-05-25" });
    expect(live.map((o) => o.date)).not.toContain("2026-04-06");
    expect(live.map((o) => o.date)).toContain("2026-05-25");
  });

  it("finds the next occurrence, skipping dates already used", () => {
    const r = rule({});
    expect(nextOccurrence([r], [], "UTC", "2026-01-06")?.date).toBe("2026-01-12");
    expect(nextOccurrence([r], [], "UTC", "2026-01-06", { skipDates: new Set(["2026-01-12"]) })?.date).toBe("2026-01-19");
    expect(nextOccurrence([rule({ count: 1 })], [], "UTC", "2026-01-06")).toBeNull();
  });

  it("builds a weekly rule from the next matching day", () => {
    const r = weeklyRule("w", 3, "09:00", 2, "2026-10-06");
    expect(r.startDate).toBe("2026-10-07");
    expect(ruleDates(r, "2026-11-05")).toEqual(["2026-10-07", "2026-10-21", "2026-11-04"]);
    expect(localDate(zonedInstant("2026-10-07", "23:30", "America/New_York"), "Europe/Paris")).toBe("2026-10-08");
  });
});

describe("describeSchedule", () => {
  it("says it in plain words, in each language", () => {
    expect(describeSchedule([rule({})], "Europe/Paris", "en")).toBe("Every Monday at 10:00 (Europe/Paris)");
    expect(describeSchedule([rule({ interval: 2 })], "Europe/Paris", "fr")).toBe("Un lundi sur deux à 10:00 (Europe/Paris)");
    expect(describeSchedule([rule({ freq: "daily", byDay: [1, 2, 3, 4, 5], time: "09:30" })], "UTC", "en")).toBe(
      "Every weekday at 09:30 (UTC)",
    );
    expect(describeSchedule([rule({ freq: "monthly", setPos: 1 })], "UTC", "en")).toBe("The first Monday of every month at 10:00 (UTC)");
    expect(describeSchedule([rule({ freq: "monthly", setPos: -1, byDay: [5] })], "UTC", "fr")).toBe(
      "Le dernier vendredi de chaque mois à 10:00 (UTC)",
    );
    expect(describeSchedule([rule({}), rule({ id: "b", byDay: [4], time: "15:00" })], "UTC", "en")).toBe(
      "Every Monday at 10:00 and every Thursday at 15:00 (UTC)",
    );
    expect(describeSchedule([rule({ freq: "monthly", byDay: [], monthDay: -1 })], "UTC", "en")).toBe(
      "On the last day of every month at 10:00 (UTC)",
    );
    expect(describeSchedule([rule({ freq: "daily", byDay: [1, 3, 5] })], "UTC", "en")).toBe(
      "Every Monday, Wednesday, and Friday at 10:00 (UTC)",
    );
    expect(describeSchedule([], "UTC", "en")).toBe("No date planned");
  });

  it("recognises an alternating pattern", () => {
    const rules = [rule({ id: "a", interval: 2, time: "10:00" }), rule({ id: "b", interval: 2, startDate: "2026-01-12", time: "15:00" })];
    expect(describeSchedule(rules, "Europe/Paris", "en")).toBe("Every other Monday, alternating 10:00 and 15:00 (Europe/Paris)");
    expect(describeSchedule(rules, "Europe/Paris", "fr")).toBe("Un lundi sur deux, en alternance à 10:00 et à 15:00 (Europe/Paris)");
  });

  it("leaves out the time zone the reader is in", () => {
    expect(describeSchedule([rule({})], "Europe/Paris", "en", "Europe/Paris")).toBe("Every Monday at 10:00");
    expect(describeSchedule([rule({})], "Europe/Paris", "en", "America/New_York")).toBe("Every Monday at 10:00 (Europe/Paris)");
    const rules = [rule({ id: "a", interval: 2, time: "10:00" }), rule({ id: "b", interval: 2, startDate: "2026-01-12", time: "15:00" })];
    expect(describeSchedule(rules, "UTC", "en", "UTC")).toBe("Every other Monday, alternating 10:00 and 15:00");
  });
});

describe("the cost of a schedule", () => {
  it("walks the dates asked for, not the rule's whole past, and still finds a session moved in from far", () => {
    const old = rule({ id: "old", startDate: "2015-01-05", interval: 2 });
    // A December session of that rule, moved to March
    const december = ruleDates(old, "2025-12-31", { from: "2025-12-01" })[0]!;
    const moved = { ruleId: "old", originalDate: december, kind: "move" as const, date: "2026-03-11", time: null, durationMin: null };
    const started = performance.now();
    const list = occurrences([old], [moved], "Europe/Paris", { from: "2026-03-09", to: "2026-03-22" });
    expect(performance.now() - started).toBeLessThan(200);
    expect(list.find((o) => o.moved)).toMatchObject({ key: `old:${december}`, date: "2026-03-11" });
    // Every two weeks from 2015: the alignment kept though the walk starts in 2026
    expect(list.filter((o) => !o.moved).map((o) => o.date)).toEqual(
      occurrences([old], [], "Europe/Paris", { from: "2015-01-01", to: "2026-03-22" })
        .filter((o) => o.date >= "2026-03-09")
        .map((o) => o.date),
    );
  });
});
