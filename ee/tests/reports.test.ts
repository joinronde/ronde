// SPDX-License-Identifier: LicenseRef-Ronde-EE
import type { InsightsDTO } from "@ronde/editions/ee";
import { describe, expect, it } from "vitest";
import { due, email } from "../src/reports";

describe("report schedule", () => {
  it("sends the week before on Monday morning, once per week", () => {
    expect(due("weekly", { date: "2026-10-05", minutes: 7 * 60 })).toBeNull();
    expect(due("weekly", { date: "2026-10-05", minutes: 8 * 60 })).toEqual({ key: "W:2026-10-05", from: "2026-09-28", to: "2026-10-04" });
    expect(due("weekly", { date: "2026-10-06", minutes: 9 * 60 })).toBeNull();
  });

  it("sends the month before on the 1st", () => {
    expect(due("monthly", { date: "2026-10-01", minutes: 9 * 60 })).toEqual({ key: "M:2026-10", from: "2026-09-01", to: "2026-09-30" });
    expect(due("monthly", { date: "2026-03-01", minutes: 9 * 60 })).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(due("monthly", { date: "2026-10-02", minutes: 9 * 60 })).toBeNull();
  });
});

describe("report email", () => {
  const data: InsightsDTO = {
    from: "2026-09-28",
    to: "2026-10-04",
    totals: {
      sessions: 3,
      meetings: 1,
      attendance: 0.9,
      onTime: 1,
      followThrough: 0.5,
      mood: 4,
      actionsCreated: 2,
      actionsDone: 1,
      medianDays: 3,
      engagement: 72,
    },
    weeks: [],
    meetings: [
      {
        id: "m",
        name: "Weekly <sync>",
        sessions: 3,
        attendance: 0.9,
        onTime: 1,
        followThrough: 0.5,
        participation: 1,
        mood: 4,
        openActions: 1,
        engagement: 72,
        trend: [],
      },
    ],
  };

  it("carries the figures in the workspace's language, nothing injected", () => {
    const en = email(data, { locale: "en", workspace: "Acme", url: "https://ronde.example/w/acme/insights" });
    expect(en.subject).toBe("Acme · your meetings, Monday, September 28 to Sunday, October 4");
    expect(en.text).toContain("Engagement: 72 / 100");
    expect(en.html).toContain("Weekly &lt;sync&gt;");
    const fr = email(data, { locale: "fr", workspace: "Acme", url: "" });
    expect(fr.subject).toContain("vos réunions");
  });
});
