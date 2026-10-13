import { can } from "@ronde/core/permissions";
import { localDate } from "@ronde/core/schedule";
import { prisma, scoped } from "@ronde/db";
import { beforeEach, describe, expect, it } from "vitest";
import type { MeetingCtx } from "@/lib/server/meeting/context";
import { runOp } from "@/lib/server/meeting/ops";
import { agendaFor } from "@/lib/server/meeting/session";
import { type Fixture, meeting, workspace } from "./fixtures";

// Running a session from the control room: opening it, moving through its steps, its clock, its people,
// its schedule and the settings that cannot change under people's feet

let f: Fixture;
let ana: MeetingCtx;
let ruleId: string;
let n = 0;

/** The meeting seen and run by one participant */
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
    viewer: {
      userId: principal.userId,
      personId,
      email: "ana@session.test",
      name: "Ana",
      memberId: personId,
      isHost: false,
      isAdmin: false,
    },
    can: (p) => can(principal, p),
  };
}

const session = () => prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } });
const current = () => prisma.session.findFirst({ where: { meetingId: f.meetingId, status: "current" } });
const setSession = (data: Parameters<typeof prisma.session.update>[0]["data"]) =>
  prisma.session.update({ where: { id: f.sessionId }, data });
const archiveCurrent = () => setSession({ status: "archived", archivedAt: new Date() });
const agenda = async () => (await agendaFor(scoped(prisma, f.workspaceId) as never, await session())).map((x) => x.key);
const today = () => localDate(Date.now(), "UTC");

async function addPeople(count: number) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const p = await prisma.person.create({ data: { workspaceId: f.workspaceId, email: `p${i}-${n}@session.test`, firstName: `P${i}` } });
    await prisma.meetingParticipant.create({
      data: { workspaceId: f.workspaceId, meetingId: f.meetingId, personId: p.id, position: 2 + i },
    });
    ids.push(p.id);
  }
  return ids;
}

beforeEach(async () => {
  f = await meeting(await workspace(`session-${Date.now().toString(36)}-${++n}`), "Weekly");
  ana = participantCtx(f.memberId);
  ruleId = f.occurrenceKey.split(":")[0]!;
});

describe("opening a session", () => {
  it("opens one session at a time, on a date no other session has", async () => {
    await expect(runOp(f.ctx, { op: "meeting.create" })).rejects.toMatchObject({ key: "meetingAlreadyCurrent" });
    await archiveCurrent();
    await expect(runOp(ana, { op: "meeting.create" })).rejects.toMatchObject({ status: 403, key: "hostOnly" });
    await expect(runOp(f.ctx, { op: "meeting.create", date: "2030-01-07" })).rejects.toMatchObject({ key: "meetingDateTaken" });
    await runOp(f.ctx, { op: "meeting.create", date: "2030-02-01" });
    expect(await current()).toMatchObject({ date: "2030-02-01", occurrenceKey: null, startedAt: null });
  });

  it("takes the next date of the schedule, and refuses when the schedule has none", async () => {
    await archiveCurrent();
    // The fixture's schedule starts in 2030, past the horizon looked at: it starts today instead
    await prisma.scheduleRule.update({ where: { id: ruleId }, data: { startDate: today() } });
    await runOp(f.ctx, { op: "meeting.create" });
    const next = await current();
    expect(next?.occurrenceKey).toBe(`${ruleId}:${next?.date}`);
    expect(next!.date >= today()).toBe(true);

    await prisma.session.deleteMany({ where: { id: next!.id } });
    await prisma.scheduleRule.deleteMany({ where: { meetingId: f.meetingId } });
    await expect(runOp(f.ctx, { op: "meeting.create" })).rejects.toMatchObject({ key: "noUpcomingDate" });
    expect(await current()).toBeNull();
  });

  it("moves the session to another free date; its occurrence and its actions follow", async () => {
    await prisma.action.update({ where: { id: f.actionId }, data: { originDate: "2030-01-07" } });
    await runOp(f.ctx, { op: "meeting.setDate", date: "2030-01-09" });
    expect((await session()).date).toBe("2030-01-09");
    expect(await prisma.scheduleException.findFirst({ where: { ruleId, originalDate: "2030-01-07" } })).toMatchObject({
      kind: "move",
      date: "2030-01-09",
    });
    expect((await prisma.action.findUniqueOrThrow({ where: { id: f.actionId } })).originDate).toBe("2030-01-09");

    await prisma.session.create({
      data: { workspaceId: f.workspaceId, meetingId: f.meetingId, date: "2029-12-30", status: "archived", archivedAt: new Date() },
    });
    await expect(runOp(f.ctx, { op: "meeting.setDate", date: "2029-12-30" })).rejects.toMatchObject({ key: "meetingDateTaken" });
    // Back to its own date: the occurrence is no longer moved
    await runOp(f.ctx, { op: "meeting.setDate", date: "2030-01-07" });
    expect(await prisma.scheduleException.findFirst({ where: { ruleId, originalDate: "2030-01-07" } })).toMatchObject({ date: null });
  });
});

