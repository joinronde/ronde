import { notifyMessage } from "@ronde/core/notify";
import { DEFAULT_SECTIONS } from "@ronde/core/util";
import { describe, expect, it, vi } from "vitest";
import { DRIVERS, isSafeUrl, type Outgoing, signWebhook, TEAMS_BOT_SECRET } from "../src/index";

const message = notifyMessage({
  event: "session.started",
  settings: { teamName: "Tools", targetMin: 25, speakSec: 120, videoUrl: "https://meet.example.com/x", sections: DEFAULT_SECTIONS },
  locale: "en",
  meetingUrl: "https://app.example.com/w/acme/m/m1",
});
const out: Outgoing = {
  id: "d1",
  event: "session.started",
  message,
  data: { date: "2026-10-12" },
  meeting: { id: "m1", name: "Tools", url: "https://app.example.com/w/acme/m/m1" },
};

/** A fetch that records requests and answers with the given status */
function fakeFetch(status = 200, json: object = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("chat webhooks", () => {
  it.each([
    ["slack", "https://hooks.slack.com/services/T/B/x", "blocks"],
    ["discord", "https://discord.com/api/webhooks/1/x", "embeds"],
    ["mattermost", "https://chat.example.com/hooks/x", "text"],
    ["teams", "https://prod.westeurope.logic.azure.com/workflows/x", "attachments"],
  ] as const)("posts %s its own format to the secret address", async (kind, secret, key) => {
    const { fetch, calls } = fakeFetch();
    await DRIVERS[kind].send(out, { config: {}, secret, target: {} }, { fetch });
    expect(calls[0]!.url).toBe(secret);
    expect(JSON.parse(String(calls[0]!.init.body))).toHaveProperty(key);
  });

  it("only accepts addresses of the service itself for Slack and Discord", () => {
    expect(DRIVERS.slack.secret!.safeParse("https://hooks.slack.com/services/T/B/x").success).toBe(true);
    expect(DRIVERS.slack.secret!.safeParse("https://evil.example.com/hooks.slack.com").success).toBe(false);
    expect(DRIVERS.discord.secret!.safeParse("http://discord.com/api/webhooks/1/x").success).toBe(false);
    expect(isSafeUrl("http://localhost:4000/hook")).toBe(true);
  });

  it("reports a refusal with the service and the status", async () => {
    const { fetch } = fakeFetch(404);
    await expect(
      DRIVERS.slack.send(out, { config: {}, secret: "https://hooks.slack.com/services/x", target: {} }, { fetch }),
    ).rejects.toMatchObject({
      key: "connectorRefused",
      values: { host: "hooks.slack.com", status: 404 },
    });
  });
});

describe("Teams through Ronde's app", () => {
  it("posts the card as the app in the channel it was added to, without any webhook", async () => {
    const posted: { ref: unknown; activity: object }[] = [];
    const secret = `${TEAMS_BOT_SECRET}${JSON.stringify({ serviceUrl: "https://smba.trafficmanager.net/emea/", conversationId: "19:general@thread.tacv2" })}`;
    const fetch = (async () => {
      throw new Error("no request expected");
    }) as unknown as typeof globalThis.fetch;
    await DRIVERS.teams.send(
      out,
      { config: {}, secret, target: {} },
      { fetch, teamsBot: async (ref, activity) => void posted.push({ ref, activity }) },
    );
    expect(posted[0]!.ref).toEqual({ serviceUrl: "https://smba.trafficmanager.net/emea/", conversationId: "19:general@thread.tacv2" });
    expect(JSON.stringify(posted[0]!.activity)).toContain("application/vnd.microsoft.card.adaptive");
    // Without the app on this server, the message cannot go
    await expect(DRIVERS.teams.send(out, { config: {}, secret, target: {} }, { fetch })).rejects.toThrow();
  });
});

describe("Matrix", () => {
  it("resolves an alias, then posts text and HTML with an idempotent transaction id", async () => {
    const { fetch, calls } = fakeFetch(200, { room_id: "!abc:example.org" });
    await DRIVERS.matrix.send(
      out,
      { config: { homeserver: "https://matrix.example.org/" }, secret: "syt_token_123", target: { room: "#team:example.org" } },
      { fetch },
    );
    expect(calls[0]!.url).toBe("https://matrix.example.org/_matrix/client/v3/directory/room/%23team%3Aexample.org");
    expect(calls[1]!.url).toBe("https://matrix.example.org/_matrix/client/v3/rooms/!abc%3Aexample.org/send/m.room.message/ronde-d1");
    const body = JSON.parse(String(calls[1]!.init.body));
    expect(body).toMatchObject({ msgtype: "m.text", format: "org.matrix.custom.html" });
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBe("Bearer syt_token_123");
  });

  it("explains a refused token", async () => {
    const { fetch } = fakeFetch(401);
    await expect(
      DRIVERS.matrix.send(
        out,
        { config: { homeserver: "https://matrix.example.org" }, secret: "syt_token_123", target: { room: "!a:b.c" } },
        { fetch },
      ),
    ).rejects.toMatchObject({ key: "matrixTokenRefused" });
  });
});

describe("webhook", () => {
  it("signs the body with a timestamp", async () => {
    const { fetch, calls } = fakeFetch();
    await DRIVERS.webhook.send(
      out,
      { config: { url: "https://hooks.example.com/ronde" }, secret: "whsec_test_key_0123456789", target: {} },
      { fetch, now: () => 1_791_000_000_000 },
    );
    const headers = calls[0]!.init.headers as Record<string, string>;
    const body = String(calls[0]!.init.body);
    expect(headers["X-Ronde-Event"]).toBe("session.started");
    expect(headers["X-Ronde-Timestamp"]).toBe("1791000000");
    expect(headers["X-Ronde-Signature"]).toBe(`sha256=${signWebhook("whsec_test_key_0123456789", "1791000000", body)}`);
    expect(JSON.parse(body)).toMatchObject({ id: "d1", event: "session.started", meeting: { id: "m1" }, data: { date: "2026-10-12" } });
  });

  it("matches a known HMAC-SHA256 vector", () => {
    // echo -n '1700000000.{"a":1}' | openssl dgst -sha256 -hmac key
    expect(signWebhook("key", "1700000000", '{"a":1}')).toBe("a438e398bfafc57e4396bb7fc2304422f0f768e965d073ca313cb52e22e6ad03");
  });
});

describe("email", () => {
  it("sends the message to the recipients, through the instance SMTP", async () => {
    const sendMail = vi.fn(async () => undefined);
    await DRIVERS.email.send(out, { config: {}, secret: "", target: { to: ["ada@example.com"] } }, { fetch: globalThis.fetch, sendMail });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: ["ada@example.com"], subject: message.summary }));
  });
});

