import { can, type MeetingRole, type WorkspaceRole } from "@ronde/core/permissions";
import { prisma } from "@ronde/db";
import { FEATURES } from "@ronde/editions";
import { github, gitlab, video } from "@ronde/modules";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MeetingCtx } from "@/lib/server/meeting/context";
import { runOp } from "@/lib/server/meeting/ops";
import { sendThrough } from "@/lib/server/notify/dispatch";
import { encryptSecret } from "@/lib/server/secrets";
import { type Fixture, meeting, workspace } from "./fixtures";

// Who may do what in a live meeting: the refusals of the riskiest operations, each with its exact reason

// A test message never leaves the machine: only what would be sent is checked
vi.mock("@/lib/server/notify/dispatch", async (original) => ({
  ...(await original<typeof import("@/lib/server/notify/dispatch")>()),
  sendThrough: vi.fn(async () => {}),
}));

let f: Fixture;
let ana: MeetingCtx;
let bruno: MeetingCtx;
let brunoId: string;
let n = 0;

/**
 * The meeting as one of its people, built like the app builds it: their own workspace membership, their
 * role in the meeting (null: not one of its people), and what follows from both
 */
function as(t: Fixture, personId: string, meetingRole: MeetingRole | null = "participant", workspaceRole: WorkspaceRole = "member") {
  const principal = { userId: `user-${personId}`, personId, workspaceId: t.workspaceId, workspaceRole, meetingRole };
  const allowed = (p: Parameters<typeof can>[1]) => can(principal, p);
  return {
    ...t.ctx,
    role: meetingRole,
    ws: {
      ...t.ctx.ws,
      member: { ...t.ctx.ws.member, personId, role: workspaceRole },
      principal,
      can: (p) => can({ ...principal, meetingRole: null }, p),
    },
    viewer: {
      userId: principal.userId,
      personId,
      email: `${personId}@guards.test`,
      name: "Someone",
      memberId: meetingRole && meetingRole !== "observer" ? personId : null,
      isHost: allowed("session.run"),
      isAdmin: allowed("meeting.configure"),
    },
    can: allowed,
  } satisfies MeetingCtx;
}

async function person(t: Fixture, firstName: string, data: { active?: boolean; phone?: string } = {}) {
  return prisma.person.create({
    data: { workspaceId: t.workspaceId, email: `${firstName.toLowerCase()}-${++n}@guards.test`, firstName, ...data },
  });
}

async function join(t: Fixture, personId: string, role: MeetingRole = "participant") {
  await prisma.meetingParticipant.create({
    data: { workspaceId: t.workspaceId, meetingId: t.meetingId, personId, role, position: 10 + n },
  });
}

async function enable(t: Fixture, ...moduleIds: string[]) {
  for (const moduleId of moduleIds)
    await prisma.moduleInstallation.upsert({
      where: { meetingId_moduleId: { meetingId: t.meetingId, moduleId } },
      create: { workspaceId: t.workspaceId, meetingId: t.meetingId, moduleId, enabled: true, config: {} },
      update: { enabled: true },
    });
}

const session = () => prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } });
const roleOf = async (personId: string) =>
  (await prisma.meetingParticipant.findFirst({ where: { meetingId: f.meetingId, personId } }))?.role ?? null;

