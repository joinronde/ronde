import { prisma } from "@ronde/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { runOp } from "@/lib/server/meeting/ops";
import { pushInbox, pushKinds, savePushDevice, sendPush, setPushKind } from "@/lib/server/push";
import { type Fixture, meeting, workspace } from "./fixtures";

// Push notifications: what reaches a person's devices (and what they turned off), devices the push service
// forgot, the bell's new items, and "your turn" as the session moves on. The push service is a fake here.

const sent: { endpoint: string; payload: { title: string; body: string; url: string; tag?: string } }[] = [];
let failWith: number | null = null;
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => undefined,
    sendNotification: async (sub: { endpoint: string }, payload: string) => {
      if (failWith) throw Object.assign(new Error("gone"), { statusCode: failWith });
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
      return { statusCode: 201 };
    },
  },
}));

let f: Fixture;
let hostUser: string;
const device = (n: number) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${n}-${Date.now()}`,
  keys: { p256dh: "p".repeat(30), auth: "a".repeat(22) },
});

beforeAll(async () => {
  vi.stubEnv("WEB_PUSH_PUBLIC_KEY", "public-key");
  vi.stubEnv("WEB_PUSH_PRIVATE_KEY", "private-key");
  f = await meeting(await workspace("push"), "Pushed weekly");
  hostUser = f.ctx.ws.user.id;
});
afterAll(() => vi.unstubAllEnvs());
beforeEach(() => {
  sent.length = 0;
  failWith = null;
});

describe("push notifications", () => {
  it("reach the person's devices, except the kinds they turned off", async () => {
    const one = device(1);
    await savePushDevice(hostUser, one, "Chrome · Android");
    await expect(savePushDevice(hostUser, { ...one, endpoint: "http://insecure.example.com/x" }, "")).rejects.toThrow();
    // Only a browser's push service: not any address the server would then be sent to
    await expect(savePushDevice(hostUser, { ...one, endpoint: "https://internal.example.com/x" }, "")).rejects.toThrow();
    const message = { title: "T", body: "B", url: "https://ronde.test/x" };
    expect(await sendPush([{ userId: hostUser, message }], "inbox")).toBe(1);
    expect(sent[0]).toMatchObject({ endpoint: one.endpoint, payload: message });
    await setPushKind(hostUser, "inbox", false);
    expect(await pushKinds(hostUser)).toEqual({ turn: true, reminder: true, inbox: false });
    expect(await sendPush([{ userId: hostUser, message }], "inbox")).toBe(0);
    await setPushKind(hostUser, "inbox", true);
  });

  it("forgets a device the push service no longer knows", async () => {
    const before = await prisma.pushSubscription.count({ where: { userId: hostUser } });
    failWith = 410;
    await sendPush([{ userId: hostUser, message: { title: "T", body: "B", url: "https://ronde.test" } }], "inbox");
    expect(await prisma.pushSubscription.count({ where: { userId: hostUser } })).toBe(before - 1);
    failWith = null;
    await savePushDevice(hostUser, device(2), "Firefox · Linux");
  });

  it("brings the bell's new items, in plain words, once", async () => {
    await prisma.inboxItem.create({
      data: {
        workspaceId: f.workspaceId,
        personId: f.hostPersonId,
        kind: "action.assigned",
        actorId: f.memberId,
        meetingId: f.meetingId,
        data: { text: "Write the release notes" },
        href: "/actions",
      },
    });
    expect(await pushInbox()).toBe(1);
    expect(sent[0]!.payload).toMatchObject({
      title: "Pushed weekly",
      body: expect.stringContaining("gave you an action in Pushed weekly"),
    });
    expect(sent[0]!.payload.body).toContain("Write the release notes");
    expect(sent[0]!.payload.body).not.toContain("<strong>");
    expect(sent[0]!.payload.url).toMatch(/\/w\/[^/]+\/actions$/);
    sent.length = 0;
    expect(await pushInbox()).toBe(0);
  });

  it("tells the next speaker their turn is coming, then that it has come", async () => {
    // The member has an account and a phone with notifications on
    const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `member-${Date.now()}@push.test`, name: "Member" } });
    await prisma.person.update({ where: { id: f.memberId }, data: { userId: user.id } });
    const phone = device(3);
    await savePushDevice(user.id, phone, "Safari · iOS");
    const s = await prisma.session.findFirstOrThrow({ where: { meetingId: f.meetingId, status: "current" } });
    await prisma.session.update({ where: { id: s.id }, data: { startedAt: new Date(), stepKey: "intro", absent: [] } });
    // Intro, its questions, then the host's turn: the member, speaking after the host, is told they are next
    const toPhone = () => sent.filter((x) => x.endpoint === phone.endpoint).map((x) => x.payload);
    for (let k = 0; k < 6 && !toPhone().length; k++) {
      await runOp(f.ctx, { op: "meeting.step", delta: 1 });
      await new Promise((r) => setTimeout(r, 150));
    }
    await vi.waitFor(() => expect(toPhone()).toHaveLength(1));
    expect(toPhone()[0]).toMatchObject({ title: "You're next in Pushed weekly", tag: `turn:${s.id}:${f.memberId}` });
    expect(toPhone()[0]!.body).toContain("Host is speaking");
    expect(toPhone()[0]!.url).toMatch(new RegExp(`/m/${f.meetingId}/me$`));
    // Then their turn comes, under the same tag
    await runOp(f.ctx, { op: "meeting.step", delta: 1 });
    await vi.waitFor(() => expect(toPhone()).toHaveLength(2));
    expect(toPhone()[1]).toMatchObject({ title: "Your turn in Pushed weekly", tag: `turn:${s.id}:${f.memberId}` });
  });
});
