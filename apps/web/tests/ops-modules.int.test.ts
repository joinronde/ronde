import { can, type Permission } from "@ronde/core/permissions";
import { parseSound } from "@ronde/core/sound";
import { prisma } from "@ronde/db";
import { rotation } from "@ronde/modules";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { publish } from "@/lib/server/bus";
import type { MeetingCtx } from "@/lib/server/meeting/context";
import { runOp } from "@/lib/server/meeting/ops";
import { type Fixture, meeting, workspace } from "./fixtures";

// The operations of the live meeting and its modules: what each one does, and what it refuses

// Events sent to the screens are recorded here instead of going through PostgreSQL
vi.mock("@/lib/server/bus", async (original) => ({
  ...(await original<typeof import("@/lib/server/bus")>()),
  publish: vi.fn(async () => {}),
}));

let f: Fixture;
let ana: MeetingCtx;
let bruno: MeetingCtx;
let brunoId: string;
let n = 0;

/** The meeting seen and run by one participant */
function participantCtx(personId: string, name: string): MeetingCtx {
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
    viewer: { userId: principal.userId, personId, email: `${name}@modules.test`, name, memberId: personId, isHost: false, isAdmin: false },
    can: (p) => can(principal, p),
  };
}

/** A workspace member whose custom role lets them take part in every meeting, without being one of this one's people */
function guestCtx(personId: string): MeetingCtx {
  const principal = {
    userId: `user-${personId}`,
    personId,
    workspaceId: f.workspaceId,
    workspaceRole: "member" as const,
    meetingRole: null,
    extra: ["session.participate"] as Permission[],
  };
  return {
    ...f.ctx,
    role: null,
    viewer: {
      userId: principal.userId,
      personId,
      email: "guest@modules.test",
      name: "Guest",
      memberId: null,
      isHost: false,
      isAdmin: false,
    },
    can: (p) => can(principal, p),
  };
}

const outsider = () => prisma.person.create({ data: { workspaceId: f.workspaceId, email: `out-${++n}@modules.test`, firstName: "Out" } });

async function enable(moduleId: string, config: object = {}) {
  await prisma.moduleInstallation.upsert({
    where: { meetingId_moduleId: { meetingId: f.meetingId, moduleId } },
    create: { workspaceId: f.workspaceId, meetingId: f.meetingId, moduleId, enabled: true, config },
    update: { enabled: true, config },
  });
}

/** Sets the agenda between two sessions, as the settings would, and reloads it in every context */
async function withAgenda(agenda: { id: string; type: string }[]) {
  await prisma.meeting.update({ where: { id: f.meetingId }, data: { agenda } });
  f.ctx.meeting = ana.meeting = bruno.meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } });
}

const session = () => prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } });
const published = () => vi.mocked(publish).mock.calls.map(([, event]) => event);

beforeEach(async () => {
  f = await meeting(await workspace(`modules-${Date.now().toString(36)}-${++n}`), "Weekly");
  const b = await prisma.person.create({ data: { workspaceId: f.workspaceId, email: `bruno-${n}@modules.test`, firstName: "Bruno" } });
  await prisma.meetingParticipant.create({ data: { workspaceId: f.workspaceId, meetingId: f.meetingId, personId: b.id, position: 2 } });
  brunoId = b.id;
  ana = participantCtx(f.memberId, "ana");
  bruno = participantCtx(b.id, "bruno");
  vi.mocked(publish).mockClear();
});

