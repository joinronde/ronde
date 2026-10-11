import { describe, expect, it } from "vitest";
import { type AgendaBlock, roundsOrder, withRoundsOrder } from "../src/agenda";

// A meeting with a round table and a project round opens with the one its host picked

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
