import { median, projectProgress, recurringBlockers } from "@ronde/core/stats";
import { describe, expect, it } from "vitest";

// Parts of the stats computed from the records (the rest is computed by the database)

describe("team stats", () => {
  it("takes the median", () => {
    expect(median([])).toBeNull();
    expect(median([4, 10, 1])).toBe(4);
    expect(median([1, 2, 3, 10])).toBe(2.5);
  });

  it("counts done items per project and keeps its health, per session", () => {
    const dates = ["2026-09-14", "2026-09-21"];
    const out = projectProgress(dates, [
      { date: "2026-09-14", projectId: "p1", name: "Portal", done: 2, health: "onTrack" },
      { date: "2026-09-21", projectId: "p1", name: "Customer portal", done: 1, health: "atRisk" },
      { date: "2026-09-21", projectId: "p2", name: "Billing API", done: 1, health: null },
      { date: "2026-09-07", projectId: "p3", name: "Before the stats", done: 4, health: null },
    ]);
    expect(out).toEqual([
      { id: "p1", name: "Customer portal", total: 3, perSession: [2, 1], health: ["onTrack", "atRisk"], last: "2026-09-21" },
      { id: "p2", name: "Billing API", total: 1, perSession: [0, 1], health: [null, null], last: "2026-09-21" },
    ]);
  });

  it("finds blockers raised again, and whether an action follows them", () => {
    const out = recurringBlockers(
      [
        { personId: "a", name: "Alice", text: "No access to the staging database", date: "2026-09-14" },
        { personId: "a", name: "Alice", text: "Still no access to the staging database", date: "2026-09-21" },
        { personId: "b", name: "Bruno", text: "No access to the staging database", date: "2026-09-21" },
        { personId: "b", name: "Bruno", text: "Laptop is slow", date: "2026-09-14" },
      ],
      [{ ownerId: "a", text: "Get staging access", originText: "No access to the staging database" }],
    );
    expect(out).toEqual([
      {
        personId: "a",
        name: "Alice",
        text: "Still no access to the staging database",
        dates: ["2026-09-14", "2026-09-21"],
        withAction: true,
      },
    ]);
  });
});