beforeEach(async () => {
  f = await meeting(await workspace(`guards-${Date.now().toString(36)}-${++n}`), "Weekly");
  const b = await person(f, "Bruno");
  await join(f, b.id);
  brunoId = b.id;
  ana = as(f, f.memberId);
  bruno = as(f, b.id);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("participant.update", () => {
  it("lets the host hand out every role, then keeps one host at least", async () => {
    for (const role of ["cohost", "observer", "participant", "host"] as const) {
      await runOp(f.ctx, { op: "participant.update", id: f.memberId, role });
      expect(await roleOf(f.memberId)).toBe(role);
    }
    // Two hosts: one may step down; the other is then the last one
    await runOp(f.ctx, { op: "participant.update", id: f.hostPersonId, role: "participant" });
    await expect(runOp(f.ctx, { op: "participant.update", id: f.memberId, role: "cohost" })).rejects.toMatchObject({ key: "lastHost" });
    expect(await roleOf(f.memberId)).toBe("host");
  });

  it("refuses to leave the meeting without a host", async () => {
    await expect(runOp(f.ctx, { op: "participant.update", id: f.hostPersonId, role: "cohost" })).rejects.toMatchObject({
      key: "lastHost",
    });
    expect(await roleOf(f.hostPersonId)).toBe("host");
  });

  it("refuses someone who is not one of the meeting's people", async () => {
    const outsider = await person(f, "Out");
    await expect(runOp(f.ctx, { op: "participant.update", id: outsider.id, role: "host" })).rejects.toMatchObject({
      key: "unknownMember",
    });
  });

  it("is kept to those who manage the participants", async () => {
    await expect(runOp(ana, { op: "participant.update", id: f.memberId, role: "host" })).rejects.toMatchObject({
      status: 403,
      key: "accessDenied",
    });
    // A co-host runs sessions, not the list of people
    const cohost = as(f, f.memberId, "cohost");
    await expect(runOp(cohost, { op: "participant.update", id: brunoId, role: "cohost" })).rejects.toMatchObject({
      status: 403,
      key: "accessDenied",
    });
    expect(await roleOf(f.memberId)).toBe("participant");
  });
});

describe("participant.add", () => {
  it("adds a person of the workspace, as a host too, and tells them", async () => {
    const carla = await person(f, "Carla");
    await runOp(f.ctx, { op: "participant.add", personId: carla.id, role: "host" });
    expect(await roleOf(carla.id)).toBe("host");
    expect((await session()).order).toContain(carla.id);
    expect(await prisma.inboxItem.count({ where: { personId: carla.id, kind: "meeting.joined" } })).toBe(1);
    // An observer does not take a turn
    const olga = await person(f, "Olga");
    await runOp(f.ctx, { op: "participant.add", personId: olga.id, role: "observer" });
    expect((await session()).order).not.toContain(olga.id);
  });

  it("refuses an unknown or inactive person, and someone already there", async () => {
    await expect(runOp(f.ctx, { op: "participant.add", personId: "nobody" })).rejects.toMatchObject({ key: "unknownMember" });
    const gone = await person(f, "Gone", { active: false });
    await expect(runOp(f.ctx, { op: "participant.add", personId: gone.id })).rejects.toMatchObject({ key: "unknownMember" });
    await expect(runOp(f.ctx, { op: "participant.add", personId: f.memberId })).rejects.toMatchObject({ key: "alreadyParticipant" });
    expect(await roleOf(gone.id)).toBeNull();
  });

  it("is kept to those who manage the participants", async () => {
    const carla = await person(f, "Carla");
    await expect(runOp(ana, { op: "participant.add", personId: carla.id, role: "host" })).rejects.toMatchObject({
      status: 403,
      key: "accessDenied",
    });
    expect(await roleOf(carla.id)).toBeNull();
  });
});

describe("participant.remove", () => {
  it("removes someone from the meeting and its session, never the last host", async () => {
    await runOp(f.ctx, { op: "participant.remove", id: brunoId });
    expect(await roleOf(brunoId)).toBeNull();
    await expect(runOp(f.ctx, { op: "participant.remove", id: f.hostPersonId })).rejects.toMatchObject({ key: "lastHost" });
    expect(await roleOf(f.hostPersonId)).toBe("host");
  });

  it("is kept to those who manage the participants", async () => {
    await expect(runOp(ana, { op: "participant.remove", id: brunoId })).rejects.toMatchObject({ status: 403, key: "accessDenied" });
    expect(await roleOf(brunoId)).toBe("participant");
  });
});

describe("someone else's data", () => {
  it("birthdays: each person sets their own, unless they manage the directory", async () => {
    await enable(f, "birthdays");
    await runOp(ana, { op: "birthdays.set", memberId: f.memberId, birthday: "02-29" });
    await expect(runOp(ana, { op: "birthdays.set", memberId: brunoId, birthday: "01-01" })).rejects.toMatchObject({
      status: 403,
      key: "ownBirthdayOnly",
    });
    expect((await prisma.person.findUniqueOrThrow({ where: { id: brunoId } })).birthday).toBeNull();
    // The workspace owner manages the directory, but only of people who exist
    await runOp(f.ctx, { op: "birthdays.set", memberId: brunoId, birthday: "12-31" });
    await expect(runOp(f.ctx, { op: "birthdays.set", memberId: "nobody", birthday: "12-31" })).rejects.toMatchObject({
      key: "unknownMember",
    });
    expect((await prisma.person.findUniqueOrThrow({ where: { id: f.memberId } })).birthday).toBe("02-29");
  });

  it("check-ins: a participant writes their own, the host anyone's among the meeting's people", async () => {
    const lines = { done: ["Fixed the build"], next: [], blockers: [], other: [] };
    await expect(runOp(bruno, { op: "checkIn.save", memberId: f.memberId, ...lines })).rejects.toMatchObject({
      status: 403,
      key: "ownCheckInOnly",
    });
    expect(await prisma.checkInItem.count({ where: { personId: f.memberId, text: "Fixed the build" } })).toBe(0);
    await runOp(bruno, { op: "checkIn.save", memberId: brunoId, ...lines });
    expect(await prisma.checkInItem.count({ where: { personId: brunoId, text: "Fixed the build" } })).toBe(1);
    const outsider = await person(f, "Out");
    await expect(runOp(f.ctx, { op: "checkIn.save", memberId: outsider.id, ...lines })).rejects.toMatchObject({ key: "unknownMember" });
  });

  it("actions: their owner moves them forward, only the host reassigns them", async () => {
    await expect(runOp(bruno, { op: "action.update", id: f.actionId, status: "done" })).rejects.toMatchObject({
      status: 403,
      key: "ownActionsOnly",
    });
    // Even their owner cannot hand them to someone else
    await expect(runOp(ana, { op: "action.update", id: f.actionId, ownerId: brunoId })).rejects.toMatchObject({
      status: 403,
      key: "ownActionsOnly",
    });
    await runOp(ana, { op: "action.update", id: f.actionId, status: "doing" });
    expect(await prisma.action.findUniqueOrThrow({ where: { id: f.actionId } })).toMatchObject({ status: "doing", ownerId: f.memberId });

    const outsider = await person(f, "Out");
    await expect(runOp(f.ctx, { op: "action.update", id: f.actionId, ownerId: outsider.id })).rejects.toMatchObject({
      key: "unknownOwner",
    });
    await expect(runOp(f.ctx, { op: "action.update", id: "nothing", status: "done" })).rejects.toMatchObject({ key: "notFound" });
    await runOp(f.ctx, { op: "action.update", id: f.actionId, ownerId: brunoId, status: "done" });
    expect(await prisma.action.findUniqueOrThrow({ where: { id: f.actionId } })).toMatchObject({ status: "done", ownerId: brunoId });
    expect(await prisma.inboxItem.count({ where: { personId: brunoId, kind: "action.assigned" } })).toBe(1);
  });
});

describe("deletion", () => {
  it("removes a meeting only when its name is typed back, by those allowed to delete it", async () => {
    await expect(runOp(f.ctx, { op: "meeting.remove", confirm: "Weakly" })).rejects.toMatchObject({ key: "confirmationMismatch" });
    for (const who of [as(f, f.memberId, "cohost"), ana])
      await expect(runOp(who, { op: "meeting.remove", confirm: "Weekly" })).rejects.toMatchObject({ status: 403, key: "accessDenied" });
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } })).archivedAt).toBeNull();
    await runOp(f.ctx, { op: "meeting.remove", confirm: "  Weekly " });
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } })).archivedAt).not.toBeNull();
  });

  it("resets a session to its waiting screen: what happened goes, what was prepared stays", async () => {
    await prisma.session.update({
      where: { id: f.sessionId },
      data: { stepKey: f.memberId, spent: { intro: 60_000 }, bonus: { intro: 30_000 }, spotlight: { label: "", text: "Look" } },
    });
    await prisma.reaction.create({
      data: { workspaceId: f.workspaceId, sessionId: f.sessionId, emoji: "👏", byId: f.memberId, stepKey: "intro" },
    });
    await expect(runOp(ana, { op: "meeting.reset" })).rejects.toMatchObject({ status: 403, key: "hostOnly" });
    expect(await prisma.kudo.count({ where: { sessionId: f.sessionId } })).toBe(1);

    await runOp(f.ctx, { op: "meeting.reset" });
    const s = await session();
    expect(s).toMatchObject({
      stepKey: "intro",
      startedAt: null,
      endedAt: null,
      timerRunning: false,
      spotlight: null,
      spent: {},
      bonus: {},
    });
    const where = { sessionId: f.sessionId };
    expect(await prisma.interaction.count({ where })).toBe(0);
    expect(await prisma.reaction.count({ where })).toBe(0);
    expect(await prisma.kudo.count({ where })).toBe(0);
    // Prepared before the session: kept
    expect(await prisma.note.count({ where })).toBe(1);
    expect(await prisma.mood.count({ where })).toBe(1);
    expect(await prisma.icebreakerAnswer.count({ where })).toBe(1);
    expect(await prisma.checkInItem.count({ where: { meetingId: f.meetingId, sessionId: null } })).toBe(2);
    expect(await prisma.action.count({ where: { meetingId: f.meetingId } })).toBe(1);
  });

  it("deletes an action from the control room only", async () => {
    await expect(runOp(ana, { op: "action.delete", id: f.actionId })).rejects.toMatchObject({ status: 403, key: "hostOnly" });
    expect(await prisma.action.count({ where: { id: f.actionId } })).toBe(1);
    await runOp(f.ctx, { op: "action.delete", id: f.actionId });
    expect(await prisma.action.count({ where: { id: f.actionId } })).toBe(0);
  });
});

