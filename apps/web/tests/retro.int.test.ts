import { buildMinutes, minutesToMarkdown } from "@ronde/core/minutes";
import { can } from "@ronde/core/permissions";
import { parseRecord } from "@ronde/core/record";
import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import type { MeetingCtx } from "@/lib/server/meeting/context";
import { runOp } from "@/lib/server/meeting/ops";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { type Fixture, meeting, workspace } from "./fixtures";

// Retrospective: anonymous notes, grouping, a bounded vote, discussion steps and minutes without authors

let f: Fixture;
let alice: MeetingCtx;
let bruno: MeetingCtx;

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
    viewer: { userId: principal.userId, personId, email: `${name}@retro.test`, name, memberId: personId, isHost: false, isAdmin: false },
    can: (p) => can(principal, p),
  };
}

const go = (key: string) => runOp(f.ctx, { op: "meeting.goto", key });
const refresh = async () => {
  f.ctx.meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } });
  alice.meeting = bruno.meeting = f.ctx.meeting;
};

beforeAll(async () => {
  f = await meeting(await workspace("retro"), "Team retro");
  // The fixture's own retro rows (for the isolation attacks) are not part of this retro
  await prisma.retroGroup.deleteMany({ where: { sessionId: f.sessionId } });
  await prisma.retroCard.deleteMany({ where: { sessionId: f.sessionId } });
  const brunoPerson = await prisma.person.create({
    data: { workspaceId: f.workspaceId, email: "bruno@retro.test", firstName: "Bruno", lastName: "Petit" },
  });
  await prisma.person.update({ where: { id: f.memberId }, data: { firstName: "Alice", lastName: "Martin" } });
  await prisma.meetingParticipant.create({
    data: { workspaceId: f.workspaceId, meetingId: f.meetingId, personId: brunoPerson.id, position: 2 },
  });
  await prisma.moduleInstallation.upsert({
    where: { meetingId_moduleId: { meetingId: f.meetingId, moduleId: "retro" } },
    create: { workspaceId: f.workspaceId, meetingId: f.meetingId, moduleId: "retro", enabled: true, config: { votesPerPerson: 1 } },
    update: { enabled: true, config: { votesPerPerson: 1 } },
  });
  // The fixture's session is already running: the agenda is set before, as between two sessions
  await prisma.meeting.update({
    where: { id: f.meetingId },
    data: {
      agenda: [
        { id: "intro", type: "intro" },
        { id: "retro", type: "retro" },
        { id: "topics", type: "topics" },
      ],
    },
  });
  alice = participantCtx(f.memberId, "alice");
  bruno = participantCtx(brunoPerson.id, "bruno");
  await refresh();
});

describe("retrospective", () => {
  it("keeps the notes anonymous while the team writes", async () => {
    await go("retro:reflect");
    await expect(runOp(alice, { op: "retro.vote", groupId: "x" })).rejects.toMatchObject({ key: "retroWrongPhase" });
    await runOp(alice, { op: "retro.card.add", column: "improve", text: "Deploys are slow" });
    await runOp(bruno, { op: "retro.card.add", column: "improve", text: "Too many meetings" });
    await runOp(bruno, { op: "retro.card.add", column: "well", text: "Great onboarding" });
    const seen = await loadSnapshot(alice);
    expect(seen.retro?.phase).toBe("reflect");
    expect(seen.retro?.cards.map((c) => [c.text, c.mine])).toEqual([["Deploys are slow", true]]);
    expect(seen.retro?.counts).toMatchObject({ improve: 2, well: 1 });
    const json = JSON.stringify(seen);
    expect(json).not.toContain("Too many meetings");
    expect(json).not.toContain("authorId");
    // Nobody changes someone else's note
    const card = await prisma.retroCard.findFirstOrThrow({ where: { text: "Too many meetings" } });
    await expect(runOp(alice, { op: "retro.card.delete", id: card.id })).rejects.toMatchObject({ key: "retroOwnCardsOnly" });
  });

  it("reveals the notes, never their authors, and lets the host group them", async () => {
    await go("retro:group");
    const [slow, many] = await Promise.all([
      prisma.retroCard.findFirstOrThrow({ where: { text: "Deploys are slow" } }),
      prisma.retroCard.findFirstOrThrow({ where: { text: "Too many meetings" } }),
    ]);
    await expect(runOp(alice, { op: "retro.group", cardId: slow.id, targetCardId: many.id })).rejects.toMatchObject({ status: 403 });
    await runOp(f.ctx, { op: "retro.group", cardId: slow.id, targetCardId: many.id });
    const seen = await loadSnapshot(alice);
    expect(seen.retro?.cards.map((c) => c.text).sort()).toEqual(["Deploys are slow", "Great onboarding", "Too many meetings"]);
    expect(seen.retro?.groups).toHaveLength(1);
    expect(JSON.stringify(seen)).not.toContain("authorId");
  });

  it("makes every lone note a group at the vote, and bounds the votes", async () => {
    await go("retro:vote");
    const groups = await prisma.retroGroup.findMany({ where: { sessionId: f.sessionId }, include: { cards: true } });
    expect(groups).toHaveLength(2);
    const pain = groups.find((g) => g.cards.length === 2)!;
    const onboarding = groups.find((g) => g.cards.length === 1)!;
    await runOp(alice, { op: "retro.vote", groupId: pain.id });
    await expect(runOp(alice, { op: "retro.vote", groupId: onboarding.id })).rejects.toMatchObject({ key: "votesUsed" });
    await runOp(bruno, { op: "retro.vote", groupId: pain.id });
    await runOp(f.ctx, { op: "retro.group.rename", id: pain.id, title: "Delivery pain" });
    const seen = await loadSnapshot(alice);
    expect(seen.retro?.myVotesLeft).toBe(0);
    expect(seen.blockData.retro?.groups.find((g) => g.id === pain.id)).toMatchObject({ votes: 2, title: "Delivery pain" });
  });

  it("discusses the voted groups and archives minutes without authors", async () => {
    const pain = await prisma.retroGroup.findFirstOrThrow({ where: { title: "Delivery pain" } });
    await go(`retro:discuss:${pain.id}`);
    await runOp(f.ctx, { op: "note.set", key: `retro:discuss:${pain.id}`, text: "Decision: one release train per week" });
    await go("end");
    await runOp(f.ctx, { op: "meeting.archive", summary: null, omit: [] });
    const s = await prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } });
    const record = parseRecord(s.record)!;
    expect(record.retro?.groups[0]).toMatchObject({ title: "Delivery pain", votes: 2 });
    expect(JSON.stringify(record.retro)).not.toContain(f.memberId);
    for (const locale of ["en", "fr"] as const) {
      const doc = buildMinutes(record, locale);
      const md = minutesToMarkdown(doc);
      expect(md).toContain("- Delivery pain · 2 votes");
      expect(md).toContain("one release train per week");
      // The retro part names nobody
      const part = minutesToMarkdown({ ...doc, parts: doc.parts.filter((p) => p.kind === "retro") });
      expect(part).toContain("Too many meetings");
      expect(part).not.toMatch(/Alice|Bruno/);
    }
    expect(minutesToMarkdown(buildMinutes(record, "fr"))).toContain("## Rétrospective\n**Ce qui a bien marché**");
  });
});
