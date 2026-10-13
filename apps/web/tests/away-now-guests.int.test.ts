import { localDate } from "@ronde/core/schedule";
import { prisma } from "@ronde/db";
import { beforeEach, describe, expect, it } from "vitest";
import { addAbsence, standsInAsHost } from "@/lib/server/absences";
import { createGuestLink, guestContext, revokeGuestLink } from "@/lib/server/guest-links";
import { runOp } from "@/lib/server/meeting/ops";
import { scheduleDTO } from "@/lib/server/meeting/schedule";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { type Fixture, meeting, workspace } from "./fixtures";

// Absences, sessions started on the spot, guest links and meetings too close to each other

const today = localDate(Date.now(), "UTC");
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const weekday = (iso: string) => ((new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
const nextMonday = (() => {
  let d = addDays(today, 1);
  while (weekday(d) !== 1) d = addDays(d, 1);
  return d;
})();
const weekly = (startDate: string, time = "10:00") => ({
  freq: "weekly" as const,
  interval: 1,
  byDay: [1],
  setPos: null,
  monthDay: null,
  startDate,
  until: null,
  count: null,
  time,
  durationMin: 30,
});

let f: Fixture;
let n = 0;
const other = async () =>
  (await prisma.meetingParticipant.findFirstOrThrow({ where: { meetingId: f.meetingId, role: "participant" } })).personId;
const current = () => prisma.session.findFirstOrThrow({ where: { meetingId: f.meetingId, status: "current" } });

beforeEach(async () => {
  f = await meeting(await workspace(`away-${++n}`), "Weekly");
  // No session yet: the schedule prepares next Monday's
  await prisma.session.deleteMany({ where: { meetingId: f.meetingId } });
  await runOp(f.ctx, { op: "schedule.save", timeZone: "", rules: [weekly(nextMonday)] });
});

describe("absences", () => {
  it("count the person absent from the sessions of those days", async () => {
    const personId = await other();
    await addAbsence(f.ctx.ws, { personId, from: addDays(nextMonday, -1), to: addDays(nextMonday, 2) });
    expect((await current()).absent).toContain(personId);
  });

  it("let the person they name run the meetings they host, during the absence only", async () => {
    const delegate = await other();
    // Only a member of the workspace stands in: someone of the directory without an account could not
    await expect(
      addAbsence(f.ctx.ws, { personId: f.hostPersonId, from: today, to: addDays(today, 3), delegateId: delegate }),
    ).rejects.toThrow("unknownMember");
    const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `stand-in-${n}@away.test`, name: "Sam" } });
    await prisma.person.update({ where: { id: delegate }, data: { userId: user.id } });
    await prisma.workspaceMember.create({ data: { workspaceId: f.workspaceId, userId: user.id, personId: delegate, role: "member" } });
    await addAbsence(f.ctx.ws, { personId: f.hostPersonId, from: today, to: addDays(today, 3), delegateId: delegate });
    expect(await standsInAsHost(f.ctx.ws.db, f.meetingId, delegate, today)).toBe(true);
    expect(await standsInAsHost(f.ctx.ws.db, f.meetingId, delegate, addDays(today, 10))).toBe(false);
    // The delegate is told
    expect(await prisma.inboxItem.count({ where: { personId: delegate, kind: "absence.delegated" } })).toBe(1);
  });

  it("never let someone name themselves to stand in for another person", async () => {
    const colleague = await other();
    const own = { ...f.ctx.ws, member: { ...f.ctx.ws.member, personId: colleague } };
    await expect(
      addAbsence(own, { personId: f.hostPersonId, from: today, to: addDays(today, 3), delegateId: colleague }),
    ).rejects.toMatchObject({
      status: 403,
    });
  });

  it("refuse a period backwards", async () => {
    await expect(addAbsence(f.ctx.ws, { personId: await other(), from: today, to: addDays(today, -1) })).rejects.toThrow();
  });
});

describe("a session started on the spot", () => {
  it("happens today and leaves the planned occurrence in the schedule", async () => {
    await runOp(f.ctx, { op: "session.now" });
    const s = await current();
    expect(s.date).toBe(localDate(Date.now(), f.ctx.ws.workspace.timezone));
    expect(s.startedAt).not.toBeNull();
    expect(s.occurrenceKey).toBeNull();
    // Once archived, next Monday's occurrence is prepared as planned
    await prisma.session.update({ where: { id: s.id }, data: { stepKey: "end" } });
    await runOp(f.ctx, { op: "meeting.archive", summary: null, omit: [] });
    expect((await current()).date).toBe(nextMonday);
  });

  it("is refused when a session was already held today", async () => {
    await runOp(f.ctx, { op: "session.now" });
    const s = await current();
    await prisma.session.update({ where: { id: s.id }, data: { stepKey: "end" } });
    await runOp(f.ctx, { op: "meeting.archive", summary: null, omit: [] });
    await expect(runOp(f.ctx, { op: "session.now" })).rejects.toThrow();
  });
});