describe("moving through the steps", () => {
  it("refuses a step the agenda does not have, and any step before the start", async () => {
    await expect(runOp(f.ctx, { op: "meeting.goto", key: "nowhere" })).rejects.toMatchObject({ key: "stepNotFound" });
    await setSession({ startedAt: null });
    await expect(runOp(f.ctx, { op: "meeting.goto", key: f.memberId })).rejects.toMatchObject({ key: "startFirst" });
    await expect(runOp(f.ctx, { op: "meeting.step", delta: 1 })).rejects.toMatchObject({ key: "startFirst" });
    // Standing where it already is moves nothing, started or not
    await runOp(f.ctx, { op: "meeting.goto", key: "intro" });
    expect((await session()).stepKey).toBe("intro");
  });

  it("steps forward and back, once for presses made from the same step, never before the first", async () => {
    const keys = await agenda();
    await runOp(f.ctx, { op: "meeting.step", delta: -1 });
    expect((await session()).stepKey).toBe(keys[0]);
    await runOp(f.ctx, { op: "meeting.step", delta: 1, from: "intro" });
    await runOp(f.ctx, { op: "meeting.step", delta: 1, from: "intro" });
    expect((await session()).stepKey).toBe(keys[1]);
    await runOp(f.ctx, { op: "meeting.goto", key: "end" });
    expect((await session()).stepKey).toBe("end");
    await runOp(f.ctx, { op: "meeting.step", delta: 1 });
    expect((await session()).stepKey).toBe("end");
    await runOp(f.ctx, { op: "meeting.step", delta: -1 });
    expect((await session()).stepKey).toBe(keys.at(-2));
  });

  it("starts the meeting with its clock, tells its people, then pauses and resumes", async () => {
    await setSession({ startedAt: null, timerRunning: false });
    await runOp(f.ctx, { op: "meeting.togglePlay" });
    const started = await session();
    expect(started).toMatchObject({ timerRunning: true, startedAt: expect.any(Date) });
    expect(await prisma.inboxItem.count({ where: { personId: f.memberId, kind: "session.started" } })).toBe(1);
    await runOp(f.ctx, { op: "meeting.togglePlay" });
    expect(await session()).toMatchObject({ timerRunning: false, startedAt: started.startedAt });
    await runOp(f.ctx, { op: "meeting.togglePlay" });
    expect((await session()).timerRunning).toBe(true);
    // Told once only
    expect(await prisma.inboxItem.count({ where: { personId: f.memberId, kind: "session.started" } })).toBe(1);
    // The wrap-up keeps its clock stopped
    await setSession({ stepKey: "end", timerRunning: false });
    await runOp(f.ctx, { op: "meeting.togglePlay" });
    expect((await session()).timerRunning).toBe(false);
  });
});

describe("holding the session now", () => {
  it("leaves a session already started as it is", async () => {
    await runOp(f.ctx, { op: "session.now" });
    expect((await session()).date).toBe("2030-01-07");
  });

  it("refuses when the meeting was already held today", async () => {
    await setSession({ startedAt: null });
    await prisma.session.create({
      data: { workspaceId: f.workspaceId, meetingId: f.meetingId, date: today(), status: "archived", archivedAt: new Date() },
    });
    await expect(runOp(f.ctx, { op: "session.now" })).rejects.toMatchObject({ key: "sessionHeldToday" });
    expect(await session()).toMatchObject({ date: "2030-01-07", startedAt: null });
  });

  it("brings the session being prepared to today and starts it; its occurrence stays for later", async () => {
    await setSession({ startedAt: null, timerRunning: false });
    await runOp(f.ctx, { op: "session.now" });
    expect(await session()).toMatchObject({ date: today(), occurrenceKey: null, timerRunning: true, startedAt: expect.any(Date) });
  });

  it("opens a session today when none is prepared", async () => {
    await archiveCurrent();
    await runOp(f.ctx, { op: "session.now" });
    expect(await current()).toMatchObject({ date: today(), timerRunning: true, startedAt: expect.any(Date) });
  });
});