describe("deleting what someone else wrote", () => {
  it("topics: their author or the host", async () => {
    await expect(runOp(bruno, { op: "topic.delete", id: f.topicId })).rejects.toMatchObject({ status: 403, key: "ownTopicsOnly" });
    expect(await prisma.topic.count({ where: { id: f.topicId } })).toBe(1);
    await runOp(ana, { op: "topic.delete", id: f.topicId });
    expect(await prisma.topic.count({ where: { id: f.topicId } })).toBe(0);
    const other = await prisma.topic.create({ data: { workspaceId: f.workspaceId, meetingId: f.meetingId, text: "Mine", byId: brunoId } });
    await runOp(f.ctx, { op: "topic.delete", id: other.id });
    expect(await prisma.topic.count({ where: { id: other.id } })).toBe(0);
  });

  it("comments: their author or the host", async () => {
    await expect(runOp(bruno, { op: "comment.delete", id: f.commentId })).rejects.toMatchObject({ status: 403, key: "ownCommentsOnly" });
    expect(await prisma.checkInComment.count({ where: { id: f.commentId } })).toBe(1);
    await runOp(ana, { op: "comment.delete", id: f.commentId });
    expect(await prisma.checkInComment.count({ where: { id: f.commentId } })).toBe(0);
  });

  it("kudos: the person who gave them or the host", async () => {
    await expect(runOp(bruno, { op: "kudos.delete", id: f.kudoId })).rejects.toMatchObject({ status: 403, key: "ownKudosOnly" });
    // Not even the person thanked
    await expect(runOp(as(f, f.hostPersonId, "participant"), { op: "kudos.delete", id: f.kudoId })).rejects.toMatchObject({
      status: 403,
      key: "ownKudosOnly",
    });
    expect(await prisma.kudo.count({ where: { id: f.kudoId } })).toBe(1);
    await runOp(f.ctx, { op: "kudos.delete", id: f.kudoId });
    expect(await prisma.kudo.count({ where: { id: f.kudoId } })).toBe(0);
  });

  it("raised hands and questions: the person who raised them or the host", async () => {
    await expect(runOp(bruno, { op: "hands.delete", id: f.interactionId })).rejects.toMatchObject({ status: 403, key: "ownRequestsOnly" });
    expect(await prisma.interaction.count({ where: { id: f.interactionId } })).toBe(1);
    await runOp(ana, { op: "hands.delete", id: f.interactionId });
    expect(await prisma.interaction.count({ where: { id: f.interactionId } })).toBe(0);
  });

  it("retro notes: only their author edits them, and only while the team writes", async () => {
    await enable(f, "retro");
    await prisma.meeting.update({
      where: { id: f.meetingId },
      data: {
        agenda: [
          { id: "intro", type: "intro" },
          { id: "retro", type: "retro" },
        ],
      },
    });
    f.ctx.meeting = ana.meeting = bruno.meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } });
    await expect(runOp(ana, { op: "retro.card.update", id: f.retroCardId, text: "Too early" })).rejects.toMatchObject({
      key: "retroWrongPhase",
    });
    await runOp(f.ctx, { op: "meeting.goto", key: "retro:reflect" });
    await expect(runOp(bruno, { op: "retro.card.update", id: f.retroCardId, text: "Not mine" })).rejects.toMatchObject({
      status: 403,
      key: "retroOwnCardsOnly",
    });
    // The host neither: the notes are anonymous, nobody rewrites them
    await expect(runOp(f.ctx, { op: "retro.card.update", id: f.retroCardId, text: "Host's" })).rejects.toMatchObject({
      status: 403,
      key: "retroOwnCardsOnly",
    });
    await runOp(ana, { op: "retro.card.update", id: f.retroCardId, text: "Reworded" });
    expect((await prisma.retroCard.findUniqueOrThrow({ where: { id: f.retroCardId } })).text).toBe("Reworded");
  });
});