describe("topics", () => {
  it("are marked handled from the control room", async () => {
    await expect(runOp(ana, { op: "topic.done", id: f.topicId, done: true })).rejects.toMatchObject({ status: 403, key: "hostOnly" });
    await runOp(f.ctx, { op: "topic.done", id: f.topicId, done: true });
    expect((await prisma.topic.findUniqueOrThrow({ where: { id: f.topicId } })).done).toBe(true);
    await runOp(f.ctx, { op: "topic.done", id: f.topicId, done: false });
    expect((await prisma.topic.findUniqueOrThrow({ where: { id: f.topicId } })).done).toBe(false);
  });

  it("take a few votes per person, given back when withdrawn", async () => {
    await expect(runOp(bruno, { op: "topic.vote", id: "nothing" })).rejects.toMatchObject({ key: "notFound" });
    const topics = [f.topicId];
    for (const text of ["CI is slow", "Release train", "Hiring"])
      topics.push((await prisma.topic.create({ data: { workspaceId: f.workspaceId, meetingId: f.meetingId, text, byId: brunoId } })).id);
    for (const id of topics.slice(0, 3)) await runOp(bruno, { op: "topic.vote", id });
    await expect(runOp(bruno, { op: "topic.vote", id: topics[3]! })).rejects.toMatchObject({ key: "votesUsed" });
    // A second vote on the same topic withdraws it
    await runOp(bruno, { op: "topic.vote", id: topics[0]! });
    await runOp(bruno, { op: "topic.vote", id: topics[3]! });
    const mine = await prisma.topicVote.findMany({ where: { personId: brunoId }, select: { topicId: true } });
    expect(mine.map((v) => v.topicId).sort()).toEqual(topics.slice(1).sort());
  });

  it("take no vote from someone who is not one of the meeting's people", async () => {
    const guest = guestCtx((await outsider()).id);
    await expect(runOp(guest, { op: "topic.vote", id: f.topicId })).rejects.toMatchObject({ key: "membersOnlyVote" });
    expect(await prisma.topicVote.count({ where: { topicId: f.topicId } })).toBe(1);
  });
});

describe("comments on check-ins", () => {
  const line = () => ({ ownerId: f.memberId, section: "done", itemText: "shipped" });

  it("like a line, and unlike it at the second press", async () => {
    const likes = () => prisma.checkInComment.count({ where: { sessionId: f.sessionId, byId: brunoId, text: "" } });
    await runOp(bruno, { op: "comment.like", ...line() });
    expect(await likes()).toBe(1);
    await runOp(bruno, { op: "comment.like", ...line() });
    expect(await likes()).toBe(0);
  });

  it("react to a line with several emojis, one of each per person, the old 👍 counting as one", async () => {
    const mine = () =>
      prisma.checkInComment.findMany({ where: { sessionId: f.sessionId, byId: brunoId, text: "" }, select: { emoji: true } });
    await runOp(bruno, { op: "comment.react", ...line(), emoji: "🎉" });
    await runOp(bruno, { op: "comment.react", ...line(), emoji: "💡" });
    expect((await mine()).map((c) => c.emoji).sort()).toEqual(["💡", "🎉"].sort());
    await runOp(bruno, { op: "comment.react", ...line(), emoji: "🎉" });
    expect((await mine()).map((c) => c.emoji)).toEqual(["💡"]);
    // A 👍 given before there were several reactions is taken back by 👍
    await runOp(bruno, { op: "comment.like", ...line() });
    await runOp(bruno, { op: "comment.react", ...line(), emoji: "👍" });
    expect((await mine()).map((c) => c.emoji)).toEqual(["💡"]);
    await expect(runOp(bruno, { op: "comment.react", ...line(), emoji: "🍕" as "👍" })).rejects.toMatchObject({ key: "invalidRequest" });
    await runOp(bruno, { op: "comment.react", ...line(), emoji: "💡" });
  });

  it("are written on a line of one of the meeting's people, by one of them", async () => {
    await runOp(bruno, { op: "comment.add", ...line(), text: "Well done" });
    expect(await prisma.checkInComment.count({ where: { byId: brunoId, text: "Well done" } })).toBe(1);
    await expect(runOp(guestCtx((await outsider()).id), { op: "comment.add", ...line(), text: "Hi" })).rejects.toMatchObject({
      key: "notAMember",
    });
    await expect(runOp(bruno, { op: "comment.add", ...line(), ownerId: (await outsider()).id, text: "Hi" })).rejects.toMatchObject({
      key: "unknownMember",
    });
    await expect(runOp(bruno, { op: "comment.add", ...line(), itemText: "never written", text: "Hi" })).rejects.toMatchObject({
      key: "notFound",
    });
    await expect(runOp(bruno, { op: "comment.add", ...line(), section: "nowhere", text: "Hi" })).rejects.toMatchObject({
      key: "notFound",
    });
  });
});

