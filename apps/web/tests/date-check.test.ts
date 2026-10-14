import { describe, expect, it } from "vitest";
import { dateProblem } from "@/lib/shared/date-check";

// The date picker that replaced the native field let forms go out without a required day, or with a day out of
// its bounds (an absence ending before it starts): the browser no longer checked them

describe("what a form checks of a date field", () => {
  it("asks for a required day, and keeps the day within its bounds", () => {
    expect(dateProblem("", { required: true })).toEqual({ kind: "required" });
    expect(dateProblem("", {})).toBeNull();
    expect(dateProblem("2026-10-10", { min: "2026-10-15" })).toEqual({ kind: "tooEarly", bound: "2026-10-15" });
    expect(dateProblem("2026-12-01", { max: "2026-11-30" })).toEqual({ kind: "tooLate", bound: "2026-11-30" });
    expect(dateProblem("2026-10-15", { required: true, min: "2026-10-15", max: "2026-10-15" })).toBeNull();
  });
});
