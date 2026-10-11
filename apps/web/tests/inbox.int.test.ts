import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceContext } from "@/lib/server/authz";
import { listInbox, markRead } from "@/lib/server/inbox";
import { runOp } from "@/lib/server/meeting/ops";
import { type Fixture, meeting, workspace } from "./fixtures";

// The bell: what happens in a meeting reaches the people concerned, never the person who did it

let f: Fixture;
/** The participant's view of the workspace */
let them: WorkspaceContext;

beforeAll(async () => {
  f = await meeting(await workspace("inbox"), "Weekly");
  them = { ...f.ctx.ws, member: { ...f.ctx.ws.member, personId: f.memberId } };
});

describe("inbox", () => {
  it("tells the owner of a new action, not its author", async () => {
    await runOp(f.ctx, { op: "action.add", text: "Ship the release notes", ownerId: f.memberId });
    const inbox = await listInbox(them);
    expect(inbox.unread).toBe(1);
    expect(inbox.items[0]).toMatchObject({ kind: "action.assigned", meeting: "Weekly", text: "Ship the release notes", read: false });
    expect(inbox.items[0]?.actor?.name).toBe("Host");
    expect((await listInbox(f.ctx.ws)).unread).toBe(0);
  });

  it("passes thanks on to the person thanked", async () => {
    await runOp(f.ctx, { op: "kudos.add", toId: f.memberId, text: "Thanks for the demo" });
    const inbox = await listInbox(them);
    expect(inbox.items[0]).toMatchObject({ kind: "kudo.received", text: "Thanks for the demo", href: `/w/inbox/people/${f.memberId}` });
  });

  it("marks one, then every notification read", async () => {
    const [first] = (await listInbox(them)).items;
    await markRead(them, first!.id);
    expect((await listInbox(them)).unread).toBe(1);
    await markRead(them);
    expect((await listInbox(them)).unread).toBe(0);
    // Someone else's notifications are out of reach
    expect(await prisma.inboxItem.count({ where: { personId: f.memberId, readAt: null } })).toBe(0);
  });
});
