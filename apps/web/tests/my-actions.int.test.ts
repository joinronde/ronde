import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { runOp } from "@/lib/server/meeting/ops";
import { listActions, openActionCount } from "@/lib/server/my-actions";
import { type Fixture, meeting, workspace } from "./fixtures";

// Follow-up actions across meetings: the person's own, and those of the meetings they run

let f: Fixture;

beforeAll(async () => {
  f = await meeting(await workspace("my-actions"), "Weekly");
  await prisma.session.createMany({
    data: ["2029-12-03", "2029-12-10", "2029-12-17"].map((date) => ({
      workspaceId: f.workspaceId,
      meetingId: f.meetingId,
      date,
      time: "10:00",
      status: "archived" as const,
      occurrenceKey: `old:${date}`,
    })),
  });
  await prisma.action.create({
    data: { workspaceId: f.workspaceId, meetingId: f.meetingId, text: "mine", ownerId: f.hostPersonId, originDate: "2029-12-03" },
  });
  // Another workspace: never listed
  const other = await meeting(await workspace("my-actions-other"), "Elsewhere");
  await prisma.action.create({
    data: { workspaceId: other.workspaceId, meetingId: other.meetingId, text: "elsewhere", ownerId: other.hostPersonId },
  });
});

describe("actions across meetings", () => {
  it("lists the person's own actions, with the sessions held since", async () => {
    const mine = await listActions(f.ctx.ws, "mine");
    expect(mine.map((a) => [a.text, a.carried])).toEqual([["mine", 2]]);
    expect(await openActionCount(f.ctx.ws)).toBe(1);
  });

  it("lists every action of the meetings the person runs", async () => {
    const hosted = await listActions(f.ctx.ws, "hosted");
    expect(hosted.map((a) => a.text).sort()).toEqual(["action", "mine"]);
  });

  it("keeps a done action listed for a while, out of the count", async () => {
    const id = (await listActions(f.ctx.ws, "mine"))[0]!.id;
    await runOp(f.ctx, { op: "action.update", id, status: "done" });
    const [done] = await listActions(f.ctx.ws, "mine");
    expect(done).toMatchObject({ status: "done", carried: 0 });
    expect(await openActionCount(f.ctx.ws)).toBe(0);
  });

  it("leaves an action done long ago off the page, but keeps it for the export", async () => {
    const [done] = await listActions(f.ctx.ws, "mine");
    await prisma.action.update({ where: { id: done!.id }, data: { doneAt: new Date(Date.now() - 30 * 86_400_000) } });
    expect(await listActions(f.ctx.ws, "mine")).toHaveLength(0);
    expect((await listActions(f.ctx.ws, "mine", { all: true })).map((a) => a.id)).toEqual([done!.id]);
  });
});
