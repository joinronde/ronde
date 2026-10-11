import { createHash } from "node:crypto";
import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { feedDocument } from "@/lib/server/calendar";
import { calendarEvents } from "@/lib/server/calendar-view";
import { runOp } from "@/lib/server/meeting/ops";
import { type Fixture, meeting, workspace } from "./fixtures";

// Calendar feeds: what a calendar app reads behind a secret link

let f: Fixture;
const link = async (userId: string, meetingId: string | null, token: string) => {
  await prisma.feedToken.create({ data: { userId, meetingId, tokenHash: createHash("sha256").update(token).digest("hex") } });
  return token;
};

beforeAll(async () => {
  f = await meeting(await workspace("cal"), "Planning, weekly");
});

describe("calendar feed", () => {
  it("lists the meeting with its rule, skipped and moved dates", async () => {
    const rule = await prisma.scheduleRule.findFirstOrThrow({ where: { meetingId: f.meetingId } });
    await runOp(f.ctx, { op: "schedule.skip", key: `${rule.id}:2030-01-14` });
    await runOp(f.ctx, { op: "schedule.move", key: `${rule.id}:2030-01-21`, date: "2030-01-22", time: "16:00", durationMin: null });
    const ics = await feedDocument(await link(f.ctx.viewer.userId, f.meetingId, "meeting-token-0123456789abc"));
    expect(ics).toContain("SUMMARY:Planning\\, weekly");
    expect(ics).toContain("RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;WKST=MO");
    expect(ics).toContain("EXDATE;TZID=UTC:20300114T100000");
    expect(ics).toContain("RECURRENCE-ID;TZID=UTC:20300121T100000");
    expect(ics).toContain("DTSTART;TZID=UTC:20300122T160000");
  });

  it("gives every meeting of the person in the personal feed", async () => {
    const other = await meeting(await workspace("cal-2"), "Other team");
    const ics = await feedDocument(await link(f.ctx.viewer.userId, null, "personal-token-0123456789abc"));
    expect(ics).toContain("SUMMARY:Planning\\, weekly");
    expect(ics).not.toContain("Other team");
    expect(await feedDocument(await link(other.ctx.viewer.userId, null, "personal-token-other-0123456"))).toContain("Other team");
  });

  it("stops working for an unknown link, or once the person no longer sees the meeting", async () => {
    expect(await feedDocument("unknown-token-0123456789abcdef")).toBeNull();
    const token = await link(f.ctx.viewer.userId, f.meetingId, "leaving-token-0123456789abcd");
    await prisma.meetingParticipant.deleteMany({ where: { meetingId: f.meetingId, personId: f.hostPersonId } });
    await prisma.workspaceMember.updateMany({ where: { personId: f.hostPersonId }, data: { role: "member" } });
    expect(await feedDocument(token)).toBeNull();
  });
});

describe("workspace calendar", () => {
  it("shows live, skipped and moved sessions of the visible meetings only", async () => {
    const g = await meeting(await workspace("cal-view"), "Design review");
    await meeting(await workspace("cal-view-other"), "Elsewhere");
    const rule = await prisma.scheduleRule.findFirstOrThrow({ where: { meetingId: g.meetingId } });
    await runOp(g.ctx, { op: "schedule.skip", key: `${rule.id}:2030-01-14` });
    await runOp(g.ctx, { op: "schedule.move", key: `${rule.id}:2030-01-21`, date: "2030-01-22", time: "16:00", durationMin: null });
    const events = await calendarEvents(g.ctx.ws, "2030-01-06", "2030-01-27");
    expect(events.map((e) => [e.meeting, e.date, e.time, e.status])).toEqual([
      ["Design review", "2030-01-07", "10:00", "live"],
      ["Design review", "2030-01-14", "10:00", "cancelled"],
      ["Design review", "2030-01-22", "16:00", "planned"],
    ]);
  });
});
