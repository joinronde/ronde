import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { runOp } from "@/lib/server/meeting/ops";
import { kudosWall, meetingsOverview, workspaceDecisions } from "@/lib/server/overview";
import { type Fixture, meeting, workspace } from "./fixtures";

// The meetings page and the decisions of the workspace

let f: Fixture;

beforeAll(async () => {
  f = await meeting(await workspace("overview"), "Platform sync");
  await meeting(await workspace("overview-other"), "Elsewhere");
});

describe("meetings overview", () => {
  it("counts people, open actions and sessions of each meeting", async () => {
    const [m] = await meetingsOverview(f.ctx.ws, "en");
    expect(m).toMatchObject({ name: "Platform sync", role: "host", peopleCount: 2, openActions: 1, color: 0 });
    expect(m?.people.map((p) => p.id).sort()).toEqual([f.hostPersonId, f.memberId].sort());
    expect(await meetingsOverview(f.ctx.ws, "en")).toHaveLength(1);
  });
});

describe("workspace decisions", () => {
  it("gathers the decisions noted in archived sessions, and searches them", async () => {
    await prisma.note.create({
      data: { workspaceId: f.workspaceId, sessionId: f.sessionId, key: "misc", text: "Decision: move the platform sync to Tuesdays" },
    });
    await runOp(f.ctx, { op: "meeting.goto", key: "end" }).catch(() => undefined);
    await runOp(f.ctx, { op: "meeting.archive", summary: null, omit: [] });
    const all = await workspaceDecisions(f.ctx.ws, "en");
    expect(all.map((d) => [d.meeting, d.text])).toContainEqual(["Platform sync", "move the platform sync to Tuesdays"]);
    expect(await workspaceDecisions(f.ctx.ws, "en", "tuesdays")).toHaveLength(1);
    expect(await workspaceDecisions(f.ctx.ws, "en", "nothing like this")).toHaveLength(0);
    // The export asks for more than the page shows
    expect(await workspaceDecisions(f.ctx.ws, "en", "", 0)).toHaveLength(0);
  });
});

describe("kudos wall", () => {
  it("pins the thanks of the workspace, with who gave and who received them", async () => {
    await runOp(f.ctx, { op: "kudos.add", toId: f.memberId, text: "Great onboarding guide" });
    const wall = await kudosWall(f.ctx.ws);
    expect(wall.kudos[0]).toMatchObject({ text: "Great onboarding guide", meeting: "Platform sync" });
    expect(wall.kudos[0]?.from.id).toBe(f.hostPersonId);
    expect(wall.kudos[0]?.to.id).toBe(f.memberId);
    expect(wall.month.given).toBeGreaterThanOrEqual(1);
  });
});
