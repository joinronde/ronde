import { buildMinutes, minutesToMarkdown } from "@ronde/core/minutes";
import { can } from "@ronde/core/permissions";
import { parseRecord } from "@ronde/core/record";
import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import type { MeetingCtx } from "@/lib/server/meeting/context";
import { runOp } from "@/lib/server/meeting/ops";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { meetingStats } from "@/lib/server/meeting/stats";
import { type Fixture, meeting, workspace } from "./fixtures";

// The usefulness vote: rated from 1 to 5 at the wrap-up, anonymous (each person sees their own vote, the room
// the counts once three people have voted), kept in the archived record, its minutes and the meeting's stats

let f: Fixture;
let member: MeetingCtx;

/** The meeting as its member, a plain participant */
function asParticipant(t: Fixture): MeetingCtx {
  const principal = { ...t.ctx.ws.principal, personId: t.memberId, workspaceRole: "member" as const };
  return {
    ...t.ctx,
    role: "participant",
    ws: { ...t.ctx.ws, member: { ...t.ctx.ws.member, personId: t.memberId, role: "member" }, principal, can: (p) => can(principal, p) },
    viewer: { ...t.ctx.viewer, personId: t.memberId, memberId: t.memberId, isHost: false, isAdmin: false },
    can: (p) => can({ ...principal, meetingRole: "participant" }, p),
  };
}

const atStep = (t: Fixture, stepKey: string, ended = false) =>
  prisma.session.update({
    where: { id: t.sessionId },
    data: { stepKey, ...(ended ? { startedAt: new Date(Date.now() - 20 * 60_000), endedAt: new Date() } : {}) },
  });

/** Someone else of the team votes */
async function vote(t: Fixture, value: number) {
  const person = await prisma.person.create({
    data: { workspaceId: t.workspaceId, email: `${crypto.randomUUID()}@rating.test`, firstName: "Voter" },
  });
  await prisma.rating.create({ data: { workspaceId: t.workspaceId, sessionId: t.sessionId, personId: person.id, value } });
}

beforeAll(async () => {
  f = await meeting(await workspace("rating"), "Rated weekly");
  member = asParticipant(f);
});

describe("usefulness vote", () => {
  it("waits for the wrap-up", async () => {
    await atStep(f, "intro");
    await expect(runOp(member, { op: "rating.set", value: 4 })).rejects.toThrow("ratingNotYet");
    expect(await prisma.rating.count({ where: { sessionId: f.sessionId } })).toBe(0);
  });

  it("shows each person their own vote, and the counts once three people have voted", async () => {
    await atStep(f, "end");
    await runOp(f.ctx, { op: "rating.set", value: 5 });
    await runOp(member, { op: "rating.set", value: 2 });
    // Changed: still one vote per person
    await runOp(member, { op: "rating.set", value: 3 });
    // Two votes: each could work out the other's, so the counts stay hidden
    expect((await loadSnapshot(f.ctx)).rating).toEqual({ counts: [0, 0, 0, 0, 0], total: 2, mine: 5 });
    expect((await loadSnapshot(member)).rating.mine).toBe(3);
    await vote(f, 4);
    expect((await loadSnapshot(f.ctx)).rating).toEqual({ counts: [0, 0, 1, 1, 1], total: 3, mine: 5 });
    // Taken back: below the threshold again
    await runOp(member, { op: "rating.set", value: null });
    expect((await loadSnapshot(member)).rating).toEqual({ counts: [0, 0, 0, 0, 0], total: 2, mine: null });
    await runOp(member, { op: "rating.set", value: 3 });
  });

  it("is hidden while the module is off", async () => {
    await runOp(f.ctx, { op: "modules.set", moduleId: "rating", enabled: false });
    expect((await loadSnapshot(f.ctx)).rating.total).toBe(0);
    await runOp(f.ctx, { op: "modules.set", moduleId: "rating", enabled: true });
    expect((await loadSnapshot(f.ctx)).rating.total).toBe(3);
  });

  it("is archived with the session, in its minutes and in the stats", async () => {
    await atStep(f, "end", true);
    // Still open between the end and the archive
    await runOp(member, { op: "rating.set", value: 4 });
    await runOp(f.ctx, { op: "meeting.archive", summary: null, omit: [] });
    const s = await prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } });
    const record = parseRecord(s.record)!;
    expect(record.rating).toEqual({ counts: [0, 0, 0, 2, 1], avg: 13 / 3 });
    expect(minutesToMarkdown(buildMinutes(record, "en"))).toContain("4.3/5 · 3 ratings");
    expect(minutesToMarkdown(buildMinutes({ ...record, omit: ["rating"] }, "en"))).not.toContain("/5 ·");
    const stats = await meetingStats(f.ctx);
    expect(stats.sessions.at(-1)).toMatchObject({ ratingVotes: 3 });
    expect(stats.sessions.at(-1)!.rating).toBeCloseTo(13 / 3);
  });

  it("does not archive too few votes to stay anonymous", async () => {
    const small = await meeting(await workspace("rating-small"), "Two of us");
    await atStep(small, "end", true);
    await runOp(small.ctx, { op: "rating.set", value: 5 });
    await runOp(asParticipant(small), { op: "rating.set", value: 1 });
    await runOp(small.ctx, { op: "meeting.archive", summary: null, omit: [] });
    const s = await prisma.session.findUniqueOrThrow({ where: { id: small.sessionId } });
    expect(parseRecord(s.record)!.rating).toBeNull();
    expect((await meetingStats(small.ctx)).sessions.at(-1)).toMatchObject({ rating: null, ratingVotes: 0 });
  });
});
