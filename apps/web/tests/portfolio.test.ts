import { describe, expect, it } from "vitest";
import { defaultDensity, sortProjects } from "@/lib/shared/portfolio";

// The portfolio from five projects to two hundred: its density and its order

const p = (name: string, patch: Partial<Parameters<typeof sortProjects>[0][number]> = {}) => ({
  name,
  health: null,
  targetDate: null,
  last: null,
  ...patch,
});

describe("portfolio", () => {
  it("is shown denser as it grows", () => {
    expect(defaultDensity(5)).toBe("cards");
    expect(defaultDensity(20)).toBe("list");
    expect(defaultDensity(200)).toBe("table");
  });
  it("sorts the projects in trouble first, then by name", () => {
    const list = [p("Zeta", { health: "onTrack" }), p("Beta", { health: "offTrack" }), p("Alpha", { health: "atRisk" }), p("Gamma")];
    expect(sortProjects(list, "health").map((x) => x.name)).toEqual(["Beta", "Alpha", "Gamma", "Zeta"]);
    expect(sortProjects(list, "name").map((x) => x.name)).toEqual(["Alpha", "Beta", "Gamma", "Zeta"]);
  });
  it("sorts by due date (none last) and by latest news", () => {
    const list = [p("A"), p("B", { targetDate: "2026-12-01", last: { date: "2026-10-01" } }), p("C", { targetDate: "2026-11-01" })];
    expect(sortProjects(list, "due").map((x) => x.name)).toEqual(["C", "B", "A"]);
    expect(sortProjects(list, "updated").map((x) => x.name)).toEqual(["B", "A", "C"]);
  });
});
