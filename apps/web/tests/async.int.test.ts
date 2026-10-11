import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { closeAsyncSessions, sendDigest } from "@/lib/server/meeting/async";
import { runOp } from "@/lib/server/meeting/ops";
import { type Fixture, meeting, workspace } from "./fixtures";

// Async mode: sessions without a live meeting are archived at their planned time, once, and their digest goes out

let f: Fixture;

const asyncModule = (enabled: boolean) =>
  prisma.moduleInstallation.upsert({
    where: { meetingId_moduleId: { meetingId: f.meetingId, moduleId: "async" } },
    create: { workspaceId: f.workspaceId, meetingId: f.meetingId, moduleId: "async", enabled, config: {} },
    update: { enabled },
  });

beforeAll(async () => {
  f = await meeting(await workspace("async"), "Weekly written");
});

describe("async mode", () => {
  it("publishes the digest from the control room only when the module is on", async () => {
    await expect(runOp(f.ctx, { op: "meeting.publish" })).rejects.toMatchObject({ status: 403 });
    await asyncModule(true);
    await prisma.session.update({ where: { id: f.sessionId }, data: { startedAt: new Date() } });
    await expect(runOp(f.ctx, { op: "meeting.publish" })).rejects.toMatchObject({ key: "publishLive" });
    await prisma.session.update({ where: { id: f.sessionId }, data: { startedAt: null } });
    await runOp(f.ctx, { op: "meeting.publish" });
    const s = await prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } });
    expect(s.status).toBe("archived");
    expect(s.record).toMatchObject({ v: 1 });
    expect(await sendDigest(f.meetingId, f.sessionId)).toBeGreaterThan(0);
  });

  it("closes the sessions whose time has come, once", async () => {
    const next = await prisma.session.findFirstOrThrow({ where: { meetingId: f.meetingId, status: "current" } });
    await prisma.session.update({ where: { id: next.id }, data: { startsAt: new Date(Date.now() + 3_600_000) } });
    expect(await closeAsyncSessions()).toBe(0);
    await prisma.session.update({ where: { id: next.id }, data: { startsAt: new Date(Date.now() - 60_000) } });
    const [a, b] = await Promise.all([closeAsyncSessions(), closeAsyncSessions()]);
    expect(a + b).toBe(1);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: next.id } })).status).toBe("archived");
  });

  it("leaves meetings without the module alone", async () => {
    await asyncModule(false);
    const current = await prisma.session.findFirst({ where: { meetingId: f.meetingId, status: "current" } });
    if (current) await prisma.session.update({ where: { id: current.id }, data: { startsAt: new Date(Date.now() - 60_000) } });
    expect(await closeAsyncSessions()).toBe(0);
  });
});
