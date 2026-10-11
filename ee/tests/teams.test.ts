import type { TeamsApp } from "@ronde/editions/ee";
import { strFromU8, unzipSync } from "fflate";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { appPackage, call, isServiceUrl, resetTeamsCache, verify } from "../src/teams";

// The Teams app's protocol: requests of the Bot Connector checked against Microsoft's keys, calls with the
// app's token, and the package an administrator uploads to Teams

const app: TeamsApp = { appId: "11111111-2222-3333-4444-555555555555", password: "secret", tenantId: "tenant-home" };
const SERVICE = "https://smba.trafficmanager.net/emea/";
let sign: (claims: Record<string, unknown>, kid?: string) => Promise<string>;
let keys: object[];

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  const jwk = await exportJWK(pair.publicKey);
  keys = [
    { ...jwk, kid: "k1", use: "sig", endorsements: ["msteams", "webchat"] },
    { ...jwk, kid: "k2", endorsements: ["webchat"] },
  ];
  sign = (claims, kid = "k1") =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer("https://api.botframework.com")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(pair.privateKey);
});
beforeEach(() => resetTeamsCache());

type Call = { url: string; init: RequestInit };
/** Microsoft, as far as the app sees it: the OpenID document, the keys, the token service, the Bot Connector */
const microsoft = (answers: Record<string, unknown> = {}) => {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url.endsWith("/openidconfiguration")) return Response.json({ jwks_uri: "https://login.botframework.com/v1/.well-known/keys" });
    if (url.endsWith("/.well-known/keys")) return Response.json({ keys });
    if (url.includes("/oauth2/v2.0/token")) return Response.json({ access_token: "bot-token", expires_in: 3600 });
    const hit = Object.entries(answers).find(([path]) => url.endsWith(path));
    return Response.json(hit?.[1] ?? {});
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
};
const activity = { serviceUrl: SERVICE, channelId: "msteams" };

describe("requests of the Bot Connector", () => {
  it("are accepted signed by Microsoft for this app, from the activity's service", async () => {
    const m = microsoft();
    const token = await sign({ aud: app.appId, serviceUrl: SERVICE });
    expect(await verify(`Bearer ${token}`, activity, app, m.fetch)).toBe(true);
    // The keys are kept for the next requests
    expect(await verify(`Bearer ${token}`, activity, app, m.fetch)).toBe(true);
    expect(m.calls.filter((c) => c.url.endsWith("/keys"))).toHaveLength(1);
  });

  it("are refused for another app, another service, an unendorsed channel, or without a token", async () => {
    const m = microsoft();
    expect(await verify(`Bearer ${await sign({ aud: "someone-else", serviceUrl: SERVICE })}`, activity, app, m.fetch)).toBe(false);
    expect(await verify(`Bearer ${await sign({ aud: app.appId, serviceUrl: "https://evil.example.com/" })}`, activity, app, m.fetch)).toBe(
      false,
    );
    // Signed by a key Microsoft does not endorse for Teams
    expect(await verify(`Bearer ${await sign({ aud: app.appId, serviceUrl: SERVICE }, "k2")}`, activity, app, m.fetch)).toBe(false);
    expect(await verify(`Bearer ${await sign({ aud: app.appId, serviceUrl: SERVICE }, "unknown")}`, activity, app, m.fetch)).toBe(false);
    expect(await verify("", activity, app, m.fetch)).toBe(false);
    expect(await verify("Bearer not-a-token", activity, app, m.fetch)).toBe(false);
  });
});

describe("calls to Teams", () => {
  it("carry the app's token, asked once to its own tenant", async () => {
    const m = microsoft({ "/v3/conversations": { id: "a:1x2y" } });
    expect(await call(app, SERVICE, "/v3/conversations", { body: { isGroup: false } }, m.fetch)).toEqual({ id: "a:1x2y" });
    await call(app, SERVICE, "/v3/conversations/a:1x2y/members/29:abc", {}, m.fetch);
    const token = m.calls.filter((c) => c.url.includes("/oauth2/v2.0/token"));
    expect(token).toHaveLength(1);
    expect(token[0]!.url).toBe("https://login.microsoftonline.com/tenant-home/oauth2/v2.0/token");
    expect(String(token[0]!.init.body)).toContain("scope=https%3A%2F%2Fapi.botframework.com%2F.default");
    const sent = m.calls.find((c) => c.url === "https://smba.trafficmanager.net/emea/v3/conversations")!;
    expect((sent.init.headers as Record<string, string>).authorization).toBe("Bearer bot-token");
  });

  it("only go to Teams' own services", async () => {
    expect(isServiceUrl("https://smba.trafficmanager.net/amer/")).toBe(true);
    expect(isServiceUrl("https://smba.infra.gcc.teams.microsoft.com/teams/")).toBe(true);
    expect(isServiceUrl("http://smba.trafficmanager.net/")).toBe(false);
    expect(isServiceUrl("https://trafficmanager.net.evil.example/")).toBe(false);
    await expect(call(app, "https://evil.example/", "/v3/conversations", {}, microsoft().fetch)).rejects.toThrow();
  });
});

describe("the app package", () => {
  it("holds the manifest of the bot, a file per other language and the icons", () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const zip = appPackage(app, {
      domain: "app.joinronde.com",
      version: "1.2.0",
      developer: {
        name: "Ronde",
        websiteUrl: "https://joinronde.com",
        privacyUrl: "https://joinronde.com/privacy",
        termsOfUseUrl: "https://joinronde.com/terms",
      },
      accentColor: "#B8410E",
      texts: [
        {
          locale: "en",
          shortName: "Ronde",
          fullName: "Ronde: your team's recurring meetings",
          shortDescription: "Check-ins, reminders and minutes of your recurring meetings.",
          fullDescription: "Long text",
          commands: [{ title: "ronde", description: "Your next sessions" }],
        },
        {
          locale: "fr",
          shortName: "Ronde",
          fullName: "Ronde : les réunions récurrentes de votre équipe",
          shortDescription: "Fiches, rappels et comptes rendus.",
          fullDescription: "Texte long",
          commands: [{ title: "ronde", description: "Vos prochaines séances" }],
        },
      ],
      icons: { color: png, outline: png },
    });
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(["color.png", "fr.json", "manifest.json", "outline.png"]);
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!));
    expect(manifest).toMatchObject({
      id: app.appId,
      version: "1.2.0",
      bots: [{ botId: app.appId, scopes: ["personal", "team"] }],
      validDomains: ["app.joinronde.com"],
      localizationInfo: { defaultLanguageTag: "en", additionalLanguages: [{ languageTag: "fr", file: "fr.json" }] },
    });
    expect(JSON.parse(strFromU8(files["fr.json"]!))["bots[0].commandLists[0].commands[0].description"]).toBe("Vos prochaines séances");
  });
});
