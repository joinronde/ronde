import { describe, expect, it } from "vitest";
import { createRacePlan, raceProgressAt } from "../src/race-engine";

describe("race engine", () => {
  it("precomputes a reproducible monotone race with the declared finish order", () => {
    const ids = ["a", "b", "c", "d"];
    const plan = createRacePlan(ids, "horse", "race-seed");
    expect(plan).toEqual(createRacePlan(ids, "horse", "race-seed"));
    for (const lane of plan.lanes) {
      for (let index = 1; index < lane.samples.length; index += 1) {
        expect(lane.samples[index].progress).toBeGreaterThanOrEqual(lane.samples[index - 1].progress);
      }
    }
    const byFinish = [...plan.lanes]
      .sort((left, right) => left.finishOffset - right.finishOffset)
      .map(({ participantId }) => participantId);
    expect(byFinish).toEqual(plan.ranking);
  });

  it("interpolates independently of sampling frequency", () => {
    const plan = createRacePlan(["a", "b"], "rocket", "interpolation");
    const halfway = raceProgressAt(plan, "a", plan.durationMs / 2);
    expect(halfway).toBeGreaterThan(0);
    expect(halfway).toBeLessThan(1);
    expect(raceProgressAt(plan, "a", plan.durationMs)).toBe(1);
  });
});