describe("the clock and the speaking order", () => {
  it("resets the clock of the step, keeping it running or not", async () => {
    await setSession({ timerRunning: false, timerBaseMs: 90_000 });
    await runOp(f.ctx, { op: "meeting.resetTimer" });
    expect(await session()).toMatchObject({ timerRunning: false, timerBaseMs: 0, timerStartedAt: null });
  });

  it("gives the current step 30 seconds more at each press", async () => {
    await runOp(f.ctx, { op: "meeting.bonus" });
    await runOp(f.ctx, { op: "meeting.bonus" });
    expect((await session()).bonus).toEqual({ intro: 60_000 });
  });

  it("moves a person up or down the order, within its ends", async () => {
    await runOp(f.ctx, { op: "meeting.move", id: f.memberId, delta: -1 });
    expect((await session()).order).toEqual([f.memberId, f.hostPersonId]);
    await runOp(f.ctx, { op: "meeting.move", id: f.memberId, delta: -1 });
    await runOp(f.ctx, { op: "meeting.move", id: "nobody", delta: 1 });
    expect((await session()).order).toEqual([f.memberId, f.hostPersonId]);
    await expect(runOp(ana, { op: "meeting.move", id: f.memberId, delta: 1 })).rejects.toMatchObject({ status: 403, key: "hostOnly" });
  });

  it("shuffles who is still to speak, never those who already spoke", async () => {
    const others = await addPeople(4);
    const order = [f.hostPersonId, f.memberId, ...others];
    await setSession({ order, stepKey: f.memberId });
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      await runOp(f.ctx, { op: "meeting.shuffle" });
      const now = (await session()).order;
      expect(now.slice(0, 2)).toEqual([f.hostPersonId, f.memberId]);
      expect([...now].sort()).toEqual([...order].sort());
      seen.add(now.join());
    }
    // 24 possible orders: twenty draws giving always the same would mean no shuffle
    expect(seen.size).toBeGreaterThan(1);
  });

  it("marks someone absent and back, moving on when it was their turn", async () => {
    const outsider = await prisma.person.create({ data: { workspaceId: f.workspaceId, email: `out-${n}@session.test`, firstName: "Out" } });
    await expect(runOp(f.ctx, { op: "meeting.absent", id: outsider.id })).rejects.toMatchObject({ key: "unknownMember" });
    await runOp(f.ctx, { op: "meeting.goto", key: f.memberId });
    await runOp(f.ctx, { op: "meeting.absent", id: f.memberId });
    const s = await session();
    expect(s.absent).toEqual([f.memberId]);
    expect([f.memberId, `qa:${f.memberId}`]).not.toContain(s.stepKey);
    await runOp(f.ctx, { op: "meeting.absent", id: f.memberId });
    expect((await session()).absent).toEqual([]);
  });

  it("archives only from the wrap-up", async () => {
    await expect(runOp(f.ctx, { op: "meeting.archive", summary: null, omit: [] })).rejects.toMatchObject({ key: "endBeforeArchive" });
    expect((await session()).status).toBe("current");
  });
});

describe("the schedule from the control room", () => {
  it("skips an occurrence not started yet, never one under way", async () => {
    await expect(runOp(f.ctx, { op: "schedule.skip", key: f.occurrenceKey })).rejects.toMatchObject({ key: "sessionAlreadyStarted" });
    await expect(runOp(f.ctx, { op: "schedule.skip", key: "elsewhere:2030-01-14" })).rejects.toMatchObject({ key: "notFound" });
    await expect(runOp(ana, { op: "schedule.skip", key: `${ruleId}:2030-01-14` })).rejects.toMatchObject({ status: 403, key: "hostOnly" });
    await runOp(f.ctx, { op: "schedule.skip", key: `${ruleId}:2030-01-14` });
    expect(await prisma.scheduleException.findFirst({ where: { ruleId, originalDate: "2030-01-14" } })).toMatchObject({ kind: "cancel" });
  });

  it("keeps an occurrence a holiday would skip, then lets the holiday decide again", async () => {
    for (const op of ["schedule.keep", "schedule.restore"])
      await expect(runOp(f.ctx, { op, key: "elsewhere:2030-01-14" })).rejects.toMatchObject({ key: "notFound" });
    const key = `${ruleId}:2030-01-14`;
    await runOp(f.ctx, { op: "schedule.keep", key });
    expect(await prisma.scheduleException.findFirst({ where: { ruleId, originalDate: "2030-01-14" } })).toMatchObject({ kind: "keep" });
    await runOp(f.ctx, { op: "schedule.restore", key });
    expect(await prisma.scheduleException.count({ where: { ruleId } })).toBe(0);
  });

  it("nudges for check-ins only through a rule meant for it", async () => {
    // The meeting's only rule is about the minutes
    await expect(runOp(f.ctx, { op: "notifications.nudge" })).rejects.toMatchObject({ key: "notifyNoRule" });
    await prisma.notificationRule.create({
      data: { workspaceId: f.workspaceId, meetingId: f.meetingId, connectorId: f.connectorId, event: "checkin_reminder", enabled: false },
    });
    await expect(runOp(f.ctx, { op: "notifications.nudge" })).rejects.toMatchObject({ key: "notifyNoRule" });
  });
});

