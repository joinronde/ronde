import { describe, expect, it, vi } from "vitest";
import { coinTargetRotation, rouletteTargetRotation, secureRandomInt, wheelTargetRotation } from "../src/game-random";

describe("game randomness and landing maths", () => {
  it("uses an unbiased crypto value within the requested range", () => {
    const getRandomValues = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((values) => {
      (values as Uint32Array)[0] = 42;
      return values;
    });

    expect(secureRandomInt(37)).toBe(5);
    expect(getRandomValues).toHaveBeenCalledTimes(1);
    getRandomValues.mockRestore();
  });

  it("lands successive roulette spins on the exact selected segment", () => {
    const count = 37;
    const first = rouletteTargetRotation(0, 7, count);
    const second = rouletteTargetRotation(first, 7, count);
    const expectedModulo = (360 - (7 * (360 / count) + 360 / count / 2)) % 360;

    expect(((first % 360) + 360) % 360).toBeCloseTo(expectedModulo);
    expect(((second % 360) + 360) % 360).toBeCloseTo(expectedModulo);
    expect(second).toBeGreaterThan(first);
  });

  it("keeps cumulative coin rotations correct for repeated results", () => {
    const firstHeads = coinTargetRotation(0, false);
    const secondHeads = coinTargetRotation(firstHeads, false);
    const tails = coinTargetRotation(secondHeads, true);

    expect(firstHeads % 360).toBe(0);
    expect(secondHeads % 360).toBe(0);
    expect(tails % 360).toBe(180);
    expect(tails).toBeGreaterThan(secondHeads);
  });

  it("keeps successive custom-wheel results aligned with the pointer", () => {
    const first = wheelTargetRotation(0, 2, 8, 8);
    const second = wheelTargetRotation(first, 2, 8, 8);
    const third = wheelTargetRotation(second, 7, 8, 8);

    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expect(((second % 360) + 360) % 360).toBe(270);
    expect(((third % 360) + 360) % 360).toBe(45);
  });
});
