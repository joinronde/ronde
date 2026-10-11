import { createVerify, generateKeyPairSync } from "node:crypto";
import type { VideoAccess } from "@ronde/editions/ee";
import { describe, expect, it } from "vitest";
import { test as check, createRoom } from "../src/video";

// Video links: what each provider receives, with the workspace account

type Call = { url: string; init: RequestInit };
const fake = (answers: unknown[], status = 200) => {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(answers[calls.length - 1] ?? {}), { status });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
};
const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

describe("video links", () => {
  it("opens a Zoom meeting with no fixed time, with the account's server-to-server credentials", async () => {
    const f = fake([{ access_token: "zt" }, { join_url: "https://zoom.us/j/123", id: 123 }]);
    const a: VideoAccess = { kind: "zoom", config: { accountId: "acc", clientId: "cid" }, secret: "csecret", fetch: f.fetch };
    expect(await createRoom(a, { topic: "Weekly", timezone: "Europe/Paris" })).toEqual({ url: "https://zoom.us/j/123", id: "123" });
    expect(f.calls[0]!.url).toBe("https://zoom.us/oauth/token?grant_type=account_credentials&account_id=acc");
    expect(header(f.calls[0]!, "authorization")).toBe(`Basic ${Buffer.from("cid:csecret").toString("base64")}`);
    expect(JSON.parse(String(f.calls[1]!.init.body))).toMatchObject({ topic: "Weekly", type: 3, timezone: "Europe/Paris" });
    expect(header(f.calls[1]!, "authorization")).toBe("Bearer zt");
  });

  it("signs the Google assertion for the user of the domain, then creates a Meet space", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const f = fake([{ access_token: "gt" }, { meetingUri: "https://meet.google.com/abc-defg-hij", name: "spaces/x" }]);
    const a: VideoAccess = {
      kind: "meet",
      config: { clientEmail: "ronde@acme.iam.gserviceaccount.com", subject: "rooms@acme.com" },
      secret: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      fetch: f.fetch,
    };
    expect((await createRoom(a, { topic: "Weekly", timezone: "UTC" })).url).toBe("https://meet.google.com/abc-defg-hij");
    const assertion = new URLSearchParams(String(f.calls[0]!.init.body)).get("assertion")!;
    const [head, claims, signature] = assertion.split(".");
    expect(createVerify("RSA-SHA256").update(`${head}.${claims}`).verify(publicKey, signature!, "base64url")).toBe(true);
    expect(JSON.parse(Buffer.from(claims!, "base64url").toString())).toMatchObject({
      sub: "rooms@acme.com",
      iss: "ronde@acme.iam.gserviceaccount.com",
    });
    expect(f.calls[1]!.url).toBe("https://meet.googleapis.com/v2/spaces");
  });

  it("creates the Teams meeting for the organiser, and reports a refused secret", async () => {
    const f = fake([{ access_token: "mt" }, { joinWebUrl: "https://teams.microsoft.com/l/meetup-join/x", id: "m1" }]);
    const a: VideoAccess = {
      kind: "teams",
      config: { tenant: "t1", clientId: "app", organizer: "rooms@acme.com" },
      secret: "s",
      fetch: f.fetch,
    };
    expect((await createRoom(a, { topic: "Weekly", timezone: "UTC" })).url).toBe("https://teams.microsoft.com/l/meetup-join/x");
    expect(f.calls[0]!.url).toBe("https://login.microsoftonline.com/t1/oauth2/v2.0/token");
    expect(f.calls[1]!.url).toBe("https://graph.microsoft.com/v1.0/users/rooms%40acme.com/onlineMeetings");
    const refused = fake([{ error_description: "Invalid client secret" }], 401);
    expect(await check({ ...a, fetch: refused.fetch })).toEqual({ ok: false, error: "401: Invalid client secret" });
  });
});
