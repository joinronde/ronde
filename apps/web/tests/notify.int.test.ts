import type { WorkspaceRole } from "@ronde/core/permissions";
import { DEFAULT_SECTIONS } from "@ronde/core/util";
import { prisma, scoped } from "@ronde/db";
import nodemailer from "nodemailer";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "@/lib/server/authz";
import { deleteConnector, saveConnector } from "@/lib/server/notify/connectors";
import { deliver, minutesPayload, notifyEvent } from "@/lib/server/notify/dispatch";
import { checkReminders } from "@/lib/server/reminders";
import { encryptSecret } from "@/lib/server/secrets";

// Notifications through connectors: rules, unique deliveries, retries, the email audience

const SLACK = "https://hooks.slack.com/services/T000/B000/secret";
let workspaceId = "";
let meetingId = "";
let slackId = "";
let startedRuleId = "";
let ctx: WorkspaceContext;
const posts: { url: string; body: string }[] = [];
let status = 200;

beforeAll(async () => {
  vi.stubEnv("APP_URL", "https://example.com/ronde");
  const ws = await prisma.workspace.create({ data: { slug: "notify", name: "Notify", timezone: "Europe/Paris" } });
  workspaceId = ws.id;
  const person = (firstName: string) =>
    prisma.person.create({ data: { workspaceId, firstName, lastName: "Test", email: `${firstName.toLowerCase()}@example.com` } });
  const [ines, ali, lou] = await Promise.all([person("Ines"), person("Ali"), person("Lou")]);
  const meeting = await prisma.meeting.create({
    data: { workspaceId, name: "Notify team", reminderWhen: "sameDay", reminderTime: "09:00" },
  });
  meetingId = meeting.id;
  await prisma.section.createMany({
    data: DEFAULT_SECTIONS.map((s, position) => ({
      workspaceId,
      meetingId,
      key: s.key,
      label: s.label,
      role: s.role,
      input: s.input,
      position,
    })),
  });
  await prisma.meetingParticipant.createMany({
    data: [
      { workspaceId, meetingId, personId: ines.id, role: "host", position: 0 },
      { workspaceId, meetingId, personId: ali.id, position: 1 },
      { workspaceId, meetingId, personId: lou.id, position: 2 },
    ],
  });
  // Lou is absent: two check-ins expected, Ali's is ready
  await prisma.session.create({ data: { workspaceId, meetingId, date: "2026-10-01", time: "14:00", absent: [lou.id] } });
  await prisma.checkIn.create({ data: { workspaceId, meetingId, personId: ali.id } });
  await prisma.checkInItem.create({
    data: { workspaceId, meetingId, personId: ali.id, sectionKey: "done", role: "achievement", text: "Shipped" },
  });

  const slack = await prisma.connector.create({ data: { workspaceId, kind: "slack", name: "Team channel", secret: encryptSecret(SLACK) } });
  slackId = slack.id;
  const email = await prisma.connector.create({ data: { workspaceId, kind: "email", name: "Email" } });
  await prisma.notificationRule.createMany({
    data: [
      { workspaceId, meetingId, connectorId: slack.id, event: "checkin_reminder" },
      { workspaceId, meetingId, connectorId: slack.id, event: "session_soon", options: { minutesBefore: 10 } },
      { workspaceId, meetingId, connectorId: email.id, event: "minutes_published", target: { audience: "hosts" } },
    ],
  });
  startedRuleId = (
    await prisma.notificationRule.create({
      data: { workspaceId, meetingId, connectorId: slack.id, event: "session_started", enabled: false },
    })
  ).id;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      posts.push({ url, body: String(init.body) });
      return new Response("ok", { status });
    }),
  );
  const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: "ines@example.com", name: "Ines" } });
  const principal = { userId: user.id, personId: ines.id, workspaceId, workspaceRole: "admin" as WorkspaceRole };
  ctx = {
    user: { id: user.id, name: "Ines", email: user.email, image: null, locale: null, timezone: null, instanceRole: "user" },
    workspace: { id: workspaceId, slug: "notify", name: "Notify", locale: "en", timezone: "Europe/Paris", plan: "community", settings: {} },
    member: { id: "m", personId: ines.id, role: "admin" },
    principal,
    db: scoped(prisma, workspaceId),
    can: () => true,
  };
});

afterEach(() => {
  posts.length = 0;
  status = 200;
});