describe("visibility and plans", () => {
  it("follows only projects the person setting the meeting up can see", async () => {
    // A host who is a plain member of the workspace
    const host = as(f, f.hostPersonId, "host", "member");
    const hidden = await prisma.project.create({
      data: { workspaceId: f.workspaceId, slug: `hidden-${n}`, name: "Hidden", visibility: "members" },
    });
    await expect(runOp(host, { op: "meeting.projects", projectIds: [f.projectId, hidden.id] })).rejects.toMatchObject({
      key: "notFound",
    });
    expect(await prisma.meetingProject.count({ where: { meetingId: f.meetingId } })).toBe(1);
    // Once one of its members, they see it
    await prisma.projectMember.create({ data: { workspaceId: f.workspaceId, projectId: hidden.id, personId: f.hostPersonId } });
    await runOp(host, { op: "meeting.projects", projectIds: [f.projectId, hidden.id] });
    expect(await prisma.meetingProject.count({ where: { meetingId: f.meetingId } })).toBe(2);
  });

  it("sends a test through a connector, to the person testing only", async () => {
    const send = vi.mocked(sendThrough);
    send.mockClear();
    await expect(runOp(f.ctx, { op: "notifications.test", connectorId: "nothing" })).rejects.toMatchObject({ key: "notFound" });
    const email = await prisma.connector.create({ data: { workspaceId: f.workspaceId, kind: "email", name: "Mail", config: {} } });
    await expect(runOp(f.ctx, { op: "notifications.test", connectorId: email.id })).rejects.toMatchObject({
      key: "connectorTargetMissing",
    });
    expect(send).not.toHaveBeenCalled();
    await runOp(f.ctx, { op: "notifications.test", connectorId: email.id, target: { audience: "participants" } });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![5]).toEqual([f.ctx.viewer.email]);
  });

  it("sends a text-message test only to a phone the person gave, with Team", async () => {
    const send = vi.mocked(sendThrough);
    send.mockClear();
    const sms = await prisma.connector.create({ data: { workspaceId: f.workspaceId, kind: "sms", name: "SMS", config: {} } });
    const test = { op: "notifications.test", connectorId: sms.id, target: { audience: "hosts" } };
    await expect(runOp(f.ctx, test)).rejects.toMatchObject({ status: 403, key: "featureNotInPlan" });
    vi.stubEnv("RONDE_CLOUD", "1");
    f.ctx.ws.workspace.plan = "team";
    await expect(runOp(f.ctx, test)).rejects.toMatchObject({ key: "testNoPhone" });
    await prisma.person.update({ where: { id: f.hostPersonId }, data: { phone: "+33612345678" } });
    await runOp(f.ctx, test);
    expect(send.mock.calls.at(-1)![5]).toEqual(["+33612345678"]);
  });

  it("refuses a test for a meeting that was removed", async () => {
    await prisma.meeting.update({ where: { id: f.meetingId }, data: { archivedAt: new Date() } });
    await expect(runOp(f.ctx, { op: "notifications.test", connectorId: f.connectorId })).rejects.toMatchObject({ key: "notFound" });
  });

  it("allows a few tests a minute per meeting, not a way to send mail", async () => {
    for (let i = 0; i < 5; i++) await runOp(f.ctx, { op: "notifications.test", connectorId: f.connectorId });
    await expect(runOp(f.ctx, { op: "notifications.test", connectorId: f.connectorId })).rejects.toMatchObject({ key: "testTooOften" });
  });

  it("allows transcription only with a plan that has it", async () => {
    await expect(runOp(f.ctx, { op: "transcription.allow", allowed: true })).rejects.toMatchObject({
      status: 403,
      key: "featureNotInPlan",
    });
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } })).transcription).toBe(false);
    // Turning it off is always possible, and stops a recording under way
    await prisma.session.update({ where: { id: f.sessionId }, data: { recordingSince: new Date(), recordingBy: f.hostPersonId } });
    await runOp(f.ctx, { op: "transcription.allow", allowed: false });
    expect(await session()).toMatchObject({ recordingSince: null, recordingBy: null });
  });

  it("records only when transcription is on, during a session", async () => {
    await expect(runOp(f.ctx, { op: "recording.start" })).rejects.toMatchObject({ key: "transcriptionOff" });
    vi.stubEnv("RONDE_CLOUD", "1");
    f.ctx.ws.workspace.plan = "team";
    f.ctx.ws.workspace.settings = {
      transcription: { enabled: true, baseUrl: "", model: "whisper-1", language: "en", key: encryptSecret("sk-test") },
    };
    // The workspace has it, the meeting does not allow it yet
    await expect(runOp(f.ctx, { op: "recording.start" })).rejects.toMatchObject({ key: "transcriptionOff" });
    await runOp(f.ctx, { op: "transcription.allow", allowed: true });
    f.ctx.meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } });
    await expect(runOp(ana, { op: "recording.start" })).rejects.toMatchObject({ status: 403, key: "hostOnly" });
    await runOp(f.ctx, { op: "recording.start" });
    expect(await session()).toMatchObject({ recordingBy: f.hostPersonId, recordingSince: expect.any(Date) });
    await runOp(f.ctx, { op: "recording.stop" });
    expect(await session()).toMatchObject({ recordingSince: null, recordingBy: null });

    await prisma.session.update({ where: { id: f.sessionId }, data: { status: "archived" } });
    await expect(runOp(f.ctx, { op: "recording.start" })).rejects.toMatchObject({ key: "noMeeting" });
  });

  it("lets a person take their turns out of the transcript, and back in", async () => {
    const segment = (speakerId: string) =>
      prisma.transcriptSegment.create({
        data: { workspaceId: f.workspaceId, sessionId: f.sessionId, at: new Date(), text: "Hello", speakerId },
      });
    await segment(f.memberId);
    await segment(brunoId);
    await runOp(ana, { op: "transcript.optOut", out: true });
    expect((await session()).transcriptOptOut).toEqual([f.memberId]);
    // What was transcribed of their turns goes; the others' stays
    expect(await prisma.transcriptSegment.count({ where: { sessionId: f.sessionId, speakerId: f.memberId } })).toBe(0);
    expect(await prisma.transcriptSegment.count({ where: { sessionId: f.sessionId, speakerId: brunoId } })).toBe(1);
    await runOp(bruno, { op: "transcript.optOut", out: false });
    expect((await session()).transcriptOptOut).toEqual([f.memberId]);
    await runOp(ana, { op: "transcript.optOut", out: false });
    expect((await session()).transcriptOptOut).toEqual([]);
  });
});

