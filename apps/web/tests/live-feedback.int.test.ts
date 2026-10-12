import { prisma } from "@ronde/db";
import { beforeEach, describe, expect, it } from "vitest";
import { runOp } from "@/lib/server/meeting/ops";
import { type Fixture, meeting, workspace } from "./fixtures";

// What hosts asked for after a few meetings: modules that work as soon as they are turned on, the host taking
// part in topics and actions like everyone

let f: Fixture;
let n = 0;
beforeEach(async () => {
  f = await meeting(await workspace(`live-fb-${Date.now().toString(36)}-${++n}`), "Weekly");
  await prisma.session.update({ where: { id: f.sessionId }, data: { startedAt: null, stepKey: "intro", icebreaker: null } });
});

describe("the icebreaker", () => {
  it("has questions and a question for the session being prepared as soon as it is turned on", async () => {
    await prisma.moduleInstallation.deleteMany({ where: { meetingId: f.meetingId, moduleId: "icebreaker" } });
    await runOp(f.ctx, { op: "modules.set", moduleId: "icebreaker", enabled: true });
    const row = await prisma.moduleInstallation.findFirstOrThrow({ where: { meetingId: f.meetingId, moduleId: "icebreaker" } });
    expect((row.config as { bank: string[] }).bank.length).toBeGreaterThan(0);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } })).icebreaker).toBeTruthy();
  });
});

describe("topics", () => {
  it("take the vote of the person running the meeting, round or not", async () => {
    // A workspace owner running the meeting without being one of its participants
    await prisma.meetingParticipant.deleteMany({ where: { meetingId: f.meetingId, personId: f.hostPersonId } });
    const admin = { ...f.ctx, role: null, viewer: { ...f.ctx.viewer, memberId: null } };
    await runOp(admin, { op: "topic.vote", id: f.topicId });
    expect(await prisma.topicVote.count({ where: { topicId: f.topicId, personId: f.hostPersonId } })).toBe(1);
  });
});

describe("joining a line", () => {
  it("works on a line of someone's own round, not only on a project's", async () => {
    const item = await prisma.checkInItem.create({
      data: {
        workspaceId: f.workspaceId,
        meetingId: f.meetingId,
        personId: f.memberId,
        sectionKey: "done",
        role: "achievement",
        text: "Fixed the login bug",
      },
    });
    await runOp(f.ctx, {
      op: "item.with",
      ownerId: f.memberId,
      section: "done",
      itemText: "Fixed the login bug",
      projectId: null,
      on: true,
    });
    expect(await prisma.checkInItemContributor.count({ where: { itemId: item.id, personId: f.hostPersonId } })).toBe(1);
  });
});