describe("settings that people follow live", () => {
  const blocks = [
    { id: "intro", type: "intro" },
    { id: "round", type: "round" },
  ];

  it("keeps the agenda as it is while a session runs", async () => {
    await expect(runOp(f.ctx, { op: "agenda.save", blocks })).rejects.toMatchObject({ key: "agendaLocked" });
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } })).agenda).toBeNull();
    // Once it ended, the next one can be prepared
    await setSession({ endedAt: new Date() });
    await runOp(f.ctx, { op: "agenda.save", blocks });
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } })).agenda).toEqual(blocks);
  });

  it("refuses a step whose module is off", async () => {
    await setSession({ startedAt: null });
    const withPoker = [...blocks, { id: "pk", type: "poker" }];
    await expect(runOp(f.ctx, { op: "agenda.save", blocks: withPoker })).rejects.toMatchObject({ key: "agendaModuleOff" });
    await prisma.moduleInstallation.create({
      data: { workspaceId: f.workspaceId, meetingId: f.meetingId, moduleId: "poker", enabled: true, config: {} },
    });
    await runOp(f.ctx, { op: "agenda.save", blocks: withPoker });
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } })).agenda).toEqual(withPoker);
  });

  it("saves the sections of the check-in: one per role, a custom one named", async () => {
    const settings = {
      teamName: "Platform weekly",
      locale: "",
      hostLabel: "Host",
      speakSec: 120,
      autoStart: false,
      targetMin: 30,
      announcements: ["", "Demo on Friday"],
      reminderEnabled: false,
      reminderWhen: "dayBefore",
      reminderTime: "09:00",
    };
    const done = { key: "done", label: "", role: "achievement", input: "list" };
    await expect(
      runOp(f.ctx, { op: "settings.save", ...settings, sections: [done, { label: "Also done", role: "achievement", input: "list" }] }),
    ).rejects.toMatchObject({ key: "sectionRoleTaken" });
    await expect(
      runOp(f.ctx, { op: "settings.save", ...settings, sections: [done, { label: "", role: "custom", input: "text" }] }),
    ).rejects.toMatchObject({ key: "sectionLabelRequired" });
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } })).name).toBe("Weekly");

    await runOp(f.ctx, { op: "settings.save", ...settings, sections: [done, { label: "Kudos", role: "custom", input: "text" }] });
    expect(await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } })).toMatchObject({
      name: "Platform weekly",
      announcements: ["Demo on Friday"],
    });
    const sections = await prisma.section.findMany({ where: { meetingId: f.meetingId }, orderBy: { position: "asc" } });
    expect(sections.map((s) => [s.label, s.role])).toEqual([
      ["", "achievement"],
      ["Kudos", "custom"],
    ]);
    // The section kept by its key keeps its check-in items
    expect(sections[0]!.key).toBe("done");
    expect(await prisma.checkInItem.count({ where: { meetingId: f.meetingId, sectionKey: "done" } })).toBe(2);
  });

  it("keeps a person's preferences small", async () => {
    await expect(runOp(f.ctx, { op: "pref.set", key: "board.layout", value: "x".repeat(20_001) })).rejects.toMatchObject({
      key: "prefTooLarge",
    });
    const where = { userId: f.ctx.viewer.userId, key: "board.layout" };
    expect(await prisma.userPref.count({ where })).toBe(0);
    await runOp(f.ctx, { op: "pref.set", key: "board.layout", value: { columns: 2 } });
    expect((await prisma.userPref.findFirstOrThrow({ where })).value).toEqual({ columns: 2 });
    await runOp(f.ctx, { op: "pref.set", key: "board.layout", value: null });
    expect(await prisma.userPref.count({ where })).toBe(0);
  });
});
