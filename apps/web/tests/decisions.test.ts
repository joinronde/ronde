import { describe, expect, it } from "vitest";
import { decisionMonths, periodStart } from "@/lib/shared/decisions";

// The decisions page: a period, a meeting, the months newest first

const d = (date: string, meetingId = "m1") => ({ date, meetingId });

describe("decisions by period and meeting", () => {
  it("starts each period on the right day", () => {
    expect(periodStart("all", "2026-10-13")).toBeNull();
    expect(periodStart("30", "2026-10-13")).toBe("2026-09-13");
    expect(periodStart("90", "2026-10-13")).toBe("2026-07-15");
    expect(periodStart("year", "2026-10-13")).toBe("2026-01-01");
  });
  it("groups by month, newest first, within the period and the meeting", () => {
    const all = [d("2026-08-02"), d("2026-10-10", "m2"), d("2026-10-01"), d("2025-12-31")];
    expect(decisionMonths(all, null, "all", "2026-10-13").map((m) => [m.key, m.items.length])).toEqual([
      ["2026-10", 2],
      ["2026-08", 1],
      ["2025-12", 1],
    ]);
    expect(decisionMonths(all, "m1", "year", "2026-10-13").map((m) => [m.key, m.items.map((x) => x.date)])).toEqual([
      ["2026-10", ["2026-10-01"]],
      ["2026-08", ["2026-08-02"]],
    ]);
    expect(decisionMonths(all, null, "30", "2026-10-13").flatMap((m) => m.items.map((x) => x.date))).toEqual(["2026-10-10", "2026-10-01"]);
  });
});