describe("reactions", () => {
  it("show on the screens, and stop being recorded past six in ten seconds", async () => {
    for (let i = 0; i < 8; i++) await runOp(ana, { op: "reactions.add", emoji: "👏" });
    expect(await prisma.reaction.count({ where: { sessionId: f.sessionId, byId: f.memberId } })).toBe(6);
    expect(published().filter((e) => e.kind === "reaction")).toHaveLength(6);
    // Someone else still reacts
    await runOp(bruno, { op: "reactions.add", emoji: "🎉" });
    expect(await prisma.reaction.count({ where: { sessionId: f.sessionId, byId: brunoId } })).toBe(1);
  });

  it("from people outside the meeting share one allowance, so they cannot flood the screens", async () => {
    const stranger = guestCtx((await outsider()).id);
    for (let i = 0; i < 8; i++) await runOp(stranger, { op: "reactions.add", emoji: "🎉" });
    expect(await prisma.reaction.count({ where: { sessionId: f.sessionId, byId: null } })).toBe(6);
  });

  it("are ignored between sessions", async () => {
    await prisma.session.update({ where: { id: f.sessionId }, data: { status: "archived" } });
    await runOp(ana, { op: "reactions.add", emoji: "👏" });
    expect(await prisma.reaction.count({ where: { byId: f.memberId } })).toBe(0);
  });
});

describe("the project round", () => {
  it("is ordered by the host, among the projects the meeting follows", async () => {
    const second = await prisma.project.create({ data: { workspaceId: f.workspaceId, slug: `second-${n}`, name: "Second" } });
    await prisma.meetingProject.create({ data: { workspaceId: f.workspaceId, meetingId: f.meetingId, projectId: second.id } });
    const stranger = await prisma.project.create({ data: { workspaceId: f.workspaceId, slug: `stranger-${n}`, name: "Stranger" } });
    await expect(runOp(ana, { op: "project.order", order: [second.id] })).rejects.toMatchObject({ status: 403, key: "hostOnly" });
    await runOp(f.ctx, { op: "project.order", order: [second.id, stranger.id, "nothing", second.id, f.projectId] });
    expect((await session()).projectOrder).toEqual([second.id, f.projectId]);
  });
});

describe("rotating roles", () => {
  it("are given and taken back by the host, among the meeting's people", async () => {
    await enable("rotation", { roles: ["facilitator", "noteTaker"] });
    await runOp(f.ctx, { op: "rotation.assign", role: "facilitator", personId: f.memberId });
    await runOp(f.ctx, { op: "rotation.assign", role: "noteTaker", personId: brunoId });
    expect((await session()).assignments).toEqual({ facilitator: f.memberId, noteTaker: brunoId });
    await runOp(f.ctx, { op: "rotation.assign", role: "facilitator", personId: null });
    expect((await session()).assignments).toEqual({ noteTaker: brunoId });
    await expect(runOp(f.ctx, { op: "rotation.assign", role: "facilitator", personId: (await outsider()).id })).rejects.toMatchObject({
      key: "unknownMember",
    });
    await expect(runOp(ana, { op: "rotation.assign", role: "facilitator", personId: f.memberId })).rejects.toMatchObject({
      status: 403,
      key: "hostOnly",
    });
  });

  it("are chosen in the settings, each once", async () => {
    await enable("rotation", { roles: ["facilitator", "noteTaker"] });
    await runOp(f.ctx, { op: "rotation.configure", roles: ["noteTaker", "noteTaker"] });
    const row = await prisma.moduleInstallation.findFirstOrThrow({ where: { meetingId: f.meetingId, moduleId: "rotation" } });
    expect(row.config).toEqual({ roles: ["noteTaker"] });
    // Without its installation (runOp always gives one), nothing is saved
    await expect(rotation.ops[1].run({ module: null } as never, { roles: [] })).rejects.toMatchObject({ key: "notFound" });
  });
});

