import { generateKeyPairSync, sign } from "node:crypto";
import { prisma } from "@ronde/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { saveLicense } from "@/lib/server/license";
import { type Activity, handleActivity, linkTeams, linkToken, readLinkToken, remindInTeams, teamsReminders } from "@/lib/server/teams";
import { type Fixture, meeting, workspace } from "./fixtures";

// The Microsoft Teams app (Team): a team linked to a workspace from the card of its channel, the person's
// summary on "ronde", the check-in filled in from its card, the reminder in their personal chat, and the app
// removed from the team. Microsoft is a fake here: its token service and the Bot Connector.

const pair = generateKeyPairSync("ed25519");
process.env.RONDE_LICENSE_TEST_KEYS = JSON.stringify({ "test-teams": pair.publicKey.export({ format: "jwk" }).x });
const body = Buffer.from(
  JSON.stringify({
    kid: "test-teams",
    id: "lic_tm",
    customer: "Acme",
    edition: "team",
    seats: 0,
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
  }),
).toString("base64url");
const KEY = `ronde_lic_v1.${body}.${sign(null, Buffer.from(`ronde_lic_v1.${body}`), pair.privateKey).toString("base64url")}`;

const SERVICE = "https://smba.trafficmanager.net/emea/";
const TENANT = "tenant-acme";
const CHANNEL = "19:general@thread.tacv2";
const BOT = "28:bot-app-id";

/** What the Bot Connector received */
const sent: { method: string; path: string; body: Record<string, unknown> }[] = [];
let emails: Record<string, string> = {};
const microsoft = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.includes("/oauth2/v2.0/token")) return Response.json({ access_token: "bot-token", expires_in: 3600 });
      const path = url.replace(SERVICE.replace(/\/$/, ""), "");
      sent.push({ method: init.method ?? "GET", path: decodeURIComponent(path), body: init.body ? JSON.parse(String(init.body)) : {} });
      const member = /\/members\/(.+)$/.exec(decodeURIComponent(path));
      if (member) return Response.json({ id: member[1], email: emails[member[1]!] ?? "" });
      if (path.includes("/pagedmembers")) return Response.json({ members: Object.entries(emails).map(([id, email]) => ({ id, email })) });
      if (path === "/v3/conversations") return Response.json({ id: "a:personal-chat" });
      return Response.json({ id: "activity-1" });
    }),
  );

let f: Fixture;
let hostEmail: string;
const from = (id: string, conversation: Partial<NonNullable<Activity["conversation"]>> = {}): Activity => ({
  serviceUrl: SERVICE,
  channelId: "msteams",
  from: { id, name: "Someone" },
  recipient: { id: BOT },
  conversation: { id: `a:chat-${id}`, conversationType: "personal", tenantId: TENANT, ...conversation },
  channelData: { tenant: { id: TENANT } },
  locale: "en-US",
});
const cardOf = (a: { body: Record<string, unknown> }) => JSON.stringify(a.body);

beforeAll(async () => {
  vi.stubEnv("TEAMS_APP_ID", "bot-app-id");
  vi.stubEnv("TEAMS_APP_PASSWORD", "secret");
  vi.stubEnv("TEAMS_TENANT_ID", "tenant-ronde");
  await saveLicense(KEY);
  const w = await workspace(`teams-${Date.now().toString(36)}`);
  hostEmail = w.user.email;
  f = await meeting(w, "Platform sync");
});
beforeEach(() => {
  sent.length = 0;
  emails = {};
  microsoft();
});
afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await saveLicense("");
});

