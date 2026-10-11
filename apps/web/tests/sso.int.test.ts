import { generateKeyPairSync, sign } from "node:crypto";
import { prisma } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enterprise } from "@/ee-bridge";
import { auth } from "@/lib/server/auth";
import { INTERNAL_HEADER, INTERNAL_TOKEN, identityHost } from "@/lib/server/identity";
import { saveLicense } from "@/lib/server/license";
import { workspace } from "./fixtures";

// Single sign-on per workspace: the plugin's administration only through Ronde, sign-in routed by domain,
// and an identity provider never signing in addresses outside its workspace's verified domains

// The administrator signs up during the test
process.env.SIGNUP_POLICY = "open";

const pair = generateKeyPairSync("ed25519");
process.env.RONDE_LICENSE_TEST_KEYS = JSON.stringify({ "test-sso": pair.publicKey.export({ format: "jwk" }).x });
const body = Buffer.from(
  JSON.stringify({
    kid: "test-sso",
    id: "lic_s",
    customer: "Acme",
    edition: "enterprise",
    seats: 0,
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
  }),
).toString("base64url");
const KEY = `ronde_lic_v1.${body}.${sign(null, Buffer.from(`ronde_lic_v1.${body}`), pair.privateKey).toString("base64url")}`;
// A self-signed certificate is enough to register a SAML provider
const CERT =
  "MIIBszCCAVmgAwIBAgIUQmVuY2htYXJrQ2VydGlmaWNhdGUwCgYIKoZIzj0EAwIwEjEQMA4GA1UEAwwHdGVzdC1pZHAwHhcNMjYwMTAxMDAwMDAwWhcNMzYwMTAxMDAwMDAwWjASMRAwDgYDVQQDDAd0ZXN0LWlkcDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABHk0zG0n9eKQ8z0Pq9k2u0jYQ7oU5mJb8yQ1m8Q4mQyY6u3P2D5gX4p5kX1W3o9c7m0r0Wn6l3jv9Qm0s7m3o0ajUzBRMB0GA1UdDgQWBBQKz8yQpWQ2g8U7gZx0mWb7o0n2qTAfBgNVHSMEGDAWgBQKz8yQpWQ2g8U7gZx0mWb7o0n2qTAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0gAMEUCIQDp9a1Y2s3d4f5g6h7j8k9l0m1n2o3p4q5r6s7t8u9v0wIgW1x2y3z4a5b6c7d8e9f0g1h2i3j4k5l6m7n8o9p0q1r=";

let w: Awaited<ReturnType<typeof workspace>>;
const DOMAIN = `sso-${Date.now().toString(36)}.test`;
const providerId = `ws-sso-${Date.now().toString(36)}`;
let cookie: Headers;

beforeAll(async () => {
  w = await workspace(`sso-${Date.now().toString(36)}`);
  await saveLicense(KEY);
  await prisma.workspaceDomain.create({ data: { workspaceId: w.ws.id, domain: DOMAIN, token: "t", verifiedAt: new Date() } });
  // A signed-in administrator, as the settings page has one
  const res = await auth.api.signUpEmail({
    body: { email: `admin@${DOMAIN}x`, password: "admin-password-123", name: "Admin" },
    returnHeaders: true,
  });
  cookie = new Headers({
    cookie: res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
  });
});

afterAll(async () => {
  await saveLicense("");
});

const api = () => auth.api as unknown as Record<string, (args: object) => Promise<unknown>>;

describe("single sign-on per workspace", () => {
  it("refuses the plugin's administration when it does not come from Ronde's server", async () => {
    const reg = enterprise.identity.ssoRegistration(
      { name: "Evil", domains: [DOMAIN], saml: { entryPoint: "https://evil.test/sso", idpEntityId: "evil", certificate: CERT } },
      { appUrl: "http://localhost:3000", providerId: "evil" },
    );
    await expect(api().registerSSOProvider!({ body: reg.body, headers: cookie })).rejects.toMatchObject({
      body: { message: "SSO_ADMIN_FORBIDDEN" },
    });
  });

  it("registers a SAML provider and routes the domain's addresses to it", async () => {
    const reg = enterprise.identity.ssoRegistration(
      {
        name: "Acme IdP",
        domains: [DOMAIN],
        saml: { entryPoint: "https://idp.acme.test/sso", idpEntityId: "https://idp.acme.test", certificate: CERT },
      },
      { appUrl: "http://localhost:3000", providerId },
    );
    const h = new Headers(cookie);
    h.set(INTERNAL_HEADER, INTERNAL_TOKEN);
    await api().registerSSOProvider!({ body: reg.body, headers: h });
    await prisma.ssoProvider.update({ where: { providerId }, data: { workspaceId: w.ws.id, name: "Acme IdP" } });
    const res = (await api().signInSSO!({ body: { email: `zoe@${DOMAIN}`, callbackURL: "/" } })) as { url: string };
    expect(res.url.startsWith("https://idp.acme.test/sso?SAMLRequest=")).toBe(true);
  });

  it("only signs in addresses of its workspace's verified domains, linking existing accounts", async () => {
    expect(await enterprise.identity.resolveSsoUser(identityHost, providerId, `ceo@other.test`)).toEqual({
      action: "reject",
      code: "SSO_DOMAIN_MISMATCH",
    });
    expect(await enterprise.identity.resolveSsoUser(identityHost, providerId, `new@${DOMAIN}`)).toEqual({ action: "continue" });
    const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `old@${DOMAIN}`, name: "Old" } });
    expect(await enterprise.identity.resolveSsoUser(identityHost, providerId, `OLD@${DOMAIN}`)).toEqual({
      action: "link",
      userId: user.id,
      profile: "preserve",
    });
    // The domain is no longer verified: the provider stops
    await prisma.workspaceDomain.updateMany({ where: { domain: DOMAIN }, data: { verifiedAt: null } });
    expect(await enterprise.identity.resolveSsoUser(identityHost, providerId, `new@${DOMAIN}`)).toMatchObject({ action: "reject" });
  });

  it("stops without the license", async () => {
    await saveLicense("");
    expect(await enterprise.identity.resolveSsoUser(identityHost, providerId, `new@${DOMAIN}`)).toEqual({
      action: "reject",
      code: "SSO_NOT_IN_PLAN",
    });
  });
});
