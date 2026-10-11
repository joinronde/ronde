import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { runOp } from "@/lib/server/meeting/ops";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { type Fixture, meeting, workspace } from "./fixtures";

// Random tools: the server draws, the outcome reaches every screen, the host applies it to the speaking order

let f: Fixture;
const ids = ["p1", "p2", "p3", "p4"];

beforeAll(async () => {
  f = await meeting(await workspace("random"), "Weekly");
  const people = await Promise.all(
    ids.map((id) =>
      prisma.person.create({
        data: { workspaceId: f.workspaceId, firstName: id, lastName: "Random", email: `${id}-${f.workspaceId}@random.test` },
      }),
    ),
  );
  for (const [i, p] of people.entries())
    await prisma.meetingParticipant.create({
      data: { workspaceId: f.workspaceId, meetingId: f.meetingId, personId: p.id, position: i + 10 },
    });
  const order = [f.memberId, ...people.map((p) => p.id)];
  await prisma.session.update({
    where: { id: f.sessionId },
    data: { order, absent: [people[3]!.id], stepKey: "intro", spent: {}, draw: undefined },
  });
  // Off in a new meeting: turned on from the catalog
  await runOp(f.ctx, { op: "modules.set", moduleId: "random", enabled: true });
});

describe("random tools", () => {
  it("spins the wheel among the people present, then gives them the next turn", async () => {
    await runOp(f.ctx, { op: "random.draw", kind: "wheel", teamSize: 2 });
    const s = await prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } });
    const draw = (await loadSnapshot(f.ctx)).meeting!.draw!;
    expect(draw.kind).toBe("wheel");
    expect(draw.entries).toHaveLength(4);
    expect(draw.entries).not.toContain(s.absent[0]);
    expect(draw.entries).toContain(draw.pick);
    await runOp(f.ctx, { op: "random.apply" });
    const after = await prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } });
    expect(after.order[0]).toBe(draw.pick);
    // The absent person stays in the order, at the end
    expect(after.order.at(-1)).toBe(s.absent[0]);
    expect(after.order).toHaveLength(5);
  });

  it("deals teams and refuses to apply them to the order", async () => {
    await runOp(f.ctx, { op: "random.draw", kind: "teams", teamSize: 2 });
    const draw = (await loadSnapshot(f.ctx)).meeting!.draw!;
    expect(draw.teams.flat()).toHaveLength(4);
    await expect(runOp(f.ctx, { op: "random.apply" })).rejects.toMatchObject({ key: "notFound" });
  });

  it("disappears when the module is off, and on the next step", async () => {
    await prisma.moduleInstallation.upsert({
      where: { meetingId_moduleId: { meetingId: f.meetingId, moduleId: "random" } },
      create: { workspaceId: f.workspaceId, meetingId: f.meetingId, moduleId: "random", enabled: false, config: {} },
      update: { enabled: false },
    });
    expect((await loadSnapshot(f.ctx)).meeting!.draw).toBeNull();
    await expect(runOp(f.ctx, { op: "random.draw", kind: "coin", teamSize: 2 })).rejects.toMatchObject({ status: 403 });
    await prisma.moduleInstallation.update({
      where: { meetingId_moduleId: { meetingId: f.meetingId, moduleId: "random" } },
      data: { enabled: true },
    });
    await runOp(f.ctx, { op: "random.clear" });
    expect((await loadSnapshot(f.ctx)).meeting!.draw).toBeNull();
  });
});