describe("planning poker", () => {
  beforeEach(async () => {
    await enable("poker", { deck: "fibonacci" });
    await withAgenda([
      { id: "intro", type: "intro" },
      { id: "pk", type: "poker" },
    ]);
  });

  it("removes an item of the session only", async () => {
    await expect(runOp(f.ctx, { op: "poker.item.remove", id: "nothing" })).rejects.toMatchObject({ key: "notFound" });
    await runOp(f.ctx, { op: "poker.item.remove", id: f.pokerItemId });
    expect(await prisma.pokerItem.count({ where: { id: f.pokerItemId } })).toBe(0);
    expect(await prisma.pokerVote.count({ where: { itemId: f.pokerItemId } })).toBe(0);
  });

  it("holds fifty items at most", async () => {
    await prisma.pokerItem.createMany({
      data: Array.from({ length: 49 }, (_, i) => ({
        workspaceId: f.workspaceId,
        sessionId: f.sessionId,
        title: `Story ${i}`,
        position: i + 1,
      })),
    });
    await expect(runOp(f.ctx, { op: "poker.item.add", title: "One more" })).rejects.toMatchObject({ key: "pokerTooManyItems" });
    expect(await prisma.pokerItem.count({ where: { sessionId: f.sessionId } })).toBe(50);
  });

  it("plays with the deck chosen in the settings", async () => {
    await runOp(f.ctx, { op: "poker.configure", deck: "tshirt" });
    expect((await prisma.moduleInstallation.findFirstOrThrow({ where: { meetingId: f.meetingId, moduleId: "poker" } })).config).toEqual({
      deck: "tshirt",
    });
    await runOp(f.ctx, { op: "meeting.goto", key: "pk" });
    await expect(runOp(ana, { op: "poker.vote", itemId: f.pokerItemId, value: "5" })).rejects.toMatchObject({ key: "pokerUnknownCard" });
    await runOp(ana, { op: "poker.vote", itemId: f.pokerItemId, value: "M" });
    expect((await prisma.pokerVote.findFirstOrThrow({ where: { itemId: f.pokerItemId, personId: f.memberId } })).value).toBe("M");
  });

  it("votes again from scratch, and sets or clears the estimate", async () => {
    await expect(runOp(f.ctx, { op: "poker.revote", itemId: "nothing" })).rejects.toMatchObject({ key: "notFound" });
    await expect(runOp(f.ctx, { op: "poker.final", itemId: "nothing", value: "5" })).rejects.toMatchObject({ key: "notFound" });
    await runOp(f.ctx, { op: "poker.final", itemId: f.pokerItemId, value: "5" });
    expect(await prisma.pokerItem.findUniqueOrThrow({ where: { id: f.pokerItemId } })).toMatchObject({ final: "5", revealed: true });
    await runOp(f.ctx, { op: "poker.final", itemId: f.pokerItemId, value: null });
    expect((await prisma.pokerItem.findUniqueOrThrow({ where: { id: f.pokerItemId } })).final).toBeNull();
    await runOp(f.ctx, { op: "poker.revote", itemId: f.pokerItemId });
    expect(await prisma.pokerItem.findUniqueOrThrow({ where: { id: f.pokerItemId } })).toMatchObject({ final: null, revealed: false });
    expect(await prisma.pokerVote.count({ where: { itemId: f.pokerItemId } })).toBe(0);
  });
});

