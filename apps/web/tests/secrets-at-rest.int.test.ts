import { prisma } from "@ronde/db";
import { afterAll, describe, expect, it } from "vitest";
import { auth } from "@/lib/server/auth";
import { authPrisma } from "@/lib/server/sso-secrets";

// Secrets the sign-in keeps are encrypted in the database: an identity provider's client secret (kept by Better
// Auth's SSO plugin in its settings), and the tokens Google, GitHub, Microsoft or the provider give at sign-in

const providerId = `ws-secrets-${Date.now().toString(36)}`;
const settings = (clientSecret: string) =>
  JSON.stringify({ clientId: "ronde", clientSecret, discoveryEndpoint: "https://idp.acme.test/.well-known/openid-configuration" });

afterAll(async () => {
  await prisma.ssoProvider.deleteMany({ where: { providerId } });
});

describe("secrets at rest", () => {
  it("keeps an identity provider's client secret encrypted, readable by the SSO plugin", async () => {
    await authPrisma.ssoProvider.create({
      data: { id: providerId, providerId, issuer: "https://idp.acme.test", domain: "acme.test", oidcConfig: settings("s3cret-value") },
    });
    const stored = await prisma.ssoProvider.findUniqueOrThrow({ where: { providerId } });
    expect(stored.oidcConfig).not.toContain("s3cret-value");
    expect(JSON.parse(stored.oidcConfig!)).toMatchObject({ clientId: "ronde", clientSecret: expect.stringMatching(/^v1:/) });
    // What the plugin reads: as it wrote it
    const read = await authPrisma.ssoProvider.findFirst({ where: { providerId } });
    expect(JSON.parse(read!.oidcConfig!)).toMatchObject({ clientSecret: "s3cret-value" });
    expect(JSON.parse((await authPrisma.ssoProvider.findMany({ where: { providerId } }))[0]!.oidcConfig!).clientSecret).toBe(
      "s3cret-value",
    );

    await authPrisma.ssoProvider.update({ where: { providerId }, data: { oidcConfig: settings("rotated") } });
    const rotated = await prisma.ssoProvider.findUniqueOrThrow({ where: { providerId } });
    expect(rotated.oidcConfig).not.toContain("rotated");
    expect(JSON.parse((await authPrisma.ssoProvider.findUniqueOrThrow({ where: { providerId } })).oidcConfig!).clientSecret).toBe(
      "rotated",
    );
  });

  it("asks Better Auth to encrypt the sign-in tokens of the accounts", () => {
    expect(auth.options.account?.encryptOAuthTokens).toBe(true);
  });
});