describe("secrets", () => {
  /** An instance without SECRET_KEY: no development fallback either */
  const withoutKey = () => {
    vi.stubEnv("SECRET_KEY", "");
    vi.stubEnv("NODE_ENV", "production");
  };
  const configOf = async (moduleId: string) =>
    (await prisma.moduleInstallation.findFirst({ where: { meetingId: f.meetingId, moduleId } }))?.config ?? null;

  it("are refused rather than stored in clear when no key is configured", async () => {
    await enable(f, "github");
    withoutKey();
    await expect(runOp(f.ctx, { op: "github.configure", repos: "acme/app", token: "ghp_secret" })).rejects.toMatchObject({
      key: "encryptionNotConfigured",
    });
    await expect(runOp(f.ctx, { op: "gitlab.configure", projects: "acme/app", groups: "", token: "glpat-secret" })).rejects.toMatchObject({
      key: "encryptionNotConfigured",
    });
    await expect(
      runOp(f.ctx, {
        op: "video.configure",
        provider: "bbb",
        link: "",
        jitsiUrl: "",
        bbbUrl: "https://bbb.example.org/bigbluebutton",
        secret: "bbb-secret",
      }),
    ).rejects.toMatchObject({ key: "encryptionNotConfigured" });
    // Nothing was half saved
    expect(await configOf("github")).toEqual({});
    expect(await configOf("gitlab")).toBeNull();
    expect(await configOf("video")).toBeNull();
    const rows = await prisma.moduleInstallation.findMany({ where: { meetingId: f.meetingId } });
    expect(rows.every((r) => r.secret === "")).toBe(true);
    // Removing a token, or leaving it as it is, needs no key
    await runOp(f.ctx, { op: "github.configure", repos: "acme/app", token: "" });
    await runOp(f.ctx, { op: "gitlab.configure", projects: "acme/app", groups: "" });
    expect(await configOf("github")).toEqual({ repos: "acme/app" });
  });

  it("are stored encrypted when a key is configured", async () => {
    await runOp(f.ctx, { op: "gitlab.configure", projects: "acme/app", groups: "acme", token: "glpat-secret" });
    const row = await prisma.moduleInstallation.findFirstOrThrow({ where: { meetingId: f.meetingId, moduleId: "gitlab" } });
    expect(row.secret).toMatch(/^v1:/);
    expect(row.secret).not.toContain("glpat-secret");
  });

  it("need the module's installation (always given by runOp)", async () => {
    const bare = { module: null } as never;
    await expect(github.ops[0].run(bare, { repos: "", token: "x" })).rejects.toMatchObject({ key: "notFound" });
    await expect(gitlab.ops[0].run(bare, { projects: "", groups: "", token: "x" })).rejects.toMatchObject({ key: "notFound" });
    await expect(video.ops[0].run(bare, { provider: "link", link: "", jitsiUrl: "", bbbUrl: "" })).rejects.toMatchObject({
      key: "notFound",
    });
  });
});