describe("the icebreaker", () => {
  beforeEach(() => enable("icebreaker", { bank: ["Coffee or tea?", "Best book this year?"] }));

  it("changes its question from the control room; the answers to the old one go", async () => {
    await runOp(f.ctx, { op: "icebreaker.set", question: "Your first computer?" });
    expect((await session()).icebreaker).toBe("Your first computer?");
    expect(await prisma.icebreakerAnswer.count({ where: { sessionId: f.sessionId } })).toBe(0);
    await runOp(ana, { op: "icebreaker.answer", text: "An Amstrad" });
    // The same question again: the answers stay
    await runOp(f.ctx, { op: "icebreaker.set", question: "Your first computer?" });
    expect(await prisma.icebreakerAnswer.count({ where: { sessionId: f.sessionId } })).toBe(1);
    // None given: another one of the bank
    await runOp(f.ctx, { op: "icebreaker.set", question: null });
    expect(["Coffee or tea?", "Best book this year?"]).toContain((await session()).icebreaker);
    await expect(runOp(ana, { op: "icebreaker.set", question: "Mine?" })).rejects.toMatchObject({ status: 403, key: "hostOnly" });
  });

  it("takes one answer per person, erased when left empty", async () => {
    const answer = () => prisma.icebreakerAnswer.findFirst({ where: { sessionId: f.sessionId, byId: f.memberId } });
    await runOp(ana, { op: "icebreaker.answer", text: "Tea" });
    await runOp(ana, { op: "icebreaker.answer", text: "Coffee" });
    expect((await answer())?.text).toBe("Coffee");
    await runOp(ana, { op: "icebreaker.answer", text: "  " });
    expect(await answer()).toBeNull();
    await expect(runOp(guestCtx((await outsider()).id), { op: "icebreaker.answer", text: "Me too" })).rejects.toMatchObject({
      key: "notAMember",
    });
  });
});

describe("raised hands and questions", () => {
  it("are answered from the control room", async () => {
    await expect(runOp(ana, { op: "hands.resolve", id: f.interactionId, resolved: true })).rejects.toMatchObject({
      status: 403,
      key: "hostOnly",
    });
    await runOp(f.ctx, { op: "hands.resolve", id: f.interactionId, resolved: true });
    expect((await prisma.interaction.findUniqueOrThrow({ where: { id: f.interactionId } })).resolved).toBe(true);
    await runOp(f.ctx, { op: "hands.resolve", id: f.interactionId, resolved: false });
    expect((await prisma.interaction.findUniqueOrThrow({ where: { id: f.interactionId } })).resolved).toBe(false);
  });

  it("hold one raised hand per person, and questions with a text", async () => {
    await runOp(bruno, { op: "hands.add", type: "hand" });
    await runOp(bruno, { op: "hands.add", type: "hand" });
    expect(await prisma.interaction.count({ where: { sessionId: f.sessionId, byId: brunoId, type: "hand" } })).toBe(1);
    await expect(runOp(bruno, { op: "hands.add", type: "question", text: "  " })).rejects.toMatchObject({ key: "emptyQuestion" });
    await expect(runOp(bruno, { op: "hands.add", type: "question", text: "Why?", targetId: (await outsider()).id })).rejects.toMatchObject({
      key: "unknownMember",
    });
    await runOp(bruno, { op: "hands.add", type: "question", text: "When is the release?", targetId: f.memberId });
    expect(await prisma.interaction.findFirst({ where: { byId: brunoId, type: "question" } })).toMatchObject({
      text: "When is the release?",
      targetId: f.memberId,
      stepKey: "intro",
    });
    // Shown on the screens: the hand once, the question
    expect(published().filter((e) => e.kind === "reaction")).toHaveLength(2);
  });
});

describe("kudos", () => {
  it("thank someone else among the meeting's people, who is told", async () => {
    await expect(runOp(ana, { op: "kudos.add", toId: f.memberId, text: "Me!" })).rejects.toMatchObject({ key: "pickSomeoneElse" });
    await expect(runOp(ana, { op: "kudos.add", toId: (await outsider()).id, text: "Thanks" })).rejects.toMatchObject({
      key: "unknownRecipient",
    });
    await runOp(bruno, { op: "kudos.add", toId: f.memberId, text: "Thanks for the review" });
    expect(await prisma.kudo.count({ where: { fromId: brunoId, toId: f.memberId } })).toBe(1);
    expect(await prisma.inboxItem.findFirst({ where: { personId: f.memberId, kind: "kudo.received" } })).toMatchObject({
      actorId: brunoId,
      data: { text: "Thanks for the review" },
    });
    expect(published()).toContainEqual({ kind: "kudo", fromId: brunoId, toId: f.memberId, text: "Thanks for the review" });
  });
});

