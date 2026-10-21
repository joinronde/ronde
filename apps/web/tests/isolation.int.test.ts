import { BOARD_SOUND_KEYS } from "@ronde/core/sound";
import { prisma, TENANT_MODELS } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { OP_NAMES, runOp } from "@/lib/server/meeting/ops";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { type Fixture, meeting, workspace } from "./fixtures";

// Isolation harness: every operation is called by the host of one meeting with the ids of another meeting
// (in another workspace, or in the same workspace). It may fail or do something to its own meeting, but
// it must never change the other meeting, and the snapshot must never show its ids.

/** One call per operation, aimed at the target meeting's ids */
function attacks(t: Fixture): Record<string, Record<string, unknown>> {
  const list = (items: string[] = []) => items;
  return {
    "meeting.create": {},
    "session.now": {},
    "meeting.setDate": { date: "2031-02-03" },
    "meeting.goto": { key: t.memberId },
    "meeting.step": { delta: 1 },
    "meeting.togglePlay": {},
    "meeting.resetTimer": {},
    "meeting.reset": {},
    "meeting.bonus": {},
    "meeting.move": { id: t.memberId, delta: -1 },
    "meeting.shuffle": {},
    "meeting.absent": { id: t.memberId },
    "meeting.publish": {},
    "meeting.archive": { summary: "hijacked", omit: [] },
    "history.summary": { date: "2026-01-05", summary: "hijacked" },
    "history.publish": { date: "2026-01-05" },
    "history.note": { date: "2026-01-05", key: "intro", text: "overwritten" },
    "note.set": { key: "intro", text: "overwritten" },
    "icebreaker.set": { question: "Hijacked?" },
    "icebreaker.configure": { bank: ["Hijacked?"] },
    "spotlight.set": { label: "x", text: "hijacked" },
    "spotlight.clear": {},
    "random.draw": { kind: "order", teamSize: 2 },
    "random.apply": {},
    "random.clear": {},
    "hands.add": { type: "question", text: "x", targetId: t.memberId },
    "hands.resolve": { id: t.interactionId, resolved: true },
    "hands.delete": { id: t.interactionId },
    "reactions.add": { emoji: "👍" },
    "topic.add": { text: "x" },
    "topic.vote": { id: t.topicId },
    "topic.done": { id: t.topicId, done: true },
    "topic.delete": { id: t.topicId },
    "parking.add": { text: "hijacked" },
    "parking.discuss": { id: t.topicId },
    "icebreaker.answer": { text: "x" },
    "kudos.add": { toId: t.memberId, text: "x" },
    "kudos.delete": { id: t.kudoId },
    "mood.set": { value: 1 },
    "rating.set": { value: 4 },
    "comment.like": { ownerId: t.memberId, section: "done", itemText: "shipped" },
    "comment.react": { ownerId: t.memberId, section: "done", itemText: "shipped", emoji: "🎉" },
    "comment.add": { ownerId: t.memberId, section: "done", itemText: "shipped", text: "x" },
    "comment.delete": { id: t.commentId },
    "action.add": { text: "x", ownerId: t.memberId },
    "action.update": { id: t.actionId, status: "done", ownerId: t.hostPersonId },
    "action.delete": { id: t.actionId },
    "checkIn.save": {
      memberId: t.memberId,
      done: ["hijacked"],
      next: list(),
      blockers: list(),
      other: list(),
      byProject: { [t.projectId]: { done: ["hijacked"], next: list(), blockers: list(), other: list() } },
    },
    "project.sheet": { projectId: t.projectId, health: "offTrack", headline: "hijacked" },
    "project.hold": { projectId: t.projectId, on: true },
    "project.add": { projectId: t.projectId, on: true },
    "item.with": { ownerId: t.memberId, section: "done", itemText: "x", projectId: t.projectId, on: true },
    "project.order": { order: [t.projectId] },
    "meeting.projects": { projectIds: [t.projectId] },
    "meeting.projectsBy": { by: "participants" },
    "project.follow": { projectId: t.projectId },
    "birthdays.set": { memberId: t.memberId, birthday: "01-01" },
    "pref.set": { key: "x", value: 1 },
    "settings.save": {
      teamName: "Renamed",
      locale: "",
      hostLabel: "",
      speakSec: 60,
      autoStart: true,
      targetMin: 20,
      announcements: [],
      reminderEnabled: false,
      reminderWhen: "dayBefore",
      reminderTime: "15:00",
      sections: [{ key: "done", label: "Renamed", role: "achievement", input: "list" }],
    },
    "notifications.save": {
      rules: [{ id: t.ruleId, connectorId: t.connectorId, event: "session.started", target: {}, options: {}, enabled: false }],
    },
    "notifications.test": { connectorId: t.connectorId, target: {} },
    "transcription.allow": { allowed: false },
    "recording.start": {},
    "recording.stop": {},
    "transcript.optOut": { out: true },
    "github.configure": { sources: [{ connection: "instance", repos: "hijacked/repo" }] },
    "video.configure": { provider: "jitsi", link: "", jitsiUrl: "", bbbUrl: "" },
    "gitlab.configure": { sources: [{ connection: t.forgeConnectionId, groups: "x", projects: "x" }] },
    // A connection is added to the attacker's own meeting (its address refused before the forge is asked)
    "forge.add": { kind: "gitlab", url: "not an address", token: "glpat-hijack" },
    "forge.update": { id: t.forgeConnectionId, name: "Hijacked", url: "https://evil.test", token: "glpat-hijack" },
    "forge.test": { id: t.forgeConnectionId },
    "forge.remove": { id: t.forgeConnectionId },
    "modules.set": { moduleId: "kudos", enabled: false },
    "template.save": { name: "Copied", description: "", icon: "" },
    "agenda.save": { blocks: [{ id: "intro", type: "intro" }] },
    "retro.card.add": { column: "well", text: "hijacked" },
    "retro.card.update": { id: t.retroCardId, text: "hijacked" },
    "retro.card.delete": { id: t.retroCardId },
    "retro.group": { cardId: t.retroCardId, targetCardId: t.retroCardId },
    "retro.ungroup": { cardId: t.retroCardId },
    "retro.group.rename": { id: t.retroGroupId, title: "hijacked" },
    "retro.vote": { groupId: t.retroGroupId },
    "slide.item.add": { blockId: "irritants", text: "hijacked" },
    "slide.item.delete": { id: t.slideItemId },
    "slide.item.toAction": { id: t.slideItemId, ownerId: t.memberId },
    "poker.item.add": { title: "hijacked" },
    "poker.item.remove": { id: t.pokerItemId },
    "poker.vote": { itemId: t.pokerItemId, value: "8" },
    "poker.reveal": { itemId: t.pokerItemId },
    "poker.revote": { itemId: t.pokerItemId },
    "poker.final": { itemId: t.pokerItemId, value: "8" },
    "poker.configure": { deck: "tshirt" },
    "polls.create": { question: "hijacked", kind: "scale", options: [], anonymous: true },
    "polls.answer": { pollId: t.pollId, values: ["b"] },
    "polls.close": { pollId: t.pollId, open: false },
    "polls.show": { pollId: t.pollId },
    "polls.delete": { pollId: t.pollId },
    "retro.configure": { preset: "4l", columns: [], votesPerPerson: 9, reflectMinutes: 1, voteMinutes: 1, discussMinutes: 1 },
    // The target's name: refused by the attacker's own meeting, never applied to the target
    "meeting.remove": { confirm: t.ctx.meeting.name },
    "meeting.icon": { icon: "🚀" },
    "sounds.settings": { volume: 1 },
    "schedule.save": {
      timeZone: "",
      rules: [
        {
          freq: "daily",
          interval: 1,
          byDay: [],
          setPos: null,
          monthDay: null,
          startDate: "2030-01-01",
          until: null,
          count: null,
          time: "08:00",
          durationMin: 15,
        },
      ],
    },
    "schedule.skip": { key: t.occurrenceKey },
    "schedule.keep": { key: t.occurrenceKey },
    "schedule.holidays": { value: "FR" },
    "schedule.move": { key: t.occurrenceKey, date: "2030-01-09", time: "18:00", durationMin: null },
    "schedule.restore": { key: t.occurrenceKey },
    "attendance.set": { key: t.occurrenceKey, status: "no", personId: t.memberId },
    "rotation.assign": { role: "facilitator", personId: t.memberId },
    "rotation.configure": { roles: [] },
    "sounds.play": { sound: BOARD_SOUND_KEYS[0] },
    "notifications.nudge": {},
    "participant.add": { personId: t.memberId, role: "observer" },
    "participant.update": { id: t.memberId, role: "observer", active: false },
    "participant.remove": { id: t.memberId },
  };
}

