import { buildMinutes, minutesToMarkdown } from "@ronde/core/minutes";
import { can } from "@ronde/core/permissions";
import { parseRecord } from "@ronde/core/record";
import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import type { MeetingCtx } from "@/lib/server/meeting/context";
import { runOp } from "@/lib/server/meeting/ops";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { type Fixture, meeting, workspace } from "./fixtures";

// Planning poker (cards hidden until the reveal) and polls (valid answers, closing, anonymity)

let f: Fixture;
let ana: MeetingCtx;

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
    viewer: { userId: principal.userId, personId, email: "ana@poker.test", name: "Ana", memberId: personId, isHost: false, isAdmin: false },
    can: (p) => can(principal, p),
  };
}

beforeAll(async () => {
  f = await meeting(await workspace("poker"), "Sprint planning");
  // Only this test's own items and polls
  await prisma.pokerItem.deleteMany({ where: { sessionId: f.sessionId } });
  await prisma.poll.deleteMany({ where: { sessionId: f.sessionId } });
  for (const moduleId of ["poker", "polls"])
    await prisma.moduleInstallation.upsert({
      where: { meetingId_moduleId: { meetingId: f.meetingId, moduleId } },
      create: { workspaceId: f.workspaceId, meetingId: f.meetingId, moduleId, enabled: true, config: {} },
      update: { enabled: true },
    });
  await prisma.meeting.update({
    where: { id: f.meetingId },
    data: {
      agenda: [
        { id: "intro", type: "intro" },
        { id: "pk", type: "poker" },
      ],
    },
  });
  f.ctx.meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } });
  ana = participantCtx(f.memberId);
});

describe("planning poker", () => {
  it("keeps the cards hidden until the reveal", async () => {
    await runOp(f.ctx, { op: "poker.item.add", title: "Login with SSO" });
    const item = await prisma.pokerItem.findFirstOrThrow({ where: { sessionId: f.sessionId } });
    await expect(runOp(ana, { op: "poker.vote", itemId: item.id, value: "5" })).rejects.toMatchObject({ key: "pokerNotLive" });
    await runOp(f.ctx, { op: "meeting.goto", key: "pk" });
    await expect(runOp(ana, { op: "poker.vote", itemId: item.id, value: "4" })).rejects.toMatchObject({ key: "pokerUnknownCard" });
    await runOp(ana, { op: "poker.vote", itemId: item.id, value: "5" });
    await runOp(f.ctx, { op: "poker.vote", itemId: item.id, value: "8" });
    const before = await loadSnapshot(ana);
    expect(before.poker?.items[0]).toMatchObject({ voted: 2, votes: [], myVote: "5", revealed: false });
    expect(JSON.stringify(before.poker?.items)).not.toContain('"8"');
    await runOp(f.ctx, { op: "poker.reveal", itemId: item.id });
    await expect(runOp(ana, { op: "poker.vote", itemId: item.id, value: "3" })).rejects.toMatchObject({ key: "pokerRevealed" });
    const after = await loadSnapshot(ana);
    expect(after.poker?.items[0]?.votes.map((v) => v.value).sort()).toEqual(["5", "8"]);
    // A new round clears the cards; then the team agrees
    await runOp(f.ctx, { op: "poker.revote", itemId: item.id });
    expect(await prisma.pokerVote.count({ where: { itemId: item.id } })).toBe(0);
    await runOp(ana, { op: "poker.vote", itemId: item.id, value: "8" });
    await runOp(f.ctx, { op: "poker.final", itemId: item.id, value: "8" });
    expect((await loadSnapshot(ana)).poker?.items[0]).toMatchObject({ final: "8", revealed: true });
  });
});

