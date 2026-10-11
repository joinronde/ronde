import { generateKeyPairSync, sign } from "node:crypto";
import { prisma } from "@ronde/db";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext, WorkspaceSettings } from "@/lib/server/authz";
import { saveLicense } from "@/lib/server/license";
import {
  commandReply,
  disconnectSlack,
  finishInstall,
  installState,
  openCheckIn,
  readInstallState,
  remindInSlack,
  setSlackReminders,
  slackReminders,
  slackUninstalled,
  submitCheckIn,
} from "@/lib/server/slack";
import { type Fixture, meeting, workspace } from "./fixtures";

// The Slack app (Team): installed per workspace, reminders by direct message, check-ins filled in from a Slack
// form, "/ronde". Slack itself is a stub answering per Web API method.

const pair = generateKeyPairSync("ed25519");
process.env.RONDE_LICENSE_TEST_KEYS = JSON.stringify({ "test-slk": pair.publicKey.export({ format: "jwk" }).x });
const body = Buffer.from(
  JSON.stringify({
    kid: "test-slk",
    id: "lic_s",
    customer: "Acme",
    edition: "team",
    seats: 0,
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
  }),
).toString("base64url");
const KEY = `ronde_lic_v1.${body}.${sign(null, Buffer.from(`ronde_lic_v1.${body}`), pair.privateKey).toString("base64url")}`;

let f: Fixture;
let memberEmail = "";
/** Web API calls received, by method */
let calls: { method: string; args: Record<string, string> }[] = [];

/** Slack, answering each method with the given body */
const slack = (answers: Record<string, unknown>) => {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const method = url.replace("https://slack.com/api/", "");
      calls.push({ method, args: Object.fromEntries(new URLSearchParams(String(init.body))) });
      return new Response(JSON.stringify(answers[method] ?? { ok: false, error: "unknown_method" }), { status: 200 });
    }),
  );
};

/** The workspace context, with the settings as they are now */
const fresh = async (): Promise<WorkspaceContext> => {
  const row = await prisma.workspace.findUniqueOrThrow({ where: { id: f.workspaceId }, select: { settings: true } });
  return { ...f.ctx.ws, workspace: { ...f.ctx.ws.workspace, settings: row.settings as WorkspaceSettings } };
};

beforeAll(async () => {
  vi.stubEnv("SLACK_CLIENT_ID", "123.456");
  vi.stubEnv("SLACK_CLIENT_SECRET", "client-secret");
  vi.stubEnv("SLACK_SIGNING_SECRET", "signing-secret");
  vi.stubEnv("APP_URL", "https://ronde.test");
  await saveLicense(KEY);
  f = await meeting(await workspace(`slk-${Date.now().toString(36)}`), "Platform");
  memberEmail = (await prisma.person.findUniqueOrThrow({ where: { id: f.memberId } })).email;
  await prisma.workspace.update({ where: { id: f.workspaceId }, data: { settings: { bufferMin: 10 } } });
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  vi.unstubAllEnvs();
  await saveLicense("");
});

