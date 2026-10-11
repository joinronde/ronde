import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authorizeUrl, call, exchange, SCOPES, SlackError, verify } from "../src/slack";

// The Slack app: requests from Slack checked with the signing secret, the installation, the Web API

const SECRET = "8f742231b10e8888abcd99yyyzzz85a5";
const signed = (body: string, ts: number, secret = SECRET) => `v0=${createHmac("sha256", secret).update(`v0:${ts}:${body}`).digest("hex")}`;

type Call = { url: string; init: RequestInit };
const fake = (answers: { status?: number; body: unknown }[]) => {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const a = answers[calls.length - 1] ?? { body: {} };
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
};
const app = { clientId: "123.456", clientSecret: "shh" };

describe("Slack app", () => {
  it("accepts a request signed by Slack, and nothing else", () => {
    const now = Date.UTC(2026, 9, 10, 12);
    const ts = now / 1000;
    const body = "token=x&team_id=T1&user_id=U1&command=%2Fronde";
    expect(verify(body, String(ts), signed(body, ts), SECRET, now)).toBe(true);
    // Another body, another secret, a replay, no secret at all
    expect(verify(`${body}&text=x`, String(ts), signed(body, ts), SECRET, now)).toBe(false);
    expect(verify(body, String(ts), signed(body, ts, "other"), SECRET, now)).toBe(false);
    expect(verify(body, String(ts - 301), signed(body, ts - 301), SECRET, now)).toBe(false);
    expect(verify(body, String(ts), signed(body, ts, ""), "", now)).toBe(false);
    expect(verify(body, "", "v0=", SECRET, now)).toBe(false);
  });

  it("sends the administrator to Slack's consent page with the app's scopes", () => {
    const url = new URL(authorizeUrl(app, "https://app.example.com/api/slack/oauth", "st.at.e"));
    expect(url.origin + url.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "123.456",
      scope: SCOPES.join(","),
      redirect_uri: "https://app.example.com/api/slack/oauth",
      state: "st.at.e",
    });
  });

  it("exchanges the code for the bot's token and the channel's webhook", async () => {
    const f = fake([
      {
        body: {
          ok: true,
          access_token: "xoxb-1",
          bot_user_id: "UBOT",
          team: { id: "T1", name: "Acme" },
          incoming_webhook: { url: "https://hooks.slack.com/services/T1/B1/x", channel: "#team" },
        },
      },
    ]);
    expect(await exchange(app, "code-1", "https://app.example.com/api/slack/oauth", f.fetch)).toEqual({
      teamId: "T1",
      teamName: "Acme",
      botToken: "xoxb-1",
      botUserId: "UBOT",
      webhookUrl: "https://hooks.slack.com/services/T1/B1/x",
      channel: "#team",
    });
    expect(f.calls[0]?.url).toBe("https://slack.com/api/oauth.v2.access");
    expect(Object.fromEntries(new URLSearchParams(String(f.calls[0]?.init.body)))).toMatchObject({ code: "code-1", client_secret: "shh" });
    await expect(exchange(app, "bad", "https://x", fake([{ body: { ok: false, error: "invalid_code" } }]).fetch)).rejects.toThrow(
      "invalid_code",
    );
  });

  it("calls the Web API form-encoded, with lists and objects as JSON", async () => {
    const f = fake([{ body: { ok: true, ts: "1.2" } }, { body: { ok: false, error: "channel_not_found" } }]);
    const blocks = [{ type: "section", text: { type: "mrkdwn", text: "Hi" } }];
    expect(await call("xoxb-1", "chat.postMessage", { channel: "U1", text: "Hi", blocks, unfurl: false }, f.fetch)).toMatchObject({
      ts: "1.2",
    });
    const sent = f.calls[0]!;
    expect(sent.url).toBe("https://slack.com/api/chat.postMessage");
    expect(new Headers(sent.init.headers).get("authorization")).toBe("Bearer xoxb-1");
    const form = new URLSearchParams(String(sent.init.body));
    expect(form.get("channel")).toBe("U1");
    expect(form.get("unfurl")).toBe("false");
    expect(JSON.parse(form.get("blocks") ?? "")).toEqual(blocks);
    const failed = await call("xoxb-1", "chat.postMessage", { channel: "C0" }, f.fetch).catch((e) => e);
    expect(failed).toBeInstanceOf(SlackError);
    expect(failed.message).toBe("channel_not_found");
  });
});