describe("guest links", () => {
  it("let someone without an account read the meeting, nothing more, until revoked", async () => {
    const link = await createGuestLink(f.ctx, { label: "Board", days: 7 });
    const token = link.url.slice("/g/".length);
    const guest = await guestContext(token);
    expect(guest?.meeting.id).toBe(f.meetingId);
    expect(guest?.can("meeting.read")).toBe(true);
    expect(guest?.can("session.run")).toBe(false);
    expect(guest?.can("checkin.write.own")).toBe(false);
    const snapshot = await loadSnapshot(guest!);
    expect(snapshot.viewer.isHost).toBe(false);
    expect(snapshot.context.api).toContain(`/api/g/${token}`);
    await revokeGuestLink(f.ctx, link.id);
    expect(await guestContext(token)).toBeNull();
  });

  it("stop working once expired, and ignore made-up tokens", async () => {
    const link = await createGuestLink(f.ctx, { label: "Client", days: 1 });
    await prisma.guestLink.update({ where: { id: link.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await guestContext(link.url.slice(3))).toBeNull();
    expect(await guestContext(`g_${"x".repeat(32)}`)).toBeNull();
    expect(await guestContext("../etc")).toBeNull();
  });
});

describe("meetings too close to each other", () => {
  it("are flagged for the people they share, the workspace's margin included", async () => {
    const second = await prisma.meeting.create({ data: { workspaceId: f.workspaceId, name: "Planning" } });
    await prisma.meetingParticipant.create({
      data: { workspaceId: f.workspaceId, meetingId: second.id, personId: f.hostPersonId, role: "host" },
    });
    // Mondays 10:30-11:00, right after the weekly (10:00-10:30)
    await prisma.scheduleRule.create({
      data: {
        workspaceId: f.workspaceId,
        meetingId: second.id,
        freq: "weekly",
        byDay: [1],
        startDate: nextMonday,
        time: "10:30",
        durationMin: 30,
      },
    });
    const ws = f.ctx.ws.workspace;
    const plain = await scheduleDTO(f.ctx.ws.db, f.ctx.meeting, { ...ws, settings: { bufferMin: 0 } }, "en");
    expect(Object.keys(plain.conflicts)).toHaveLength(0);
    const margin = await scheduleDTO(f.ctx.ws.db, f.ctx.meeting, { ...ws, settings: { bufferMin: 15 } }, "en");
    const first = margin.upcoming.find((o) => !o.cancelled)!;
    expect(margin.conflicts[first.key]?.[0]?.meeting).toBe("Planning");
  });
});

describe("the session being prepared", () => {
  it("keeps the absences marked when its occurrence only moves, and follows a time zone change", async () => {
    const personId = await other();
    const s = await current();
    await prisma.session.update({ where: { id: s.id }, data: { absent: [personId] } });
    // The same occurrence, later in the day
    await runOp(f.ctx, { op: "schedule.save", timeZone: "", rules: [weekly(nextMonday, "11:00")] });
    const moved = await current();
    expect([moved.time, moved.absent]).toEqual(["11:00", [personId]]);
    // Another time zone: same date and time on the clock, another instant
    await runOp(f.ctx, { op: "schedule.save", timeZone: "America/New_York", rules: [weekly(nextMonday, "11:00")] });
    const there = await current();
    expect(there.startsAt?.getTime()).not.toBe(moved.startsAt?.getTime());
    expect(there.absent).toEqual([personId]);
  });
});

describe("a leave removed", () => {
  it("counts the person in the sessions of those days again", async () => {
    const personId = await other();
    const s = await current();
    const id = await addAbsence(f.ctx.ws, { personId, from: s.date, to: s.date });
    expect((await current()).absent).toContain(personId);
    const { removeAbsence } = await import("@/lib/server/absences");
    await removeAbsence(f.ctx.ws, id);
    expect((await current()).absent).not.toContain(personId);
  });
});

describe("a schedule", () => {
  it("is refused when two of its rules meet on the same day", async () => {
    await expect(
      runOp(f.ctx, { op: "schedule.save", timeZone: "", rules: [weekly(nextMonday, "09:00"), weekly(nextMonday, "17:00")] }),
    ).rejects.toMatchObject({ key: "scheduleSameDay" });
  });
});