describe("sounds", () => {
  beforeEach(() => enable("sounds"));

  it("keep the settings not changed", async () => {
    await runOp(f.ctx, { op: "sounds.settings", volume: 40, cues: { start: false } });
    await runOp(f.ctx, { op: "sounds.settings", output: "screen" });
    const defaults = parseSound({});
    const row = await prisma.moduleInstallation.findFirstOrThrow({ where: { meetingId: f.meetingId, moduleId: "sounds" } });
    expect(row.config).toEqual({ ...defaults, volume: 40, output: "screen", cues: { ...defaults.cues, start: false } });
    await expect(runOp(ana, { op: "sounds.settings", volume: 100 })).rejects.toMatchObject({ status: 403, key: "hostOnly" });
  });

  it("play on the screens, without changing the meeting's state", async () => {
    await runOp(f.ctx, { op: "sounds.play", sound: "tada" });
    expect(published()).toEqual([{ kind: "sound", sound: "tada" }]);
    await expect(runOp(ana, { op: "sounds.play", sound: "tada" })).rejects.toMatchObject({ status: 403, key: "hostOnly" });
  });
});

describe("the retrospective", () => {
  beforeEach(async () => {
    await enable("retro", {
      preset: "well-improve-ideas",
      columns: [],
      votesPerPerson: 3,
      reflectMinutes: 7,
      voteMinutes: 3,
      discussMinutes: 5,
    });
    await withAgenda([
      { id: "intro", type: "intro" },
      { id: "retro", type: "retro" },
    ]);
  });

  it("takes a note out of its group while grouping only", async () => {
    await expect(runOp(f.ctx, { op: "retro.ungroup", cardId: f.retroCardId })).rejects.toMatchObject({ key: "retroWrongPhase" });
    await runOp(f.ctx, { op: "meeting.goto", key: "retro:group" });
    await expect(runOp(f.ctx, { op: "retro.ungroup", cardId: "nothing" })).rejects.toMatchObject({ key: "notFound" });
    await runOp(f.ctx, { op: "retro.ungroup", cardId: f.retroCardId });
    expect((await prisma.retroCard.findUniqueOrThrow({ where: { id: f.retroCardId } })).groupId).toBeNull();
    // Its group, left empty, goes
    expect(await prisma.retroGroup.count({ where: { id: f.retroGroupId } })).toBe(0);
  });

  it("holds sixty notes per person", async () => {
    await runOp(f.ctx, { op: "meeting.goto", key: "retro:reflect" });
    await prisma.retroCard.createMany({
      data: Array.from({ length: 59 }, (_, i) => ({
        workspaceId: f.workspaceId,
        sessionId: f.sessionId,
        column: "well",
        authorId: f.memberId,
        text: `Note ${i}`,
      })),
    });
    await expect(runOp(ana, { op: "retro.card.add", column: "well", text: "One more" })).rejects.toMatchObject({
      key: "retroTooManyCards",
    });
    await runOp(bruno, { op: "retro.card.add", column: "well", text: "Mine" });
    expect(await prisma.retroCard.count({ where: { authorId: brunoId } })).toBe(1);
  });

  it("needs columns for a custom board", async () => {
    const config = { columns: [], votesPerPerson: 2, reflectMinutes: 5, voteMinutes: 3, discussMinutes: 5 };
    await expect(runOp(f.ctx, { op: "retro.configure", ...config, preset: "custom" })).rejects.toMatchObject({ key: "retroNoColumns" });
    const columns = [{ key: "keep", label: "Keep" }];
    await runOp(f.ctx, { op: "retro.configure", ...config, preset: "custom", columns });
    expect((await prisma.moduleInstallation.findFirstOrThrow({ where: { meetingId: f.meetingId, moduleId: "retro" } })).config).toEqual({
      ...config,
      preset: "custom",
      columns,
    });
  });
});