describe("module gates", () => {
  /** The instance's edition without one feature, for the time of a test */
  async function withheld(feature: keyof typeof FEATURES, fn: () => Promise<void>) {
    const def = FEATURES[feature] as { available: boolean };
    def.available = false;
    try {
      await fn();
    } finally {
      def.available = true;
    }
  }

  it("turns on only the modules the edition has", async () => {
    await expect(runOp(f.ctx, { op: "modules.set", moduleId: "nothing", enabled: true })).rejects.toMatchObject({ key: "notFound" });
    await enable(f, "github");
    await withheld("integrations.github", async () => {
      await expect(runOp(f.ctx, { op: "modules.set", moduleId: "github", enabled: true })).rejects.toMatchObject({
        status: 403,
        key: "moduleNotInEdition",
      });
      // An installation kept from before runs none of its operations either
      await expect(runOp(f.ctx, { op: "github.configure", repos: "acme/app" })).rejects.toMatchObject({
        status: 403,
        key: "moduleNotInEdition",
      });
    });
    await runOp(f.ctx, { op: "modules.set", moduleId: "github", enabled: false });
    await expect(runOp(f.ctx, { op: "github.configure", repos: "acme/app" })).rejects.toMatchObject({ status: 403, key: "moduleDisabled" });
  });

  it("attendance: each person answers for themselves, the host for the meeting's people", async () => {
    const ruleId = f.occurrenceKey.split(":")[0]!;
    const key = `${ruleId}:2030-01-14`;
    await runOp(ana, { op: "attendance.set", key, status: "no" });
    expect(await prisma.attendance.findFirst({ where: { meetingId: f.meetingId, personId: f.memberId } })).toMatchObject({
      occurrenceKey: key,
      status: "no",
    });
    await expect(runOp(ana, { op: "attendance.set", key, status: "no", personId: brunoId })).rejects.toMatchObject({
      status: 403,
      key: "accessDenied",
    });
    // A workspace admin who is not one of the meeting's people has no answer to give
    const admin = as(f, (await person(f, "Admin")).id, null, "admin");
    await expect(runOp(admin, { op: "attendance.set", key, status: "yes" })).rejects.toMatchObject({ key: "notAMember" });
    const outsider = await person(f, "Out");
    await expect(runOp(f.ctx, { op: "attendance.set", key, status: "no", personId: outsider.id })).rejects.toMatchObject({
      key: "unknownMember",
    });
    await expect(
      runOp(f.ctx, { op: "attendance.set", key: "elsewhere:2030-01-14", status: "no", personId: brunoId }),
    ).rejects.toMatchObject({ key: "notFound" });
    await runOp(f.ctx, { op: "attendance.set", key, status: "no", personId: brunoId });
    expect(await prisma.attendance.count({ where: { meetingId: f.meetingId, occurrenceKey: key } })).toBe(2);
  });

  it("history: the summary of archived minutes is edited by those who edit minutes", async () => {
    const archived = await prisma.session.create({
      data: { workspaceId: f.workspaceId, meetingId: f.meetingId, date: "2029-12-31", status: "archived", archivedAt: new Date() },
    });
    await expect(runOp(ana, { op: "history.summary", date: "2029-12-31", summary: "Mine" })).rejects.toMatchObject({
      status: 403,
      key: "accessDenied",
    });
    // The current session has no minutes yet
    await expect(runOp(f.ctx, { op: "history.summary", date: "2030-01-07", summary: "Too early" })).rejects.toMatchObject({
      key: "notFound",
    });
    await runOp(f.ctx, { op: "history.summary", date: "2029-12-31", summary: "  We shipped.  " });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: archived.id } })).summary).toBe("We shipped.");
    await runOp(f.ctx, { op: "history.summary", date: "2029-12-31", summary: " " });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: archived.id } })).summary).toBeNull();
  });

  it("joining a line: the meeting's people join, its author or the host take someone off", async () => {
    const line = { ownerId: f.memberId, section: "done", itemText: "shipped", projectId: null };
    const item = await prisma.checkInItem.findFirstOrThrow({ where: { meetingId: f.meetingId, text: "shipped" } });
    const contributors = () => prisma.checkInItemContributor.findMany({ where: { itemId: item.id }, select: { personId: true } });

    await expect(runOp(bruno, { op: "item.with", ...line, itemText: "never written", on: true })).rejects.toMatchObject({
      key: "notFound",
    });
    // Someone running the meeting without being one of its people
    const admin = as(f, f.hostPersonId, null, "owner");
    await expect(runOp(admin, { op: "item.with", ...line, on: true })).rejects.toMatchObject({ status: 403, key: "joinParticipantsOnly" });
    // Someone whose membership was lost meanwhile
    const left = as(f, (await person(f, "Left")).id, "participant");
    await expect(runOp(left, { op: "item.with", ...line, on: true })).rejects.toMatchObject({ status: 403, key: "joinParticipantsOnly" });
    // Nobody adds someone else
    await expect(runOp(ana, { op: "item.with", ...line, on: true, personId: brunoId })).rejects.toMatchObject({
      status: 403,
      key: "ownCheckInOnly",
    });

    await runOp(bruno, { op: "item.with", ...line, on: true });
    await runOp(f.ctx, { op: "item.with", ...line, on: true });
    expect((await contributors()).map((c) => c.personId).sort()).toEqual([brunoId, f.hostPersonId].sort());
    // A participant who neither wrote the line nor runs the meeting takes nobody off it
    const carla = as(f, (await person(f, "Carla")).id);
    await join(f, carla.viewer.personId);
    await expect(runOp(carla, { op: "item.with", ...line, on: false, personId: brunoId })).rejects.toMatchObject({
      status: 403,
      key: "ownCheckInOnly",
    });
    // Its author does, and so does the host
    await runOp(ana, { op: "item.with", ...line, on: false, personId: brunoId });
    await runOp(f.ctx, { op: "item.with", ...line, on: false, personId: f.hostPersonId });
    expect(await contributors()).toEqual([]);
  });

  it("notification rules: a connector of the workspace, a target and valid options", async () => {
    const rule = (r: object) => ({ op: "notifications.save", rules: [{ connectorId: f.connectorId, event: "session.started", ...r }] });
    await expect(runOp(f.ctx, rule({ connectorId: "nothing" }))).rejects.toMatchObject({ key: "notFound" });
    const email = await prisma.connector.create({ data: { workspaceId: f.workspaceId, kind: "email", name: "Mail", config: {} } });
    await expect(runOp(f.ctx, rule({ connectorId: email.id }))).rejects.toMatchObject({ key: "connectorTargetMissing" });
    await expect(runOp(f.ctx, rule({ event: "session.soon", options: { minutesBefore: 0 } }))).rejects.toMatchObject({
      key: "connectorInvalid",
    });
    // Refused: the rules saved before are untouched
    expect(await prisma.notificationRule.findMany({ where: { meetingId: f.meetingId }, select: { id: true } })).toEqual([{ id: f.ruleId }]);
    await runOp(
      f.ctx,
      rule({ connectorId: email.id, target: { audience: "hosts" }, event: "session.soon", options: { minutesBefore: 15 } }),
    );
    expect(await prisma.notificationRule.findMany({ where: { meetingId: f.meetingId } })).toEqual([
      expect.objectContaining({
        connectorId: email.id,
        event: "session_soon",
        target: { audience: "hosts" },
        options: { minutesBefore: 15 },
      }),
    ]);
  });
});