describe("notification rules", () => {
  it("sends the check-in reminder once, with the progress counted when sending", async () => {
    // 12:00 in Paris: after the 09:00 reminder, two hours before the session (too early for "soon")
    await checkReminders(new Date("2026-10-01T10:00:00Z"));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe(SLACK);
    expect(posts[0]!.body).toContain("1/2");
    // Checked again, or by another replica: nothing more
    await checkReminders(new Date("2026-10-01T10:05:00Z"));
    expect(posts).toHaveLength(1);
    const deliveries = await prisma.delivery.findMany({ where: { meetingId, event: "checkin.reminder" } });
    expect(deliveries.map((d) => [d.status, d.attempts])).toEqual([["sent", 1]]);
  });

  it("announces the session only in the minutes before it", async () => {
    await checkReminders(new Date("2026-10-01T11:45:00Z"));
    expect(posts).toHaveLength(0);
    await checkReminders(new Date("2026-10-01T11:52:00Z"));
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toContain("8 minutes");
    await checkReminders(new Date("2026-10-01T11:55:00Z"));
    expect(posts).toHaveLength(1);
  });

  it("skips disabled rules, records a failure and succeeds on retry", async () => {
    expect(await notifyEvent(meetingId, "session.started", "s1", { session: { date: "2026-10-01", time: "14:00" } })).toBe(0);
    await prisma.notificationRule.update({ where: { id: startedRuleId }, data: { enabled: true } });
    status = 500;
    expect(await notifyEvent(meetingId, "session.started", "s1", { session: { date: "2026-10-01", time: "14:00" } })).toBe(1);
    const failed = await prisma.delivery.findFirstOrThrow({ where: { ruleId: startedRuleId } });
    expect([failed.status, failed.attempts, failed.error]).toEqual(["failed", 1, expect.stringContaining("connectorRefused")]);
    status = 200;
    await deliver(failed.id);
    const sent = await prisma.delivery.findUniqueOrThrow({ where: { id: failed.id } });
    expect([sent.status, sent.attempts, sent.error]).toEqual(["sent", 2, null]);
    // The same event raised again (two replicas, a reload) creates nothing
    expect(await notifyEvent(meetingId, "session.started", "s1", {})).toBe(0);
    expect(posts).toHaveLength(2);
  });

  it("never reaches the server's own network in the cloud, whatever the connector says", async () => {
    vi.stubEnv("RONDE_CLOUD", "1");
    try {
      const hook = await prisma.connector.create({
        data: { workspaceId, kind: "webhook", name: "Inside", config: { url: "https://127.0.0.1:9/hook" } },
      });
      const rule = await prisma.notificationRule.create({
        data: { workspaceId, meetingId, connectorId: hook.id, event: "session_started" },
      });
      const d = await prisma.delivery.create({
        data: { workspaceId, connectorId: hook.id, ruleId: rule.id, meetingId, event: "session.started", key: `inside-${Date.now()}` },
      });
      await deliver(d.id).catch(() => undefined);
      expect(await prisma.delivery.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({ status: "failed" });
      // The fake network was never asked: the guard refused the connection itself
      expect(posts).toHaveLength(0);
    } finally {
      vi.stubEnv("RONDE_CLOUD", "");
    }
  });

  it("emails the audience of the rule: the hosts", async () => {
    vi.stubEnv("SMTP_URL", "smtp://localhost");
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const send = vi.spyOn(transport, "sendMail");
    vi.spyOn(nodemailer, "createTransport").mockReturnValue(transport);
    const payload = minutesPayload(
      {
        durationMs: 15 * 60_000,
        participants: [{ id: "a" }, { id: "b" }],
        notes: { intro: "Decision: ship v2\nOther note" },
        actions: [{ text: "Write the docs", ownerId: "a", status: "todo" }],
        names: { a: "Ali" },
      } as never,
      { date: "2026-10-01", time: "14:00" },
    );
    expect(payload.minutes?.decisions).toEqual(["ship v2"]);
    expect(await notifyEvent(meetingId, "minutes.published", "s1", payload)).toBe(1);
    expect(send.mock.calls.map(([mail]) => mail.to)).toEqual(["ines@example.com"]);
    expect(send.mock.calls[0]![0].text).toContain("Write the docs (Ali)");
  });
});

describe("workspace connectors", () => {
  it("checks the address of chat webhooks", async () => {
    await expect(
      saveConnector(ctx, { kind: "slack", name: "Fake", config: {}, secret: "https://evil.example.org/hook" }),
    ).rejects.toMatchObject({
      key: "connectorInvalid",
    });
    await expect(
      saveConnector(ctx, { kind: "matrix", name: "No token", config: { homeserver: "https://matrix.org" } }),
    ).rejects.toMatchObject({
      key: "connectorSecretRequired",
    });
  });

  it("generates the signing key of a webhook and stores it encrypted", async () => {
    const { id, signingKey } = await saveConnector(ctx, { kind: "webhook", name: "CI", config: { url: "https://ci.example.org/ronde" } });
    expect(signingKey).toMatch(/^whsec_/);
    const row = await prisma.connector.findUniqueOrThrow({ where: { id } });
    expect(row.secret).not.toContain(signingKey!);
    // Editing without a new secret keeps it
    expect(
      (await saveConnector(ctx, { id, kind: "webhook", name: "CI 2", config: { url: "https://ci.example.org/ronde" } })).signingKey,
    ).toBeNull();
    expect((await prisma.connector.findUniqueOrThrow({ where: { id } })).secret).toBe(row.secret);
    await deleteConnector(ctx, id);
  });

  it("refuses to delete a connector used by rules", async () => {
    await expect(deleteConnector(ctx, slackId)).rejects.toMatchObject({ key: "connectorInUse" });
  });
});