describe("mood and spotlight", () => {
  it("records one mood per person, cleared on demand", async () => {
    await enable("mood");
    const mood = () => prisma.mood.findFirst({ where: { sessionId: f.sessionId, personId: f.memberId } });
    await runOp(ana, { op: "mood.set", value: 2 });
    expect((await mood())?.value).toBe(2);
    await runOp(ana, { op: "mood.set", value: null });
    expect(await mood()).toBeNull();
    await expect(runOp(guestCtx((await outsider()).id), { op: "mood.set", value: 5 })).rejects.toMatchObject({ key: "notAMember" });
    await expect(runOp(ana, { op: "mood.set", value: 6 })).rejects.toMatchObject({ key: "invalidRequest" });
  });

  it("shows something big on the shared screen, then takes it down", async () => {
    await enable("spotlight");
    await runOp(f.ctx, { op: "spotlight.set", label: "Question", text: "Who owns the release?" });
    expect((await session()).spotlight).toEqual({ label: "Question", text: "Who owns the release?" });
    await expect(runOp(ana, { op: "spotlight.clear" })).rejects.toMatchObject({ status: 403, key: "hostOnly" });
    await runOp(f.ctx, { op: "spotlight.clear" });
    expect((await session()).spotlight).toBeNull();
  });
});

describe("the parking lot", () => {
  beforeEach(() => enable("parking"));

  it("sets subjects aside, then brings one back to the topics", async () => {
    await runOp(f.ctx, { op: "parking.add", text: "Office move" });
    const parked = await prisma.topic.findFirstOrThrow({ where: { meetingId: f.meetingId, text: "Office move" } });
    expect(parked.parked).toBe(true);
    await expect(runOp(f.ctx, { op: "parking.discuss", id: "nothing" })).rejects.toMatchObject({ key: "notFound" });
    // A topic that was never parked is not "brought back"
    await expect(runOp(f.ctx, { op: "parking.discuss", id: f.topicId })).rejects.toMatchObject({ key: "notFound" });
    await runOp(f.ctx, { op: "parking.discuss", id: parked.id });
    expect((await prisma.topic.findUniqueOrThrow({ where: { id: parked.id } })).parked).toBe(false);
  });

  it("holds fifty subjects at most", async () => {
    await prisma.topic.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        workspaceId: f.workspaceId,
        meetingId: f.meetingId,
        text: `Later ${i}`,
        parked: true,
      })),
    });
    await expect(runOp(f.ctx, { op: "parking.add", text: "One more" })).rejects.toMatchObject({ key: "parkingFull" });
  });
});

describe("random draws", () => {
  beforeEach(() => enable("random"));

  it("draw among the people present, then clear", async () => {
    await runOp(f.ctx, { op: "random.draw", kind: "wheel" });
    const draw = (await session()).draw as { kind: string; pick: string; entries: string[] };
    expect(draw.kind).toBe("wheel");
    expect(draw.entries).toContain(draw.pick);
    await runOp(f.ctx, { op: "random.clear" });
    expect((await session()).draw).toBeNull();
  });

  it("need two people for a wheel, an order or teams, nobody for heads or tails", async () => {
    await prisma.session.update({ where: { id: f.sessionId }, data: { absent: [f.memberId] } });
    for (const kind of ["wheel", "order", "teams"])
      await expect(runOp(f.ctx, { op: "random.draw", kind })).rejects.toMatchObject({ key: "drawNeedsPeople" });
    expect((await session()).draw).toBeNull();
    await runOp(f.ctx, { op: "random.draw", kind: "coin" });
    expect((await session()).draw).toMatchObject({ kind: "coin", tails: expect.any(Boolean) });
  });
});

