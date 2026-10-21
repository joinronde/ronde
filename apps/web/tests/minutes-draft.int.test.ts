import { can } from "@ronde/core/permissions";
import type { HistoryItem } from "@ronde/core/types";
import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { MeetingCtx } from "@/lib/server/meeting/context";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { type Fixture, meeting, workspace } from "./fixtures";

// Minutes written after the session: the host ends it and writes later. The team moves on to the next session at
// once; the draft stays with the hosts (their notes and summary editable) until one publishes it, once.

let current: MeetingCtx;
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/meeting/context", async (original) => {
  const real = await original<typeof import("@/lib/server/meeting/context")>();
  return { ...real, requireMeeting: async () => current };
});

const { runOp } = await import("@/lib/server/meeting/ops");
const history = await import("@/app/api/w/[ws]/m/[meeting]/history/route");

let f: Fixture;
let ana: MeetingCtx;
let date: string;

/** The meeting seen by one participant */
function participantCtx(personId: string): MeetingCtx {
  const principal = {
    userId: `user-${personId}`,
    personId,
    workspaceId: f.workspaceId,
    workspaceRole: "member" as const,
    meetingRole: "participant" as const,
  };
  return {
    ...f.ctx,
    role: "participant",
    viewer: { userId: principal.userId, personId, email: "ana@draft.test", name: "Ana", memberId: personId, isHost: false, isAdmin: false },
    can: (p) => can(principal, p),
  };
}

/** The history as one person reads it */
async function historyOf(ctx: MeetingCtx): Promise<HistoryItem[]> {
  current = ctx;
  const res = await history.GET(new Request("http://localhost/x?locale=en"), {
    params: Promise.resolve({ ws: ctx.ws.workspace.slug, meeting: f.meetingId }),
  } as never);
  return ((await res.json()) as { items: HistoryItem[] }).items;
}

const inbox = (kind: string) => prisma.inboxItem.count({ where: { meetingId: f.meetingId, kind } });

beforeAll(async () => {
  f = await meeting(await workspace(`draft-${Date.now().toString(36)}`), "Weekly");
  ana = participantCtx(f.memberId);
  const s = await prisma.session.findFirstOrThrow({ where: { meetingId: f.meetingId, status: "current" } });
  date = s.date;
  await runOp(f.ctx, {
    op: "checkIn.save",
    memberId: f.memberId,
    done: ["Shipped the API"],
    next: ["Write the docs"],
    blockers: [],
    other: [],
  });
  await prisma.session.update({ where: { id: s.id }, data: { startedAt: new Date(), stepKey: "end", endedAt: new Date() } });
});

describe("minutes written later", () => {
  it("end the session for the team right away, without publishing anything", async () => {
    await runOp(f.ctx, { op: "meeting.archive", summary: "First thoughts", omit: [], draft: true });
    const s = await prisma.session.findFirstOrThrow({ where: { meetingId: f.meetingId, date } });
    expect(s.status).toBe("archived");
    expect(s.minutesPublishedAt).toBeNull();
    expect(s.summary).toBe("First thoughts");
    // The next session is open and the check-in starts again, last time's plans carried
    expect(await prisma.session.count({ where: { meetingId: f.meetingId, status: "current" } })).toBe(1);
    current = f.ctx;
    const snapshot = await loadSnapshot(f.ctx);
    expect(snapshot.lastWeek[f.memberId]?.date).toBe(date);
    expect(await inbox("minutes.published")).toBe(0);
  });

  it("show the draft to the hosts only", async () => {
    expect((await historyOf(f.ctx)).find((h) => h.date === date)?.draft).toBe(true);
    expect((await historyOf(ana)).find((h) => h.date === date)).toBeUndefined();
  });

  it("let the hosts write the notes of a step, which the minutes follow", async () => {
    await expect(runOp(ana, { op: "history.note", date, key: "intro", text: "x" })).rejects.toMatchObject({ status: 403 });
    await runOp(f.ctx, { op: "history.note", date, key: "intro", text: "Decision: ship on Friday" });
    const s = await prisma.session.findFirstOrThrow({ where: { meetingId: f.meetingId, date } });
    expect((s.record as { notes: Record<string, string> }).notes.intro).toBe("Decision: ship on Friday");
    expect(await prisma.note.findFirst({ where: { sessionId: s.id, key: "intro" } })).toMatchObject({ text: "Decision: ship on Friday" });
    // Emptied: the step has no notes any more
    await runOp(f.ctx, { op: "history.note", date, key: "intro", text: " " });
    const after = await prisma.session.findFirstOrThrow({ where: { id: s.id } });
    expect((after.record as { notes: Record<string, string> }).notes.intro).toBeUndefined();
  });

  it("publish once, then the team sees them and nothing more is written to them", async () => {
    await expect(runOp(ana, { op: "history.publish", date })).rejects.toMatchObject({ status: 403 });
    await runOp(f.ctx, { op: "history.publish", date });
    const s = await prisma.session.findFirstOrThrow({ where: { meetingId: f.meetingId, date } });
    expect(s.minutesPublishedAt).not.toBeNull();
    expect(await inbox("minutes.published")).toBeGreaterThan(0);
    expect((await historyOf(ana)).find((h) => h.date === date)?.draft).toBeUndefined();
    await expect(runOp(f.ctx, { op: "history.publish", date })).rejects.toMatchObject({ key: "minutesPublished" });
    await expect(runOp(f.ctx, { op: "history.note", date, key: "intro", text: "late" })).rejects.toMatchObject({ key: "minutesPublished" });
  });

  it("publish at once when the host does not wait", async () => {
    const next = await prisma.session.findFirstOrThrow({ where: { meetingId: f.meetingId, status: "current" } });
    await prisma.session.update({ where: { id: next.id }, data: { startedAt: new Date(), stepKey: "end", endedAt: new Date() } });
    await runOp(f.ctx, { op: "meeting.archive", summary: null, omit: [] });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: next.id } })).minutesPublishedAt).not.toBeNull();
  });
});
