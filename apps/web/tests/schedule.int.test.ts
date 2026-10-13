import { localDate } from "@ronde/core/schedule";
import { prisma } from "@ronde/db";
import { beforeEach, describe, expect, it } from "vitest";
import { runOp } from "@/lib/server/meeting/ops";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { type Fixture, meeting, workspace } from "./fixtures";

// The schedule drives sessions: which one is prepared, its date and time, absences and rotating roles

const today = localDate(Date.now(), "Europe/Paris");
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Next date (from tomorrow) on a given ISO weekday */
function next(weekday: number, from = addDays(today, 1)) {
  let d = from;
  while (((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1 !== weekday) d = addDays(d, 1);
  return d;
}
const monday = next(1);
const weekly = (startDate: string, time = "10:00", interval = 1) => ({
  freq: "weekly" as const,
  interval,
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
const current = () => prisma.session.findFirstOrThrow({ where: { meetingId: f.meetingId, status: "current" } });

beforeEach(async () => {
  f = await meeting(await workspace(`sched-${++n}`), "Weekly");
  // A meeting in Paris with no session yet; the schedule below prepares one
  await prisma.workspace.update({ where: { id: f.workspaceId }, data: { timezone: "Europe/Paris" } });
  f.ctx.ws.workspace.timezone = "Europe/Paris";
  await prisma.session.deleteMany({ where: { meetingId: f.meetingId } });
  await runOp(f.ctx, { op: "schedule.save", timeZone: "", rules: [weekly(monday)] });
});

describe("sessions follow the schedule", () => {
  it("prepares the next occurrence, at its time in the meeting time zone", async () => {
    const s = await current();
    expect([s.date, s.time]).toEqual([monday, "10:00"]);
    expect(localDate(s.startsAt!.getTime(), "Europe/Paris")).toBe(monday);
    expect(s.startsAt!.toISOString().slice(11, 16)).toMatch(/^0[89]:00$/);
  });

  it("opens the following occurrence once a session is archived", async () => {
    const s = await current();
    await prisma.session.update({ where: { id: s.id }, data: { startedAt: new Date(), stepKey: "end" } });
    await runOp(f.ctx, { op: "meeting.archive", summary: null, omit: [] });
    expect((await current()).date).toBe(addDays(monday, 7));
  });

  it("moves to the next date when the prepared one is skipped, and back when restored", async () => {
    const s = await current();
    await runOp(f.ctx, { op: "schedule.skip", key: s.occurrenceKey! });
    expect((await current()).date).toBe(addDays(monday, 7));
    await runOp(f.ctx, { op: "schedule.restore", key: s.occurrenceKey! });
    expect((await current()).date).toBe(monday);
  });

  it("follows a moved date and time", async () => {
    const s = await current();
    await runOp(f.ctx, { op: "schedule.move", key: s.occurrenceKey!, date: addDays(monday, 1), time: "15:30", durationMin: null });
    const moved = await current();
    expect([moved.date, moved.time, moved.occurrenceKey]).toEqual([addDays(monday, 1), "15:30", s.occurrenceKey]);
    const snap = await loadSnapshot(f.ctx, "en");
    expect(snap.settings.schedule.upcoming[0]).toMatchObject({ date: addDays(monday, 1), time: "15:30", moved: true });
  });

  it("refuses to move a date onto another session's", async () => {
    const s = await current();
    await expect(
      runOp(f.ctx, { op: "schedule.move", key: s.occurrenceKey!, date: addDays(monday, 7), time: null, durationMin: null }),
    ).rejects.toMatchObject({ key: "meetingDateTaken" });
  });

  it("alternates two times, every other week", async () => {
    await runOp(f.ctx, { op: "schedule.save", timeZone: "", rules: [weekly(monday, "10:00", 2), weekly(addDays(monday, 7), "15:00", 2)] });
    const snap = await loadSnapshot(f.ctx, "en");
    expect(snap.settings.schedule.upcoming.slice(0, 4).map((o) => o.time)).toEqual(["10:00", "15:00", "10:00", "15:00"]);
    expect(snap.settings.schedule.summary).toBe("Every other Monday, alternating 10:00 and 15:00 (Europe/Paris)");
  });

  it("marks people who will be away as absent, and keeps them absent at the next session", async () => {
    const s = await current();
    await runOp(f.ctx, { op: "attendance.set", key: s.occurrenceKey!, status: "no", personId: f.memberId });
    expect((await current()).absent).toEqual([f.memberId]);
    await runOp(f.ctx, { op: "attendance.set", key: s.occurrenceKey!, status: null, personId: f.memberId });
    expect((await current()).absent).toEqual([]);
    // Away the week after: absent as soon as that session opens
    const following = `${s.occurrenceKey!.split(":")[0]}:${addDays(monday, 7)}`;
    await runOp(f.ctx, { op: "attendance.set", key: following, status: "no", personId: f.memberId });
    await prisma.session.update({ where: { id: s.id }, data: { startedAt: new Date(), stepKey: "end" } });
    await runOp(f.ctx, { op: "meeting.archive", summary: null, omit: [] });
    expect((await current()).absent).toEqual([f.memberId]);
  });

  it("only lets people answer for themselves, unless they run the meeting", async () => {
    const s = await current();
    const participant = {
      ...f.ctx,
      viewer: { ...f.ctx.viewer, memberId: f.memberId, isHost: false },
      can: (p: string) => p !== "session.run" && f.ctx.can(p as never),
    };
    await expect(
      runOp(participant, { op: "attendance.set", key: s.occurrenceKey!, status: "no", personId: f.hostPersonId }),
    ).rejects.toMatchObject({
      status: 403,
    });
    await runOp(participant, { op: "attendance.set", key: s.occurrenceKey!, status: "no" });
    expect((await loadSnapshot(f.ctx, "en")).attendance[s.occurrenceKey!]).toEqual({ [f.memberId]: "no" });
  });

  it("rotates the facilitator and the note-taker from one session to the next", async () => {
    await runOp(f.ctx, { op: "modules.set", moduleId: "rotation", enabled: true });
    // The session prepared before the module was on has no roles: archive it, the next one gets them
    const first = await current();
    await prisma.session.update({ where: { id: first.id }, data: { startedAt: new Date(), stepKey: "end" } });
    await runOp(f.ctx, { op: "meeting.archive", summary: null, omit: [] });
    const a = (await current()).assignments as Record<string, string>;
    expect(a.facilitator).toBeTruthy();
    expect(a.noteTaker).toBeTruthy();
    expect(a.facilitator).not.toBe(a.noteTaker);
    const second = await current();
    await prisma.session.update({ where: { id: second.id }, data: { startedAt: new Date(), stepKey: "end" } });
    await runOp(f.ctx, { op: "meeting.archive", summary: null, omit: [] });
    const b = (await current()).assignments as Record<string, string>;
    expect(b.facilitator).not.toBe(a.facilitator);
  });
});