/** Every tenant row of a workspace that belongs to a meeting, or the whole workspace, as comparable JSON */
async function dump(workspaceId: string, meetingId?: string) {
  const out: Record<string, unknown> = {};
  for (const model of TENANT_MODELS) {
    const delegate = (prisma as unknown as Record<string, { findMany: (a: object) => Promise<Record<string, unknown>[]> }>)[
      model.charAt(0).toLowerCase() + model.slice(1)
    ]!;
    const rows = await delegate.findMany({ where: { workspaceId } });
    out[model] = rows
      .filter((r) => !meetingId || (model === "Meeting" ? r.id === meetingId : !("meetingId" in r) || r.meetingId === meetingId))
      .map((r) => JSON.stringify(r))
      .sort();
  }
  return out;
}

async function attackAll(attacker: Fixture, target: Fixture) {
  const calls = attacks(target);
  // Turning a module off last, so the other module operations still run
  for (const op of [...OP_NAMES.filter((o) => o !== "modules.set"), "modules.set"]) {
    await runOp(attacker.ctx, { op, ...calls[op] }).catch(() => undefined);
  }
}

describe("meeting isolation", () => {
  let a: Fixture;
  let a2: Fixture;
  let b: Fixture;

  beforeAll(async () => {
    const wa = await workspace("acme");
    const wb = await workspace("globex");
    a = await meeting(wa, "Acme weekly");
    a2 = await meeting(wa, "Acme design review");
    b = await meeting(wb, "Globex weekly");
  });

  it("has an attack for every operation", () => {
    expect(OP_NAMES.filter((op) => !(op in attacks(b)))).toEqual([]);
  });

  it("never changes another workspace", async () => {
    const before = await dump(b.workspaceId);
    await attackAll(a, b);
    expect(await dump(b.workspaceId)).toEqual(before);
  });

  it("never changes another meeting of the same workspace", async () => {
    const before = await dump(a.workspaceId, a2.meetingId);
    const sessionBefore = await prisma.session.findMany({ where: { meetingId: a2.meetingId } });
    await attackAll(a, a2);
    const after = await dump(a.workspaceId, a2.meetingId);
    // Rows of the attacker's own meeting may change; nothing tied to the other meeting may
    for (const model of [
      "Meeting",
      "MeetingParticipant",
      "Section",
      "Session",
      "CheckIn",
      "CheckInItem",
      "Topic",
      "Action",
      "ScheduleRule",
      "ScheduleException",
      "Attendance",
      "ModuleInstallation",
      "ForgeConnection",
      "MeetingProject",
      "ProjectUpdate",
    ])
      expect(after[model]).toEqual(before[model]);
    expect(await prisma.session.findMany({ where: { meetingId: a2.meetingId } })).toEqual(sessionBefore);
    for (const model of [
      "Note",
      "Interaction",
      "Kudo",
      "CheckInComment",
      "Mood",
      "IcebreakerAnswer",
      "TopicVote",
      "RetroCard",
      "RetroGroup",
      "PokerItem",
      "Poll",
    ]) {
      const rows = (before[model] as string[]).filter((r) => r.includes(a2.sessionId) || r.includes(a2.topicId));
      expect((after[model] as string[]).filter((r) => r.includes(a2.sessionId) || r.includes(a2.topicId))).toEqual(rows);
    }
  });

  it("never shows another meeting's ids in the snapshot", async () => {
    const json = JSON.stringify(await loadSnapshot(a.ctx));
    for (const id of [b.meetingId, b.memberId, b.sessionId, b.topicId, b.actionId, b.hostPersonId, a2.meetingId, a2.memberId, a2.topicId])
      expect(json).not.toContain(id);
  });

  it("still lets the host act on their own meeting", async () => {
    const fresh = await meeting(await workspace("initech"), "Initech weekly");
    await runOp(fresh.ctx, { op: "topic.add", text: "Our own topic" });
    await runOp(fresh.ctx, { op: "kudos.add", toId: fresh.memberId, text: "Thanks!" });
    expect(await prisma.topic.count({ where: { meetingId: fresh.meetingId } })).toBe(2);
    expect(await prisma.kudo.count({ where: { sessionId: fresh.sessionId } })).toBe(2);
  });
});
