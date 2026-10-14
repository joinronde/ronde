import { describe, expect, it } from "vitest";
import { isTeamIcon, TEAM_ICONS } from "@/lib/shared/team-icons";
import { teamAndBelow, teamOptions, teamPath } from "@/lib/shared/teams";

// Teams inside teams: picking a department picks its squads, the directory names a team by its path, the tree
// lists a parent before its children and never loses a team

const team = (id: string, parentId: string | null = null) => ({ id, name: id.toUpperCase(), parentId });
const teams = [team("product"), team("design", "product"), team("ux", "design"), team("ops"), team("orphan", "gone")];

describe("teamAndBelow", () => {
  it("takes a team and everything under it", () => {
    expect([...teamAndBelow(teams, "product")].sort()).toEqual(["design", "product", "ux"]);
    expect([...teamAndBelow(teams, "ux")]).toEqual(["ux"]);
  });
});

describe("teamPath", () => {
  it("names a team from the top down", () => {
    expect(teamPath(teams, "ux")).toBe("PRODUCT › DESIGN › UX");
    expect(teamPath(teams, "ops")).toBe("OPS");
    expect(teamPath(teams, null)).toBe("");
  });
  it("stops once round a loop", () => {
    expect(teamPath([team("a", "b"), team("b", "a")], "a")).toBe("B › A");
  });
});

describe("teamOptions", () => {
  it("lists a parent before its children, with their depth", () => {
    expect(teamOptions(teams).map(({ team: t, depth }) => `${depth}:${t.id}`)).toEqual([
      "0:product",
      "1:design",
      "2:ux",
      "0:ops",
      "0:orphan",
    ]);
  });
  it("keeps the teams of a loop rather than dropping them", () => {
    expect(teamOptions([team("a", "b"), team("b", "a")]).map(({ team: t, depth }) => `${depth}:${t.id}`)).toEqual(["0:a", "1:b"]);
  });
});

describe("team icons", () => {
  it("knows its drawings and nothing else", () => {
    expect(TEAM_ICONS.every(isTeamIcon)).toBe(true);
    expect(isTeamIcon("dragon")).toBe(false);
    expect(isTeamIcon(3)).toBe(false);
  });
});