describe("SMS and WhatsApp (Twilio)", () => {
  const config = { accountSid: `AC${"a".repeat(32)}`, from: "+33600000000" };
  it.each([
    ["sms", ""],
    ["whatsapp", "whatsapp:"],
  ] as const)("sends %s one message per number, with basic auth", async (kind, prefix) => {
    const { fetch, calls } = fakeFetch(201);
    await DRIVERS[kind].send(out, { config, secret: "t".repeat(32), target: { to: ["+33611111111", "+4915112345678"] } }, { fetch });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe(`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`);
    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(form.get("To")).toBe(`${prefix}+33611111111`);
    expect(form.get("From")).toBe(`${prefix}+33600000000`);
    expect(form.get("Body")).toContain(out.meeting.url);
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from(`${config.accountSid}:${"t".repeat(32)}`).toString("base64")}`,
    );
  });
  it("sends WhatsApp as the approved template when there is one: the message and the link as its variables", async () => {
    const { fetch, calls } = fakeFetch(201);
    const contentSid = `HX${"b".repeat(32)}`;
    await DRIVERS.whatsapp.send(
      out,
      { config: { ...config, contentSid }, secret: "t".repeat(32), target: { to: ["+33611111111"] } },
      { fetch },
    );
    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(form.get("ContentSid")).toBe(contentSid);
    expect(form.get("Body")).toBeNull();
    const variables = JSON.parse(form.get("ContentVariables")!) as Record<string, string>;
    expect(variables["2"]).toBe(out.meeting.url);
    expect(variables["1"]).not.toMatch(/\n/);
    // The link is the second variable only, and the first stays short enough for a template body
    expect(variables["1"]).not.toContain(out.meeting.url);
    expect(variables["1"]!.length).toBeLessThanOrEqual(600);
    expect(DRIVERS.whatsapp.config.safeParse({ ...config, contentSid: "nope" }).success).toBe(false);
    expect(DRIVERS.whatsapp.config.safeParse({ ...config, contentSid: "" }).success).toBe(true);
  });
  it("tries every number when one refuses, and tells which were reached", async () => {
    const calls: string[] = [];
    const fetch = (async (_url: string, init: RequestInit) => {
      const to = new URLSearchParams(String(init.body)).get("To")!;
      calls.push(to);
      return new Response("{}", { status: to.endsWith("222") ? 400 : 201 });
    }) as unknown as typeof globalThis.fetch;
    const sent: string[] = [];
    await expect(
      DRIVERS.sms.send(
        out,
        { config, secret: "t".repeat(32), target: { to: ["+33611111111", "+33622222222", "+33633333333"] } },
        { fetch, sent: (r) => sent.push(r) },
      ),
    ).rejects.toThrow();
    expect(calls).toHaveLength(3);
    expect(sent).toEqual(["+33611111111", "+33633333333"]);
  });
  it("checks the account and the sender number", () => {
    expect(DRIVERS.sms.config.safeParse({ accountSid: "nope", from: "+33600000000" }).success).toBe(false);
    expect(DRIVERS.sms.config.safeParse({ accountSid: config.accountSid, from: "0612345678" }).success).toBe(false);
    expect(DRIVERS.sms.config.safeParse(config).success).toBe(true);
  });
});