describe("refusals common to every operation", () => {
  it("refuses an operation that does not exist, or a request that is not one", async () => {
    await expect(runOp(f.ctx, { op: "meeting.explode" })).rejects.toMatchObject({ key: "invalidRequest" });
    await expect(runOp(f.ctx, null)).rejects.toMatchObject({ key: "invalidRequest" });
    await expect(runOp(f.ctx, { op: "topic.add", text: "" })).rejects.toMatchObject({ key: "invalidRequest" });
  });

  it("refuses the control room to participants, with a reason they understand", async () => {
    await expect(runOp(ana, { op: "meeting.goto", key: "end" })).rejects.toMatchObject({ status: 403, key: "hostOnly" });
    await expect(runOp(ana, { op: "meeting.icon", icon: "🚀" })).rejects.toMatchObject({ status: 403, key: "accessDenied" });
    // An observer follows, never takes part
    const observer = as(f, brunoId, "observer");
    await expect(runOp(observer, { op: "topic.add", text: "Hello" })).rejects.toMatchObject({ status: 403, key: "accessDenied" });
  });

  it("refuses what needs a session when there is none", async () => {
    await prisma.session.update({ where: { id: f.sessionId }, data: { status: "archived" } });
    await expect(runOp(f.ctx, { op: "meeting.bonus" })).rejects.toMatchObject({ key: "noMeeting" });
    await expect(runOp(ana, { op: "hands.add", type: "hand" })).rejects.toMatchObject({ key: "noMeeting" });
  });

  it("refuses the operations of a module that is off", async () => {
    await expect(runOp(ana, { op: "mood.set", value: 3 })).rejects.toMatchObject({ status: 403, key: "moduleDisabled" });
  });
});
