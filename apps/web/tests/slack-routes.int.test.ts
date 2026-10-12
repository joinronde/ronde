import { createHmac } from "node:crypto";
import { prisma } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { workspace } from "./fixtures";

// The addresses Slack calls (events, "/ronde", buttons and forms): only what Slack signed is read, a request
// replayed later is refused, and each one answers as Slack expects

const SECRET = "slack-signing-secret-for-tests";
const { POST: events } = await import("@/app/api/slack/events/route");
const { POST: command } = await import("@/app/api/slack/command/route");
const { POST: interact } = await import("@/app/api/slack/interact/route");

beforeAll(() => {
  vi.stubEnv("SLACK_CLIENT_ID", "1.2");
  vi.stubEnv("SLACK_CLIENT_SECRET", "client-secret");
  vi.stubEnv("SLACK_SIGNING_SECRET", SECRET);
});
afterAll(() => vi.unstubAllEnvs());

/** A request as Slack sends it: signed with the app's secret (v0), at a time; a wrong secret forges it */
function fromSlack(body: string, { secret = SECRET, at = Math.floor(Date.now() / 1000) } = {}) {
  const signature = `v0=${createHmac("sha256", secret).update(`v0:${at}:${body}`).digest("hex")}`;
  return new Request("http://x", {
    method: "POST",
    body,
    headers: {
      "x-slack-request-timestamp": String(at),
      "x-slack-signature": signature,
      "content-type": "application/x-www-form-urlencoded",
    },
  });
}

describe("Slack's requests", () => {
  it("answer the address check when the app is set up, and nothing unsigned, forged or replayed", async () => {
    const check = JSON.stringify({ type: "url_verification", challenge: "abc123" });
    const ok = await events(fromSlack(check));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ challenge: "abc123" });
    expect((await events(new Request("http://x", { method: "POST", body: check }))).status).toBe(401);
    expect((await events(fromSlack(check, { secret: "someone-else" }))).status).toBe(401);
    // Signed ten minutes ago: a replay
    expect((await events(fromSlack(check, { at: Math.floor(Date.now() / 1000) - 600 }))).status).toBe(401);
  });

  it("forget a Slack workspace that removed the app, whatever the plan of the Ronde workspace", async () => {
    vi.stubEnv("RONDE_CLOUD", "1");
    const w = await workspace(`slack-routes-${Date.now().toString(36)}`);
    await prisma.workspace.update({
      where: { id: w.ws.id },
      data: { plan: "community", settings: { slack: { teamId: "T-GONE", teamName: "Acme", botToken: "x", reminders: true } } },
    });
    const res = await events(fromSlack(JSON.stringify({ type: "event_callback", team_id: "T-GONE", event: { type: "app_uninstalled" } })));
    expect(res.status).toBe(200);
    const settings = (await prisma.workspace.findUniqueOrThrow({ where: { id: w.ws.id } })).settings as { slack?: unknown };
    expect(settings.slack).toBeUndefined();
  });

  it("answer /ronde to the person only, and turn away what is not Slack's", async () => {
    const body = new URLSearchParams({ command: "/ronde", team_id: "T-NOWHERE", user_id: "U1" }).toString();
    const res = await command(fromSlack(body));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ response_type: "ephemeral" });
    expect((await command(fromSlack(body, { secret: "forged" }))).status).toBe(401);
  });

  it("take buttons and forms only signed and well formed", async () => {
    const payload = new URLSearchParams({
      payload: JSON.stringify({ type: "block_actions", team: { id: "T-NOWHERE" }, user: { id: "U1" }, actions: [] }),
    });
    expect((await interact(fromSlack(payload.toString()))).status).toBe(200);
    expect((await interact(fromSlack("payload=not-json"))).status).toBe(400);
    expect((await interact(fromSlack(payload.toString(), { secret: "forged" }))).status).toBe(401);
  });
});
