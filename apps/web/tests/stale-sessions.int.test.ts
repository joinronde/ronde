import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { remindDrafts } from "@/lib/server/meeting/drafts";
import { closeStaleSessions } from "@/lib/server/meeting/stale";
import { type Fixture, meeting, workspace } from "./fixtures";

// A live session forgotten open closes by itself after a while, once, its minutes kept as a draft for the hosts
// (reminded of it a few days later); one still within the hours allowed stays live, and 0 hours turns the closing off

let f: Fixture;

beforeAll(async () => {
  f = await meeting(await workspace("stale"), "Weekly");
});

const startAgo = (hours: number) =>
  prisma.session.update({ where: { id: f.sessionId }, data: { startedAt: new Date(Date.now() - hours * 3_600_000), status: "current" } });

describe("forgotten live sessions", () => {
  it("leave a session alone within the hours allowed, and when the closing is off", async () => {
    await startAgo(2);
    expect(await closeStaleSessions(new Date(), 12)).toBe(0);
    await startAgo(30);
    expect(await closeStaleSessions(new Date(), 0)).toBe(0);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } })).status).toBe("current");
  });

  it("archive a session left open too long, once, its minutes as a draft", async () => {
    await startAgo(13);
    const [a, b] = await Promise.all([closeStaleSessions(new Date(), 12), closeStaleSessions(new Date(), 12)]);
    expect(a + b).toBe(1);
    const s = await prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } });
    expect(s.status).toBe("archived");
    expect(s.record).not.toBeNull();
    expect(s.endedAt).not.toBeNull();
    // The team moves on; nothing is published until a host does it
    expect(s.minutesPublishedAt).toBeNull();
    expect(await prisma.session.count({ where: { meetingId: f.meetingId, status: "current" } })).toBe(1);
    expect(await prisma.inboxItem.count({ where: { meetingId: f.meetingId, kind: "minutes.published" } })).toBe(0);
  });

  it("remind the hosts of a draft once, after the days allowed", async () => {
    const s = await prisma.session.findFirstOrThrow({ where: { meetingId: f.meetingId, status: "archived" } });
    expect(await remindDrafts(new Date(), 2)).toBe(0);
    const later = new Date(s.archivedAt!.getTime() + 3 * 86_400_000);
    expect(await remindDrafts(later, 0)).toBe(0);
    const [a, b] = await Promise.all([remindDrafts(later, 2), remindDrafts(later, 2)]);
    expect(a + b).toBe(1);
    expect(await remindDrafts(later, 2)).toBe(0);
    const hosts = await prisma.meetingParticipant.findMany({ where: { meetingId: f.meetingId, role: { in: ["host", "cohost"] } } });
    const items = await prisma.inboxItem.findMany({ where: { meetingId: f.meetingId, kind: "minutes.draft" } });
    expect(items.map((i) => i.personId).sort()).toEqual(hosts.map((h) => h.personId).sort());
  });
});
