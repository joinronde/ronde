import { describe, expect, it } from "vitest";
import { byMonth, limitGroups } from "@/lib/shared/show-more";

// A project's timeline was cut at 40 sessions without a word: long lists now show a month at a time, more on demand

const items = ["2026-10-12", "2026-10-03", "2026-09-28", "2026-09-01", "2026-08-15"].map((date) => ({ date }));

describe("long lists", () => {
  it("group by month, newest first", () => {
    expect(byMonth(items, (x) => x.date).map((m) => [m.key, m.items.length])).toEqual([
      ["2026-10", 2],
      ["2026-09", 2],
      ["2026-08", 1],
    ]);
  });

  it("show the first items across the months, and say how many are left", () => {
    const months = byMonth(items, (x) => x.date);
    const cut = limitGroups(months, 3);
    expect(cut.groups.map((m) => [m.key, m.items.length])).toEqual([
      ["2026-10", 2],
      ["2026-09", 1],
    ]);
    expect(cut.hidden).toBe(2);
    expect(limitGroups(months, 10)).toEqual({ groups: months, hidden: 0 });
  });
});