describe("polls", () => {
  it("accepts answers that fit the poll, while it is open", async () => {
    await expect(
      runOp(f.ctx, { op: "polls.create", question: "Ready?", kind: "single", options: ["Yes"], anonymous: true }),
    ).rejects.toMatchObject({
      key: "pollNeedsOptions",
    });
    await runOp(f.ctx, { op: "polls.create", question: "Ready to ship?", kind: "single", options: ["Yes", "No"], anonymous: false });
    await runOp(f.ctx, { op: "polls.create", question: "One word for the sprint", kind: "words", options: [], anonymous: true });
    const [ready, words] = await prisma.poll.findMany({ where: { sessionId: f.sessionId }, orderBy: { createdAt: "asc" } });
    await expect(runOp(ana, { op: "polls.answer", pollId: ready!.id, values: ["Maybe"] })).rejects.toMatchObject({
      key: "pollInvalidAnswer",
    });
    await runOp(ana, { op: "polls.answer", pollId: ready!.id, values: ["Yes"] });
    await runOp(ana, { op: "polls.answer", pollId: words!.id, values: ["Intense", "Fun"] });
    await runOp(f.ctx, { op: "polls.answer", pollId: words!.id, values: ["intense"] });
    await runOp(f.ctx, { op: "polls.close", pollId: ready!.id, open: false });
    await expect(runOp(ana, { op: "polls.answer", pollId: ready!.id, values: ["No"] })).rejects.toMatchObject({ key: "pollClosed" });
    await runOp(f.ctx, { op: "polls.show", pollId: words!.id });

    const seen = await loadSnapshot(ana);
    const shown = seen.polls.find((p) => p.shown)!;
    expect(shown.results.slice(0, 2)).toEqual([
      { value: "Intense", count: 2, people: [], ids: [] },
      { value: "Fun", count: 1, people: [], ids: [] },
    ]);
    // Not anonymous: the names show next to the totals
    expect(seen.polls.find((p) => p.id === ready!.id)?.results.find((r) => r.value === "Yes")?.people).toHaveLength(1);
    // ...and their faces: the ids of who answered, for each answer and for the poll
    const readyView = seen.polls.find((p) => p.id === ready!.id)!;
    expect(readyView.results.find((r) => r.value === "Yes")?.ids).toHaveLength(1);
    expect(readyView.respondents).toHaveLength(1);
  });

  it("keeps a quick yes or no told apart, whatever the language of those who see it", async () => {
    await runOp(f.ctx, {
      op: "polls.create",
      question: "On y va ?",
      kind: "single",
      options: ["Oui", "Non"],
      anonymous: false,
      show: true,
      yesNo: true,
    });
    await runOp(f.ctx, { op: "polls.create", question: "Tea or coffee?", kind: "multiple", options: ["Tea", "Coffee"], yesNo: true });
    const polls = (await loadSnapshot(ana)).polls;
    expect(polls.find((p) => p.question === "On y va ?")).toMatchObject({ yesNo: true, shown: true });
    // Only a single choice between two options can be a yes or no
    expect(polls.find((p) => p.question === "Tea or coffee?")?.yesNo).toBe(false);
    for (const p of polls.filter((x) => x.question === "On y va ?" || x.question === "Tea or coffee?"))
      await runOp(f.ctx, { op: "polls.delete", pollId: p.id });
  });

  it("archives estimates and poll totals, never who answered", async () => {
    await runOp(f.ctx, { op: "meeting.goto", key: "end" });
    await runOp(f.ctx, { op: "meeting.archive", summary: null, omit: [] });
    const record = parseRecord((await prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } })).record)!;
    expect(record.poker).toEqual([{ title: "Login with SSO", final: "8", votes: ["8"] }]);
    expect(record.polls.map((p) => p.question)).toEqual(["Ready to ship?", "One word for the sprint"]);
    const md = minutesToMarkdown(buildMinutes(record, "fr"));
    expect(md).toContain("## Estimations\n- Login with SSO · estimation 8 (8)");
    expect(md).toContain("**Ready to ship? (1 réponse)**\n- Yes · 1\n- No · 0");
  });
});