describe("Slack app", () => {
  it("signs the installation's round trip for one workspace and one person, for a while", () => {
    const now = Date.now();
    const state = installState("ws-1", "user-1", now);
    expect(readInstallState(state, now)).toEqual({ workspaceId: "ws-1", userId: "user-1" });
    expect(readInstallState(state.replace("ws-1", "ws-2"), now)).toBeNull();
    expect(readInstallState(`${state}x`, now)).toBeNull();
    expect(readInstallState(state, now + 11 * 60_000)).toBeNull();
    expect(readInstallState("", now)).toBeNull();
  });

  it("keeps the installation, its token encrypted, and makes its channel a connector", async () => {
    slack({
      "oauth.v2.access": {
        ok: true,
        access_token: "xoxb-secret-token",
        bot_user_id: "UBOT",
        team: { id: "T1", name: "Acme" },
        incoming_webhook: { url: "https://hooks.slack.com/services/T1/B1/x", channel: "#platform" },
      },
    });
    await finishInstall(await fresh(), "code-1");
    const { settings } = await prisma.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } });
    const s = settings as WorkspaceSettings;
    // The other settings stay
    expect(s.bufferMin).toBe(10);
    expect(s.slack).toMatchObject({ teamId: "T1", teamName: "Acme", channel: "#platform", reminders: true });
    expect(s.slack?.botToken).not.toContain("xoxb");
    const connector = await prisma.connector.findUniqueOrThrow({ where: { id: s.slack?.connectorId ?? "" } });
    expect(connector).toMatchObject({ kind: "slack", name: "Slack #platform" });
    expect(connector.secret).not.toContain("hooks.slack.com");
  });

  it("opens the check-in form for a participant found by email, and saves what they send", async () => {
    slack({ "users.info": { ok: true, user: { profile: { email: memberEmail.toUpperCase() } } }, "views.open": { ok: true } });
    await openCheckIn({ teamId: "T1", userId: "U2", triggerId: "trigger", value: JSON.stringify({ w: f.workspaceId, m: f.meetingId }) });
    const view = JSON.parse(calls.find((c) => c.method === "views.open")?.args.view ?? "{}");
    expect(view.callback_id).toBe("ronde.checkin");
    const inputs = view.blocks.filter((b: { type: string }) => b.type === "input");
    expect(inputs.length).toBeGreaterThanOrEqual(3);
    expect(JSON.parse(view.private_metadata)).toMatchObject({ w: f.workspaceId, m: f.meetingId, p: f.memberId });
    // Found once by email, then remembered
    const person = await prisma.person.findUniqueOrThrow({ where: { id: f.memberId } });
    expect(person.handles).toMatchObject({ slack: { T1: "U2" } });

    const [done, next] = inputs.map((b: { block_id: string }) => b.block_id);
    const answer = await submitCheckIn({
      teamId: "T1",
      userId: "U2",
      metadata: view.private_metadata,
      values: { [done]: { v: { value: "Shipped the export\n\n  Fixed the sign-in  " } }, [next]: { v: { value: "Prepare the demo" } } },
    });
    expect(answer).toMatchObject({ response_action: "update" });
    const items = await prisma.checkInItem.findMany({ where: { meetingId: f.meetingId, personId: f.memberId, sessionId: null } });
    expect(
      items
        .filter((i) => !i.projectId)
        .map((i) => i.text)
        .sort(),
    ).toEqual(["Fixed the sign-in", "Prepare the demo", "Shipped the export"]);
    // The tabs of projects, not in the form, keep their items
    expect(items.filter((i) => i.projectId).map((i) => i.text)).toEqual(["project work"]);

    // The same form sent again: the check-in changed since it was opened
    const again = await submitCheckIn({ teamId: "T1", userId: "U2", metadata: view.private_metadata, values: {} });
    expect(again).toMatchObject({ response_action: "errors" });
    // Someone else cannot send it
    slack({ "users.info": { ok: true, user: { profile: { email: "someone@elsewhere.test" } } } });
    const other = await submitCheckIn({ teamId: "T1", userId: "U3", metadata: view.private_metadata, values: {} });
    expect(other).toMatchObject({ response_action: "update" });
    expect(await prisma.checkInItem.count({ where: { meetingId: f.meetingId, personId: f.memberId, sessionId: null } })).toBe(4);
  });

  it("refuses too many items rather than cutting them", async () => {
    slack({ "views.open": { ok: true } });
    const head = await prisma.checkIn.findFirstOrThrow({ where: { meetingId: f.meetingId, personId: f.memberId } });
    const metadata = JSON.stringify({ w: f.workspaceId, m: f.meetingId, p: f.memberId, since: head.updatedAt.getTime() });
    const section = await prisma.section.findFirstOrThrow({ where: { meetingId: f.meetingId }, orderBy: { position: "asc" } });
    const lines = Array.from({ length: 51 }, (_, i) => `Item ${i}`).join("\n");
    const answer = await submitCheckIn({ teamId: "T1", userId: "U2", metadata, values: { [`s:${section.key}`]: { v: { value: lines } } } });
    expect(answer).toMatchObject({ response_action: "errors", errors: { [`s:${section.key}`]: expect.any(String) } });
  });

  it("reminds by direct message the people found in Slack", async () => {
    const w = await slackReminders(f.workspaceId);
    expect(w?.slack.teamId).toBe("T1");
    const person = await prisma.person.findUniqueOrThrow({ where: { id: f.hostPersonId } });
    const reminder = {
      locale: "en" as const,
      teamName: "Platform",
      meetingId: f.meetingId,
      date: "2030-01-07",
      time: "10:00",
      name: "Host Person",
      checkInUrl: "https://ronde.test/w/x/m/y/me",
      planned: ["[ ] Prepare the demo"],
      actions: [{ text: "Call the client", status: "open" as const }],
      sheets: [],
    };
    slack({ "users.lookupByEmail": { ok: true, user: { id: "UHOST" } }, "chat.postMessage": { ok: true } });
    expect(await remindInSlack(w!, person, reminder)).toBe(true);
    const post = calls.find((c) => c.method === "chat.postMessage");
    expect(post?.args.channel).toBe("UHOST");
    const blocks = JSON.stringify(JSON.parse(post?.args.blocks ?? "[]"));
    expect(blocks).toContain("ronde.checkin");
    expect(blocks).toContain("Prepare the demo");
    expect(blocks).toContain("Call the client");

    // Not in Slack: the reminder goes by email
    slack({ "users.lookupByEmail": { ok: false, error: "users_not_found" } });
    const stranger = await prisma.person.create({ data: { workspaceId: f.workspaceId, email: "nobody@slk.test", firstName: "Nobody" } });
    expect(await remindInSlack(w!, stranger, reminder)).toBe(false);

    // Turned off: back to email for everyone
    await setSlackReminders(await fresh(), false);
    expect(await slackReminders(f.workspaceId)).toBeNull();
    await setSlackReminders(await fresh(), true);
  });

  it("answers /ronde with the person's meetings and open actions, only to them", async () => {
    slack({});
    const reply = (await commandReply("T1", "U2")) as { response_type: string; blocks: unknown[] };
    expect(reply.response_type).toBe("ephemeral");
    const text = JSON.stringify(reply.blocks);
    expect(text).toContain("Platform");
    expect(text).toContain("ronde.checkin");
    // Unknown in Ronde
    slack({ "users.info": { ok: true, user: { profile: { email: "stranger@elsewhere.test" } } } });
    expect(await commandReply("T1", "U404")).toMatchObject({ response_type: "ephemeral", text: expect.any(String) });
    expect(await commandReply("T-other", "U2")).not.toHaveProperty("blocks");
  });

  it("forgets the installation when disconnected, here or from Slack", async () => {
    slack({ "apps.uninstall": { ok: true } });
    const { connectorId } = (await fresh()).workspace.settings.slack!;
    await disconnectSlack(await fresh());
    expect(calls.map((c) => c.method)).toEqual(["apps.uninstall"]);
    expect((await fresh()).workspace.settings.slack).toBeUndefined();
    expect((await fresh()).workspace.settings.bufferMin).toBe(10);
    expect(await prisma.connector.count({ where: { id: connectorId ?? "" } })).toBe(0);

    slack({
      "oauth.v2.access": { ok: true, access_token: "xoxb-2", team: { id: "T1", name: "Acme" }, incoming_webhook: { url: "", channel: "" } },
    });
    await finishInstall(await fresh(), "code-2");
    expect((await fresh()).workspace.settings.slack?.teamId).toBe("T1");
    // Added again, to another Slack workspace: the app leaves the first one
    slack({
      "oauth.v2.access": {
        ok: true,
        access_token: "xoxb-3",
        team: { id: "T2", name: "Other" },
        incoming_webhook: { url: "", channel: "" },
      },
      "apps.uninstall": { ok: true },
    });
    await finishInstall(await fresh(), "code-3");
    expect(calls.map((c) => c.method)).toEqual(["oauth.v2.access", "apps.uninstall"]);
    expect((await fresh()).workspace.settings.slack?.teamId).toBe("T2");
    await slackUninstalled("T2");
    expect((await fresh()).workspace.settings.slack).toBeUndefined();
  });
});
