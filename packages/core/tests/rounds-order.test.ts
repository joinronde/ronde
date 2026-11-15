import { describe, expect, it } from "vitest";
import { type AgendaBlock, roundsChoiceOf, roundsOrder, withRounds, withRoundsOrder } from "../src/agenda";

// A meeting with a round table and a project round opens with the one its host picked, or keeps only one of them

const blocks: AgendaBlock[] = [
  { id: "intro", type: "intro" },
  { id: "round", type: "round" },
  { id: "projects", type: "projects", order: "manual" },
  { id: "topics", type: "topics" },
];

describe("rounds order", () => {
  it("tells which round comes first, only when there are both", () => {
    expect(roundsOrder(blocks)).toBe("team");
    expect(roundsOrder(blocks.filter((b) => b.type !== "projects"))).toBeNull();
    expect(roundsOrder(undefined)).toBeNull();
  });

  it("swaps the two rounds, the other steps staying where they are", () => {
    expect(withRoundsOrder(blocks, "projects").map((b) => b.id)).toEqual(["intro", "projects", "round", "topics"]);
    expect(withRoundsOrder(blocks, "team")).toBe(blocks);
  });
});

describe("rounds choice", () => {
  const ids = (choice: Parameters<typeof withRounds>[1], from = blocks) => withRounds(from, choice).map((b) => b.id);

  it("starts from the template's order, only when there are both rounds", () => {
    expect(roundsChoiceOf(blocks)).toBe("teamFirst");
    expect(roundsChoiceOf(withRoundsOrder(blocks, "projects"))).toBe("projectsFirst");
    expect(roundsChoiceOf(blocks.filter((b) => b.type !== "round"))).toBeNull();
    expect(roundsChoiceOf(undefined)).toBeNull();
  });

  it("keeps both rounds in the order picked, or only the one picked", () => {
    expect(ids("teamFirst")).toEqual(["intro", "round", "projects", "topics"]);
    expect(ids("projectsFirst")).toEqual(["intro", "projects", "round", "topics"]);
    expect(ids("teamOnly")).toEqual(["intro", "round", "topics"]);
    expect(ids("projectsOnly")).toEqual(["intro", "projects", "topics"]);
  });

  it("leaves an agenda without both rounds as it is", () => {
    const teamAlone = blocks.filter((b) => b.type !== "projects");
    expect(withRounds(teamAlone, "projectsOnly")).toBe(teamAlone);
    expect(withRounds(teamAlone, "projectsFirst")).toBe(teamAlone);
  });
});
