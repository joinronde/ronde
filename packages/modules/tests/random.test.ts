import { describe, expect, it } from "vitest";
import { drawOutcome, readDraw } from "../src/random";

// Random draws: the seed decides everything, so every screen replays the same outcome

const people = ["a", "b", "c", "d", "e"];

describe("drawOutcome", () => {
  it("gives the same outcome for the same seed", () => {
    for (const kind of ["wheel", "order", "teams", "coin"] as const)
      expect(drawOutcome(kind, people, "seed-1", 2)).toEqual(drawOutcome(kind, people, "seed-1", 2));
  });

  it("picks someone on the wheel, and every seed does not pick the same person", () => {
    const picks = new Set(Array.from({ length: 40 }, (_, i) => drawOutcome("wheel", people, `s${i}`).pick));
    for (const p of picks) expect(people).toContain(p);
    expect(picks.size).toBeGreaterThan(1);
  });

  it("keeps everyone once in a random order", () => {
    expect([...drawOutcome("order", people, "seed-2").order].sort()).toEqual(people);
  });

  it("deals teams whose sizes differ by one at most", () => {
    const { teams } = drawOutcome("teams", people, "seed-3", 2);
    expect(teams).toHaveLength(3);
    expect(teams.flat().sort()).toEqual(people);
    const sizes = teams.map((t) => t.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it("flips both sides of the coin", () => {
    const sides = new Set(Array.from({ length: 40 }, (_, i) => drawOutcome("coin", [], `c${i}`).tails));
    expect(sides).toEqual(new Set([true, false]));
  });
});

describe("readDraw", () => {
  it("rejects anything that is not a draw", () => {
    expect(readDraw(null)).toBeNull();
    expect(readDraw({ kind: "dice", seed: "x" })).toBeNull();
    expect(readDraw({ kind: "coin", seed: "x", tails: true })).toMatchObject({ kind: "coin", tails: true, entries: [], applied: false });
  });
});