describe("the Teams app", () => {
  it("offers, in the channel it is added to, to link the team; the link is signed and expires", async () => {
    await handleActivity({
      ...from("29:admin", { id: CHANNEL, conversationType: "channel" }),
      type: "conversationUpdate",
      membersAdded: [{ id: BOT }],
      channelData: {
        tenant: { id: TENANT },
        team: { id: "19:team@thread.tacv2", name: "Platform" },
        channel: { id: CHANNEL, name: "General" },
      },
    });
    const posted = sent.find((s) => s.path === `/v3/conversations/${CHANNEL}/activities`)!;
    const token = decodeURIComponent(/\/teams\/link\?t=([^"]+)"/.exec(cardOf(posted))![1]!);
    expect(readLinkToken(token)).toMatchObject({ tenantId: TENANT, teamName: "Platform", channelId: CHANNEL, channelName: "General" });
    expect(readLinkToken(`${token}x`)).toBeNull();
    expect(
      readLinkToken(
        linkToken(
          { tenantId: TENANT, serviceUrl: SERVICE, teamId: "t", teamName: "T", channelId: "c", channelName: "" },
          Date.now() - 8 * 24 * 3600_000,
        ),
      ),
    ).toBeNull();

    // An admin of the workspace confirms in Ronde: the team is linked, its channel becomes a connector
    await linkTeams(f.ctx.ws, token);
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } });
    const teams = (ws.settings as { teams?: { teamName: string; connectorId: string; reminders: boolean } }).teams!;
    expect(teams).toMatchObject({ teamName: "Platform", reminders: true });
    expect(await prisma.connector.findUniqueOrThrow({ where: { id: teams.connectorId } })).toMatchObject({
      kind: "teams",
      name: "Teams · Platform",
    });
    expect(cardOf(sent.at(-1)!)).toContain("This channel is now linked");
  });

  it("answers “ronde” with the person's next sessions, and remembers their chat", async () => {
    emails = { "29:host": hostEmail };
    await handleActivity({ ...from("29:host"), type: "message", text: "ronde" });
    const reply = sent.find((s) => s.method === "POST" && s.path.endsWith("/activities"))!;
    expect(reply.path).toBe("/v3/conversations/a:chat-29:host/activities");
    expect(cardOf(reply)).toContain("Platform sync");
    expect(cardOf(reply)).toContain('"verb":"ronde.checkin"');
    const host = await prisma.person.findUniqueOrThrow({ where: { id: f.hostPersonId } });
    expect((host.handles as { teams: Record<string, unknown> }).teams[TENANT]).toEqual({ id: "29:host", chat: "a:chat-29:host" });
  });

  it("turns the card into the check-in's form, and saves what is sent", async () => {
    const data = { w: f.workspaceId, m: f.meetingId };
    const form = await handleActivity({
      ...from("29:host"),
      type: "invoke",
      name: "adaptiveCard/action",
      value: { action: { verb: "ronde.checkin", data } },
    });
    expect(form?.type).toBe("application/vnd.microsoft.card.adaptive");
    const fields = JSON.stringify(form?.value);
    expect(fields).toContain('"type":"Input.Text"');
    const save = JSON.parse(fields).actions[0] as { verb: string; data: Record<string, unknown> };
    expect(save.verb).toBe("ronde.save");
    const done = await handleActivity({
      ...from("29:host"),
      type: "invoke",
      name: "adaptiveCard/action",
      value: { action: { verb: "ronde.save", data: { ...save.data, "s:done": "Shipped the API\nWrote the docs" } } },
    });
    expect(JSON.stringify(done?.value)).toContain("is saved");
    const items = await prisma.checkInItem.findMany({
      where: { meetingId: f.meetingId, personId: f.hostPersonId, sectionKey: "done" },
      orderBy: { position: "asc" },
    });
    expect(items.map((i) => i.text)).toEqual(["Shipped the API", "Wrote the docs"]);
    // Someone else sending this form: refused
    emails = { "29:intruder": "nobody@elsewhere.test" };
    const refused = await handleActivity({
      ...from("29:intruder"),
      type: "invoke",
      name: "adaptiveCard/action",
      value: { action: { verb: "ronde.save", data: save.data } },
    });
    expect(JSON.stringify(refused?.value)).toContain("could not find this check-in");
  });

  it("reminds a person in their personal chat, opened first when needed", async () => {
    const w = (await teamsReminders(f.workspaceId))!;
    const member = await prisma.person.findUniqueOrThrow({ where: { id: f.memberId } });
    emails = { "29:member": member.email };
    const reminder = {
      locale: "en" as const,
      teamName: "Platform sync",
      meetingId: f.meetingId,
      date: "2030-01-07",
      time: "10:00",
      name: "Person One",
      checkInUrl: "https://ronde.test/me",
      planned: [],
      actions: [{ text: "Book a room", status: "open" as const }],
      sheets: [],
    };
    expect(await remindInTeams(w, member, reminder)).toBe(true);
    const opened = sent.find((s) => s.path === "/v3/conversations")!;
    expect(opened.body).toMatchObject({ members: [{ id: "29:member" }], tenantId: TENANT });
    const card = sent.find((s) => s.path === "/v3/conversations/a:personal-chat/activities")!;
    expect(cardOf(card)).toContain("Book a room");
    // Someone the team does not know gets the email instead
    const stranger = { id: f.memberId, email: "stranger@else.test", handles: {} };
    expect(await remindInTeams({ ...w, roster: undefined }, stranger, reminder)).toBe(false);
  });

  it("forgets the team once the app is removed from it", async () => {
    await handleActivity({
      ...from("29:admin", { id: CHANNEL, conversationType: "channel" }),
      type: "installationUpdate",
      action: "remove",
      channelData: { tenant: { id: TENANT }, team: { id: "19:team@thread.tacv2", name: "Platform" } },
    });
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } });
    expect((ws.settings as { teams?: unknown }).teams).toBeUndefined();
    expect(await teamsReminders(f.workspaceId)).toBeNull();
  });
});
