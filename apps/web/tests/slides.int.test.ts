import { minutesMarkdown } from "@ronde/core/minutes";
import { can } from "@ronde/core/permissions";
import { parseRecord } from "@ronde/core/record";
import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import type { MeetingCtx } from "@/lib/server/meeting/context";
import { runOp } from "@/lib/server/meeting/ops";
import { SLIDE_ITEMS_PER_PERSON } from "@/lib/server/meeting/ops/slides";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { type Fixture, meeting, workspace } from "./fixtures";

// Slides of the agenda: irritants raised by the team (named or not), turned into actions, kept in the minutes

let f: Fixture;
let alice: MeetingCtx;
let bruno: MeetingCtx;
let brunoId: string;

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
    viewer: { userId: principal.userId, personId, email: `${name}@slides.test`, name, memberId: personId, isHost: false, isAdmin: false },
    can: (p) => can(principal, p),
  };
}

const go = (key: string) => runOp(f.ctx, { op: "meeting.goto", key });
const items = (blockId: string) => prisma.slideItem.findMany({ where: { sessionId: f.sessionId, blockId }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  f = await meeting(await workspace("slides"), "Project review");
  await prisma.slideItem.deleteMany({ where: { sessionId: f.sessionId } });
  const b = await prisma.person.create({
    data: { workspaceId: f.workspaceId, email: "bruno@slides.test", firstName: "Bruno", lastName: "Petit" },
  });
  brunoId = b.id;
  await prisma.person.update({ where: { id: f.memberId }, data: { firstName: "Alice", lastName: "Martin" } });
  await prisma.meetingParticipant.create({ data: { workspaceId: f.workspaceId, meetingId: f.meetingId, personId: b.id, position: 2 } });
  f.ctx.meeting = await prisma.meeting.update({
    where: { id: f.meetingId },
    data: {
      agenda: [
        { id: "intro", type: "intro" },
        { id: "irr", type: "slide", kind: "irritants", title: "Irritants" },
        { id: "anon", type: "slide", kind: "irritants", title: "Said quietly", anonymous: true },
        { id: "round", type: "round" },
        { id: "budget", type: "slide", kind: "free", title: "Budget", body: "**Q3**: 80% spent" },
      ],
    },
  });
  alice = participantCtx(f.memberId, "alice");
  bruno = participantCtx(b.id, "bruno");
});

describe("irritants slide", () => {
  it("takes what participants raise, on irritants slides only", async () => {
    await runOp(alice, { op: "slide.item.add", blockId: "irr", text: "Builds take 40 minutes" });
    await runOp(bruno, { op: "slide.item.add", blockId: "irr", text: "Too many meetings" });
    await expect(runOp(alice, { op: "slide.item.add", blockId: "budget", text: "x" })).rejects.toMatchObject({ key: "notFound" });
    await expect(runOp(alice, { op: "slide.item.add", blockId: "nope", text: "x" })).rejects.toMatchObject({ key: "notFound" });
    expect((await items("irr")).map((i) => [i.text, i.authorId])).toEqual([
      ["Builds take 40 minutes", f.memberId],
      ["Too many meetings", brunoId],
    ]);
  });

  it("caps what one person posts on a slide", async () => {
    for (let i = 0; i < SLIDE_ITEMS_PER_PERSON; i++) await runOp(bruno, { op: "slide.item.add", blockId: "anon", text: `n${i}` });
    await expect(runOp(bruno, { op: "slide.item.add", blockId: "anon", text: "one more" })).rejects.toMatchObject({
      key: "slideTooManyItems",
    });
    await prisma.slideItem.deleteMany({ where: { sessionId: f.sessionId, blockId: "anon" } });
  });

  it("lets its author take an item back, and the host remove any", async () => {
    await runOp(alice, { op: "slide.item.add", blockId: "irr", text: "Typo" });
    const [, bruno1, typo] = await items("irr");
    await expect(runOp(alice, { op: "slide.item.delete", id: bruno1!.id })).rejects.toMatchObject({ key: "ownSlideItemsOnly" });
    await runOp(alice, { op: "slide.item.delete", id: typo!.id });
    await runOp(bruno, { op: "slide.item.add", blockId: "irr", text: "Off topic" });
    await runOp(f.ctx, { op: "slide.item.delete", id: (await items("irr")).at(-1)!.id });
    expect((await items("irr")).map((i) => i.text)).toEqual(["Builds take 40 minutes", "Too many meetings"]);
  });

  it("never sends the author of an item of an anonymous slide, the host included", async () => {
    await runOp(alice, { op: "slide.item.add", blockId: "anon", text: "Reviews feel harsh" });
    const forAlice = await loadSnapshot(alice);
    const forHost = await loadSnapshot(f.ctx);
    expect(forAlice.slideItems.find((i) => i.blockId === "anon")).toMatchObject({ authorId: null, mine: true });
    expect(forHost.slideItems.find((i) => i.blockId === "anon")).toMatchObject({ authorId: null });
    expect(forHost.slideItems.find((i) => i.text === "Too many meetings")).toMatchObject({ authorId: brunoId, mine: false });
  });

  it("is turned into an action by the host, once, at the slide it came from", async () => {
    const [builds] = await items("irr");
    await expect(runOp(alice, { op: "slide.item.toAction", id: builds!.id, ownerId: f.memberId })).rejects.toMatchObject({
      status: 403,
    });
    await runOp(f.ctx, { op: "slide.item.toAction", id: builds!.id, ownerId: brunoId, text: "Cache the builds" });
    const action = await prisma.action.findFirstOrThrow({ where: { meetingId: f.meetingId, text: "Cache the builds" } });
    expect(action).toMatchObject({ ownerId: brunoId, originStep: "irr", originText: "Builds take 40 minutes" });
    expect((await items("irr"))[0]!.actionId).toBe(action.id);
    await expect(runOp(f.ctx, { op: "slide.item.toAction", id: builds!.id, ownerId: brunoId })).rejects.toMatchObject({
      key: "slideItemTracked",
    });
  });

  it("files an action created during a slide under it, and archives the slides in the minutes", async () => {
    await go("budget");
    await runOp(f.ctx, { op: "action.add", text: "Freeze the hiring budget", ownerId: f.memberId, originText: null });
    expect(await prisma.action.findFirstOrThrow({ where: { text: "Freeze the hiring budget" } })).toMatchObject({ originStep: "budget" });
    await runOp(f.ctx, { op: "note.set", key: "irr", text: "Decision: no deploy on Fridays" });
    await go("end");
    await runOp(f.ctx, { op: "meeting.archive", summary: null, omit: [] });
    const record = parseRecord((await prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } })).record)!;
    expect(record.slides.find((s) => s.blockId === "anon")!.items).toEqual([{ text: "Reviews feel harsh", byId: null, tracked: false }]);
    const md = minutesMarkdown(record, "en");
    expect(md).toContain("## Irritants");
    expect(md).toContain("Alice Martin: Builds take 40 minutes · action created");
    expect(md).toContain("- Cache the builds (Bruno Petit)");
    expect(md).toContain("## Budget\n**Q3**: 80% spent");
    expect(md).toContain("- Freeze the hiring budget (Alice Martin)");
    expect(md).toContain("no deploy on Fridays");
  });
});
