import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { closeStaleSessions } from "@/lib/server/meeting/stale";
import { type Fixture, meeting, workspace } from "./fixtures";

// A live session forgotten open closes by itself after a while, its minutes published once; one still within the
// hours allowed stays live, and 0 hours turns the closing off

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

  it("publish the minutes of a session left open too long, once", async () => {
    await startAgo(13);
    const [a, b] = await Promise.all([closeStaleSessions(new Date(), 12), closeStaleSessions(new Date(), 12)]);
    expect(a + b).toBe(1);
    const s = await prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } });
    expect(s.status).toBe("archived");
    expect(s.record).not.toBeNull();
    expect(s.endedAt).not.toBeNull();
    // Its people are told the minutes are out
    expect(await prisma.inboxItem.count({ where: { meetingId: f.meetingId, kind: "minutes.published" } })).toBeGreaterThan(0);
  });
});
