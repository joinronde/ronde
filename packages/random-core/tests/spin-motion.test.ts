import { describe, expect, it } from "vitest";
import { buildSpinSamples, normalizeAngle, sectorJitter, settleOvershootFor, spinDistance, spinVelocity } from "../src/spin-motion";
import { planWheelSpin } from "../src/wheel-plan";

describe("normalizeAngle", () => {
  it("brings any angle back into [0, 360)", () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(359.9)).toBeCloseTo(359.9);
    expect(normalizeAngle(-1)).toBe(359);
    expect(normalizeAngle(-4681)).toBeCloseTo(normalizeAngle(-4681 + 13 * 360));
  });
});

describe("spinVelocity", () => {
  it("starts from rest and returns to it", () => {
    // A Bezier curve with x1 at 0 started at infinite speed: the wheel went from 0 to more than
    // 4000°/s in one frame.
    expect(spinVelocity(0)).toBe(0);
    expect(spinVelocity(1)).toBe(0);
  });

  it("speeds up then decays without ever stopping midway", () => {
    const samples = Array.from({ length: 99 }, (_, step) => spinVelocity((step + 1) / 100));
    const peakIndex = samples.indexOf(Math.max(...samples));

    expect(peakIndex).toBeGreaterThan(0);
    expect(peakIndex).toBeLessThan(20);
    for (let index = 1; index <= peakIndex; index += 1) expect(samples[index]).toBeGreaterThan(samples[index - 1]);
    for (let index = peakIndex + 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeLessThan(samples[index - 1]);
      expect(samples[index]).toBeGreaterThan(0);
    }
  });
});

describe("spinDistance", () => {
  it("covers exactly the whole travel, without going back", () => {
    expect(spinDistance(0)).toBe(0);
    expect(spinDistance(1)).toBe(1);
    let previous = -1;
    for (let step = 0; step <= 1; step += 0.01) {
      const value = spinDistance(step);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it("clamps values outside the range", () => {
    expect(spinDistance(-3)).toBe(0);
    expect(spinDistance(9)).toBe(1);
  });

  it("does not let the end of the travel drag on", () => {
    // The previous flaw: the wheel looked stopped, then crawled to its target.
    // Enough travel is left in the last 15 percent to stay readable.
    expect(1 - spinDistance(0.85)).toBeGreaterThan(0.005);
    expect(1 - spinDistance(0.85)).toBeLessThan(0.05);
    expect(spinDistance(0.5)).toBeGreaterThan(0.6);
  });
});

describe("buildSpinSamples", () => {
  it("links both angles while staying monotonic", () => {
    const samples = buildSpinSamples(0, 3600);

    expect(samples[0]).toEqual({ angle: 0, offset: 0 });
    expect(samples.at(-1)).toEqual({ angle: 3600, offset: 1 });
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index].offset).toBeGreaterThan(samples[index - 1].offset);
      expect(samples[index].angle).toBeGreaterThanOrEqual(samples[index - 1].angle);
    }
  });

  it("absorbs its settling overshoot within the same travel", () => {
    const samples = buildSpinSamples(0, 3600, { settleOvershoot: 5 });
    const angles = samples.map((sample) => sample.angle);

    // No second transition: the final angle stays the exact target.
    expect(angles.at(-1)).toBe(3600);
    expect(Math.max(...angles)).toBeGreaterThan(3600);
    expect(Math.max(...angles)).toBeLessThanOrEqual(3605.001);
  });

  it("overshoots in the direction of travel, even when rotating backwards", () => {
    const angles = buildSpinSamples(0, -3600, { settleOvershoot: 5 }).map((sample) => sample.angle);

    expect(angles.at(-1)).toBe(-3600);
    expect(Math.min(...angles)).toBeLessThan(-3600);
  });
});

describe("sectorJitter", () => {
  it("stays inside the sector with a clear margin", () => {
    for (const random of [0, 0.25, 0.5, 0.75, 1]) {
      expect(Math.abs(sectorJitter(60, random))).toBeLessThanOrEqual(60 * 0.28);
    }
    expect(sectorJitter(60, 0.5)).toBe(0);
    expect(sectorJitter(60, 0)).toBeLessThan(0);
    expect(sectorJitter(60, 1)).toBeGreaterThan(0);
  });

  it("clamps aberrant draws instead of leaving the sector", () => {
    expect(sectorJitter(60, 12)).toBe(sectorJitter(60, 1));
    expect(sectorJitter(60, -4)).toBe(sectorJitter(60, 0));
  });

  it("narrows the offset on request, for a wide moving part", () => {
    expect(Math.abs(sectorJitter(9.73, 1, 0.12))).toBeLessThan(Math.abs(sectorJitter(9.73, 1)));
  });
});

describe("settleOvershootFor", () => {
  it("stays subtle on wheels with many sectors", () => {
    expect(settleOvershootFor(360)).toBe(5);
    expect(settleOvershootFor(60)).toBeCloseTo(4.8);
    expect(settleOvershootFor(6)).toBeCloseTo(0.48);
  });
});

describe("planWheelSpin", () => {
  const randoms = { jitter: 0.5, turns: 10 };

  it("stops the wheel on the winning sector", () => {
    for (const index of [0, 1, 5, 7]) {
      const plan = planWheelSpin(0, index, 8, 7000, false, randoms);
      // The pointer is at the top: sector `index` must end up there.
      expect(normalizeAngle(plan.targetAngle)).toBeCloseTo(normalizeAngle(-index * 45), 6);
    }
  });

  it("stays accurate after several spins in a row", () => {
    let angle = 0;
    for (const index of [3, 3, 6, 0]) {
      const plan = planWheelSpin(angle, index, 8, 7000, false, randoms);
      expect(plan.targetAngle).toBeGreaterThan(angle);
      expect(normalizeAngle(plan.targetAngle)).toBeCloseTo(normalizeAngle(-index * 45), 6);
      angle = plan.targetAngle;
    }
  });

  it("keeps the stop inside the sector despite the random offset", () => {
    const sectorSize = 45;
    for (const jitter of [0, 0.5, 1]) {
      const plan = planWheelSpin(0, 2, 8, 7000, false, { jitter, turns: 10 });
      const offset = normalizeAngle(plan.targetAngle - normalizeAngle(-2 * sectorSize));
      const signed = offset > 180 ? offset - 360 : offset;
      // Safety margin kept up to the edges, overshoot included.
      expect(Math.abs(signed) + settleOvershootFor(sectorSize)).toBeLessThan(sectorSize / 2);
    }
  });

  it("shortens the travel a lot with reduced motion", () => {
    const reduced = planWheelSpin(0, 2, 8, 7000, true, randoms);
    const normal = planWheelSpin(0, 2, 8, 7000, false, randoms);

    expect(reduced.duration).toBeLessThanOrEqual(600);
    expect(normal.duration).toBe(7000);
    expect(reduced.targetAngle).toBeLessThan(normal.targetAngle);
    // The result is still reached and shown: only the staging is reduced.
    expect(normalizeAngle(reduced.targetAngle)).toBeCloseTo(normalizeAngle(-2 * 45), 6);
    // No settling overshoot: it makes no sense on a shortened travel.
    expect(Math.max(...reduced.samples.map((sample) => sample.angle))).toBeLessThanOrEqual(reduced.targetAngle);
  });
});
