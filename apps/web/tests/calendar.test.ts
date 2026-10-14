import { describe, expect, it } from "vitest";
import { byDay, dayCap, daysUntil, endTime, nextEvent } from "@/lib/shared/calendar";

// The workspace calendar: when sessions end, how a busy day folds, the agenda by day

describe("calendar", () => {
  it("tells when a session ends, past midnight too", () => {
    expect(endTime("09:30", 45)).toBe("10:15");
    expect(endTime("23:30", 90)).toBe("01:00");
  });
  it("folds a busy day into its first sessions and how many more", () => {
    expect(dayCap([1, 2, 3], 3)).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(dayCap([1, 2, 3, 4, 5], 3)).toEqual({ shown: [1, 2], more: 3 });
  });
  it("groups the sessions by day, in order", () => {
    const days = byDay([
      { date: "2026-10-14", time: "10:00", id: "b" },
      { date: "2026-10-13", time: "16:00", id: "a2" },
      { date: "2026-10-13", time: "09:00", id: "a1" },
    ]);
    expect(days.map((d) => [d.date, d.items.map((x) => x.id)])).toEqual([
      ["2026-10-13", ["a1", "a2"]],
      ["2026-10-14", ["b"]],
    ]);
  });
  it("counts the days until a date", () => {
    expect(daysUntil("2026-10-15", "2026-10-13")).toBe(2);
    expect(daysUntil("2026-10-13", "2026-10-13")).toBe(0);
    expect(daysUntil("2026-11-01", "2026-10-25")).toBe(7);
  });

  it("shows first a session going on, even one started the day before", () => {
    const events = [
      { id: "past", date: "2026-10-12", status: "done" },
      { id: "late-night", date: "2026-10-13", status: "live" },
      { id: "monday", date: "2026-10-19", status: "planned" },
    ];
    expect(nextEvent(events, "2026-10-14")?.id).toBe("late-night");
    expect(nextEvent(events.slice(2), "2026-10-14")?.id).toBe("monday");
    expect(nextEvent([{ id: "old", date: "2026-10-01", status: "planned" }], "2026-10-14")).toBeUndefined();
  });
});
