import { describe, expect, it } from "vitest";
import type { Participant } from "../src/random-tool-types";
import { generateTeams, moveParticipant } from "../src/team-generator-engine";

const participants = (count: number): Participant[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    name: `Participant ${index}`,
    ratings: { skill: (1 + (index % 5)) as 1 },
  }));

describe("team generator engine", () => {
  it("creates reproducible teams whose sizes differ by at most one", () => {
    const input = { participants: participants(11), sizingMode: "team-count" as const, size: 3, teamNames: [], seed: "teams" };
    const first = generateTeams(input);
    const second = generateTeams(input);
    expect(first).toEqual(second);
    expect(first.status).toBe("success");
    if (first.status !== "success") return;
    const sizes = first.plan.teams.map((team) => team.participantIds.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    expect(new Set(first.plan.teams.flatMap((team) => team.participantIds))).toHaveLength(11);
  });

  it("honours together and apart constraints", () => {
    const result = generateTeams({
      participants: participants(8),
      sizingMode: "team-count",
      size: 2,
      teamNames: [],
      seed: "constraints",
      constraints: [
        { type: "together", participantIds: ["p0", "p1"] },
        { type: "apart", participantIds: ["p2", "p3"] },
      ],
    });
    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    const teamOf = (id: string) => result.plan.teams.findIndex((team) => team.participantIds.includes(id));
    expect(teamOf("p0")).toBe(teamOf("p1"));
    expect(teamOf("p2")).not.toBe(teamOf("p3"));
  });

  it("distinguishes conflicting rules from an impossible capacity", () => {
    expect(
      generateTeams({
        participants: participants(4),
        sizingMode: "team-count",
        size: 2,
        teamNames: [],
        seed: "conflict",
        constraints: [
          { type: "together", participantIds: ["p0", "p1"] },
          { type: "apart", participantIds: ["p0", "p1"] },
        ],
      }).status,
    ).toBe("invalid_rules");
    expect(
      generateTeams({
        participants: participants(4),
        sizingMode: "team-count",
        size: 3,
        teamNames: [],
        seed: "capacity",
        constraints: [
          { type: "together", participantIds: ["p0", "p1"] },
          { type: "together", participantIds: ["p1", "p2"] },
        ],
      }).status,
    ).toBe("unsatisfiable");
  });

  it("supports people-per-team sizing and deterministic weighted balancing", () => {
    const input = {
      participants: participants(10),
      sizingMode: "members-per-team" as const,
      size: 3,
      teamNames: [],
      seed: "weighted",
      criteria: [{ id: "skill", name: "Skill", weight: 3 as const }],
    };
    const first = generateTeams(input);
    expect(first).toEqual(generateTeams(input));
    expect(first.status).toBe("success");
    if (first.status !== "success") return;
    expect(first.plan.teams.map(({ participantIds }) => participantIds.length)).toEqual([3, 3, 2, 2]);
  });

  it("preserves locks on redistribution and reports an exhausted search budget", () => {
    const initial = generateTeams({
      participants: participants(6),
      sizingMode: "team-count",
      size: 2,
      teamNames: [],
      seed: "initial",
    });
    expect(initial.status).toBe("success");
    if (initial.status !== "success") return;
    const lockedId = initial.plan.teams[0].participantIds[0];
    const regenerated = generateTeams({
      participants: participants(6),
      sizingMode: "team-count",
      size: 2,
      teamNames: [],
      seed: "next",
      lockedTeams: initial.plan.teams,
      lockedParticipantIds: [lockedId],
    });
    expect(regenerated.status).toBe("success");
    if (regenerated.status === "success") {
      expect(regenerated.plan.teams[0].participantIds).toContain(lockedId);
    }
    expect(
      generateTeams({
        participants: participants(6),
        sizingMode: "team-count",
        size: 2,
        teamNames: [],
        seed: "limited",
        criteria: [{ id: "skill", name: "Skill", weight: 1 }],
        searchBudget: 1,
      }).status,
    ).toBe("search_limit_reached");
  });

  it("moves linked participants only when capacity, locks and apart rules allow it", () => {
    const generated = generateTeams({
      participants: participants(5),
      sizingMode: "team-count",
      size: 2,
      teamNames: [],
      seed: "move",
    });
    expect(generated.status).toBe("success");
    if (generated.status !== "success") return;
    const [larger, smaller] = [...generated.plan.teams].sort((left, right) => right.participantIds.length - left.participantIds.length);
    const movingId = larger.participantIds[0];
    const moved = moveParticipant(generated.plan, movingId, smaller.id);
    expect(moved?.teams.find(({ id }) => id === smaller.id)?.participantIds).toContain(movingId);
    expect(moveParticipant({ ...generated.plan, lockedParticipantIds: [movingId] }, movingId, smaller.id)).toBeNull();
    expect(
      moveParticipant(generated.plan, movingId, smaller.id, [{ type: "apart", participantIds: [movingId, smaller.participantIds[0]] }]),
    ).toBeNull();
  });
});
