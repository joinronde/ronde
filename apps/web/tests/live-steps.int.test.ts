import { prisma } from "@ronde/db";
import { beforeEach, describe, expect, it } from "vitest";
import { runOp } from "@/lib/server/meeting/ops";
import { type Fixture, meeting, workspace } from "./fixtures";

// The live session's steps: a press made from a step already left moves nothing, and a speaker leaving the
// round during their turn hands over to the next step

let f: Fixture;
let n = 0;
const step = async () => (await prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } })).stepKey;

beforeEach(async () => {
  f = await meeting(await workspace(`steps-${Date.now().toString(36)}-${++n}`), "Weekly");
  // The host speaks first, then the other person; the session stands on the host's turn
  await prisma.session.update({ where: { id: f.sessionId }, data: { stepKey: f.hostPersonId, order: [f.hostPersonId, f.memberId] } });
});

describe("live steps", () => {
  it("move once for two presses made from the same step", async () => {
    await runOp(f.ctx, { op: "meeting.step", delta: 1, from: f.hostPersonId });
    expect(await step()).toBe(f.memberId);
    // The second click of a double click, or the co-host pressing at the same time
    await runOp(f.ctx, { op: "meeting.step", delta: 1, from: f.hostPersonId });
    expect(await step()).toBe(f.memberId);
  });

  it("go on to the next step when the person speaking is removed", async () => {
    await prisma.session.update({ where: { id: f.sessionId }, data: { stepKey: f.memberId } });
    const before = await step();
    await runOp(f.ctx, { op: "participant.remove", id: f.memberId });
    const after = await step();
    expect(after).not.toBe(before);
    expect(after).not.toBe(f.hostPersonId);
  });
});
