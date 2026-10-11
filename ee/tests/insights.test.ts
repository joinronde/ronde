// SPDX-License-Identifier: LicenseRef-Ronde-EE
import { describe, expect, it } from "vitest";
import { engagement } from "../src/insights";

describe("engagement", () => {
  it("weighs attendance, follow-through, participation, mood and punctuality", () => {
    expect(engagement({ attendance: 1, followThrough: 1, participation: 2, mood: 5, onTime: 1 })).toBe(100);
    expect(engagement({ attendance: 0, followThrough: 0, participation: 0, mood: 1, onTime: 0 })).toBe(0);
    // Half the attendance alone takes 15 of the 100 points
    expect(engagement({ attendance: 0.5, followThrough: 1, participation: 2, mood: 5, onTime: 1 })).toBe(85);
  });

  it("leaves out what is unknown, and caps participation", () => {
    expect(engagement({ attendance: 1, followThrough: null, participation: 10, mood: null, onTime: null })).toBe(100);
    expect(engagement({ attendance: null, followThrough: null, participation: null, mood: null, onTime: null })).toBeNull();
  });
});