describe("polls", () => {
  beforeEach(async () => {
    await enable("polls");
    await prisma.poll.deleteMany({ where: { sessionId: f.sessionId } });
  });

  const create = async (o: object) => {
    await runOp(f.ctx, { op: "polls.create", question: "Q", ...o });
    return prisma.poll.findFirstOrThrow({ where: { sessionId: f.sessionId }, orderBy: { createdAt: "desc" } });
  };

  it("refuse a poll of another session", async () => {
    const before = await prisma.session.create({
      data: { workspaceId: f.workspaceId, meetingId: f.meetingId, date: "2029-12-31", status: "archived", archivedAt: new Date() },
    });
    const old = await prisma.poll.create({ data: { workspaceId: f.workspaceId, sessionId: before.id, question: "Old", kind: "words" } });
    for (const op of [
      { op: "polls.close", pollId: old.id },
      { op: "polls.show", pollId: old.id },
      { op: "polls.delete", pollId: old.id },
    ])
      await expect(runOp(f.ctx, op)).rejects.toMatchObject({ key: "notFound" });
    expect(await prisma.poll.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ open: true });
    expect((await session()).shownPollId).toBeNull();
  });

  it("take several options at once, each once, among those offered", async () => {
    const poll = await create({ kind: "multiple", options: ["Tea", "Coffee", "Water", "Tea"] });
    expect(poll.options).toEqual(["Tea", "Coffee", "Water"]);
    for (const values of [["Tea", "Tea"], ["Juice"], []])
      await expect(runOp(ana, { op: "polls.answer", pollId: poll.id, values })).rejects.toMatchObject({ key: "pollInvalidAnswer" });
    await runOp(ana, { op: "polls.answer", pollId: poll.id, values: ["Tea", "Coffee"] });
    expect((await prisma.pollAnswer.findFirstOrThrow({ where: { pollId: poll.id } })).values).toEqual(["Tea", "Coffee"]);
  });

  it("take one mark from 1 to 5 on a scale", async () => {
    const poll = await create({ kind: "scale", options: ["ignored", "too"] });
    expect(poll.options).toEqual([]);
    for (const values of [["6"], ["1", "2"], ["great"]])
      await expect(runOp(ana, { op: "polls.answer", pollId: poll.id, values })).rejects.toMatchObject({ key: "pollInvalidAnswer" });
    await runOp(ana, { op: "polls.answer", pollId: poll.id, values: ["4"] });
    expect(await prisma.pollAnswer.count({ where: { pollId: poll.id } })).toBe(1);
  });

  it("take up to three short words", async () => {
    const poll = await create({ kind: "words" });
    for (const values of [["a", "b", "c", "d"], ["x".repeat(31)]])
      await expect(runOp(ana, { op: "polls.answer", pollId: poll.id, values })).rejects.toMatchObject({ key: "pollInvalidAnswer" });
    await runOp(ana, { op: "polls.answer", pollId: poll.id, values: [" Calm ", "Focused", ""] });
    expect((await prisma.pollAnswer.findFirstOrThrow({ where: { pollId: poll.id } })).values).toEqual(["Calm", "Focused"]);
  });

  it("are shown, taken down and deleted from the control room", async () => {
    const poll = await create({ kind: "words" });
    await runOp(f.ctx, { op: "polls.show", pollId: poll.id });
    expect((await session()).shownPollId).toBe(poll.id);
    await runOp(f.ctx, { op: "polls.show", pollId: null });
    expect((await session()).shownPollId).toBeNull();
    await runOp(f.ctx, { op: "polls.show", pollId: poll.id });
    // Deleting the poll shown takes it off the screen
    await runOp(f.ctx, { op: "polls.delete", pollId: poll.id });
    expect((await session()).shownPollId).toBeNull();
    expect(await prisma.poll.count({ where: { id: poll.id } })).toBe(0);
    await expect(runOp(ana, { op: "polls.close", pollId: poll.id })).rejects.toMatchObject({ status: 403, key: "hostOnly" });
  });
});
