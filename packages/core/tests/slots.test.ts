import { freeSlots, overlaps } from "@ronde/core/slots";
import { describe, expect, it } from "vitest";

// "Find a slot": the first free time of each working day, in the meeting's time zone

const at = (iso: string) => Date.parse(iso);

describe("free slots", () => {
  it("skips busy times and weekends, one proposal per day", () => {
    // Monday January 7, 2030, Paris (UTC+1): busy 9:00-10:30 local
    const busy = [{ start: at("2030-01-07T08:00:00Z"), end: at("2030-01-07T09:30:00Z") }];
    const slots = freeSlots(busy, { from: at("2030-01-07T00:00:00Z"), days: 7, durationMin: 30, timeZone: "Europe/Paris" });
    expect(slots.map((s) => `${s.date} ${s.time}`)).toEqual([
      "2030-01-07 10:30",
      "2030-01-08 09:00",
      "2030-01-09 09:00",
      "2030-01-10 09:00",
      "2030-01-11 09:00",
    ]);
    expect(slots[0]!.startsAt).toBe(at("2030-01-07T09:30:00Z"));
  });

  it("finds nothing when the day is full, and detects overlaps", () => {
    const busy = [{ start: at("2030-01-07T08:00:00Z"), end: at("2030-01-07T17:00:00Z") }];
    expect(freeSlots(busy, { from: at("2030-01-07T00:00:00Z"), days: 1, durationMin: 60, timeZone: "Europe/Paris" })).toEqual([]);
    expect(overlaps(at("2030-01-07T09:00:00Z"), at("2030-01-07T10:00:00Z"), busy)).toBe(true);
  });
});

describe("margin between meetings", () => {
  it("keeps the margin free around busy times", async () => {
    const { freeSlots } = await import("../src/slots");
    const from = Date.parse("2026-10-12T07:00:00Z");
    // Busy 09:00-10:00 Paris (07:00-08:00 UTC); a 30 min meeting starts at 10:00, or 10:15 with a 15 min margin
    const busy = [{ start: Date.parse("2026-10-12T07:00:00Z"), end: Date.parse("2026-10-12T08:00:00Z") }];
    const q = { from, days: 1, durationMin: 30, timeZone: "Europe/Paris", stepMin: 15, limit: 1 };
    expect(freeSlots(busy, q)[0]?.time).toBe("10:00");
    expect(freeSlots(busy, { ...q, bufferMin: 15 })[0]?.time).toBe("10:15");
  });
});
