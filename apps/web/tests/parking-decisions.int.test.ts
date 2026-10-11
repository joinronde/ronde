import { parseRecord } from "@ronde/core/record";
import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { decisionLog } from "@/lib/server/meeting/decisions";
import { runOp } from "@/lib/server/meeting/ops";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { type Fixture, meeting, workspace } from "./fixtures";

// Parking lot (set aside, archived, then an open topic of the next session) and decision log

let f: Fixture;

beforeAll(async () => {
  f = await meeting(await workspace("parking"), "Weekly");
  // Off in a new meeting: turned on from the catalog
  await runOp(f.ctx, { op: "modules.set", moduleId: "parking", enabled: true });
});

describe("parking lot", () => {
  it("keeps parked subjects apart from today's topics", async () => {
    await runOp(f.ctx, { op: "parking.add", text: "Office move" });
    await runOp(f.ctx, { op: "parking.add", text: "Budget 2027" });
    const snap = await loadSnapshot(f.ctx);
    expect(snap.parking.map((x) => x.text)).toEqual(["Office move", "Budget 2027"]);
    expect(snap.topics.some((x) => x.parked)).toBe(false);
    // One of them is discussed today after all
    await runOp(f.ctx, { op: "parking.discuss", id: snap.parking[1]!.id });
    const after = await loadSnapshot(f.ctx);
    expect(after.parking.map((x) => x.text)).toEqual(["Office move"]);
    expect(after.topics.map((x) => x.text)).toContain("Budget 2027");
  });

  it("shows parked subjects as topics when the module is off", async () => {
    await prisma.moduleInstallation.update({
      where: { meetingId_moduleId: { meetingId: f.meetingId, moduleId: "parking" } },
      data: { enabled: false },
    });
    const snap = await loadSnapshot(f.ctx);
    expect(snap.parking).toEqual([]);
    expect(snap.topics.map((x) => x.text)).toContain("Office move");
    await prisma.moduleInstallation.update({
      where: { meetingId_moduleId: { meetingId: f.meetingId, moduleId: "parking" } },
      data: { enabled: true },
    });
  });

  it("archives the parking lot, then makes it an open topic of the next session", async () => {
    await prisma.note.create({
      data: { workspaceId: f.workspaceId, sessionId: f.sessionId, key: "misc", text: "Decision: rota every month" },
    });
    await runOp(f.ctx, { op: "meeting.goto", key: "end" }).catch(() => undefined);
    await runOp(f.ctx, { op: "meeting.archive", summary: null, omit: [] });
    const record = parseRecord((await prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } })).record)!;
    expect(record.parking.map((x) => x.text)).toEqual(["Office move"]);
    expect(record.topics.map((x) => x.text)).not.toContain("Office move");
    const topic = await prisma.topic.findFirstOrThrow({ where: { meetingId: f.meetingId, text: "Office move" } });
    expect(topic.parked).toBe(false);
  });
});

describe("decision log", () => {
  it("lists the decisions of the archived sessions, and searches them", async () => {
    expect(await decisionLog(f.ctx.ws.db, f.meetingId, "en")).toContainEqual({
      date: expect.any(String),
      text: "rota every month",
      context: "(Open topics)",
    });
    expect(await decisionLog(f.ctx.ws.db, f.meetingId, "fr", "ROTA")).toHaveLength(1);
    expect(await decisionLog(f.ctx.ws.db, f.meetingId, "en", "budget")).toEqual([]);
  });
});
