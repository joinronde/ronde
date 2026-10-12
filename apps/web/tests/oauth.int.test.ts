import { prisma } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { workspace } from "./fixtures";

// Signing in through a provider, as a browser does it: Google (any social provider works the same way) and the
// instance's OpenID Connect provider, against fake providers. A domain requiring its company's sign-in refuses
// Google, and still lets the company's provider in.

// The providers are read when the auth module loads: set before any import (the fixtures load it too)
const { BASE, ISSUER } = vi.hoisted(() => {
  const BASE = "http://localhost:3000";
  const ISSUER = "https://idp.example.test";
  Object.assign(process.env, {
    APP_URL: BASE,
    RONDE_CLOUD: "1",
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    OIDC_ISSUER: ISSUER,
    OIDC_CLIENT_ID: "ronde",
    OIDC_CLIENT_SECRET: "oidc-secret",
  });
  return { BASE, ISSUER };
});

const run = Date.now().toString(36);
const SSO_DOMAIN = `sso-${run}.test`;
/** Who the fake providers say signs in */
let person = { email: "", name: "" };

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
/** An ID token as Google sends it (Better Auth reads its claims; the exchange with Google is what vouches for it) */
const idToken = (claims: object) => `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.signature`;

const { auth } = await import("@/lib/server/auth");

beforeAll(async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === "https://oauth2.googleapis.com/token")
        return Response.json({
          access_token: "google-access",
          token_type: "Bearer",
          expires_in: 3600,
          id_token: idToken({
            sub: `g-${person.email}`,
            email: person.email,
            email_verified: true,
            name: person.name,
            aud: "google-client",
          }),
        });
      if (url === `${ISSUER}/.well-known/openid-configuration`)
        return Response.json({
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/authorize`,
          token_endpoint: `${ISSUER}/token`,
          userinfo_endpoint: `${ISSUER}/userinfo`,
          jwks_uri: `${ISSUER}/jwks`,
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
        });
      if (url === `${ISSUER}/token`) return Response.json({ access_token: "oidc-access", token_type: "Bearer", expires_in: 3600 });
      if (url === `${ISSUER}/userinfo`)
        return Response.json({ sub: `o-${person.email}`, email: person.email, email_verified: true, name: person.name });
      throw new Error(`unexpected request to ${url} ${init?.method ?? "GET"}`);
    }),
  );
  // A company requiring its own sign-in for its domain (Enterprise)
  const w = await workspace(`oauth-${run}`);
  await prisma.workspace.update({ where: { id: w.ws.id }, data: { plan: "enterprise" } });
  await prisma.workspaceDomain.create({
    data: { workspaceId: w.ws.id, domain: SSO_DOMAIN, token: "t", verifiedAt: new Date(), enforceSso: true },
  });
});

afterAll(() => {
  vi.unstubAllGlobals();
  delete process.env.RONDE_CLOUD;
});

const cookiesOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

/** Starts a sign-in as the button does, then comes back from the provider with a code, as the browser would */
async function signIn(start: { path: string; body: object }, callback: (state: string) => string) {
  const begin = await auth.handler(
    new Request(`${BASE}/api/auth${start.path}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ ...start.body, callbackURL: "/after", errorCallbackURL: "/sign-in" }),
    }),
  );
  expect(begin.status).toBe(200);
  const { url } = (await begin.json()) as { url: string };
  const state = new URL(url).searchParams.get("state")!;
  return auth.handler(new Request(`${BASE}/api/auth${callback(state)}`, { headers: { cookie: cookiesOf(begin) } }));
}

const google = () => signIn({ path: "/sign-in/social", body: { provider: "google" } }, (s) => `/callback/google?code=abc&state=${s}`);
// The instance's provider signs in like a social one (Better Auth's generic OAuth), its own id in the callback
const oidc = () => signIn({ path: "/sign-in/social", body: { provider: "oidc" } }, (s) => `/callback/oidc?code=abc&state=${s}`);
const sessionCookie = (res: Response) =>
  res.headers.getSetCookie().some((c) => c.startsWith("ronde.session_token=") && !/Max-Age=0/i.test(c));

describe("signing in through a provider", () => {
  it("creates the account from Google and opens a session", async () => {
    person = { email: `lena-${run}@example.test`, name: "Lena Fischer" };
    const res = await google();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/\/after$/);
    expect(sessionCookie(res)).toBe(true);
    expect(await prisma.user.findUnique({ where: { email: person.email } })).toMatchObject({ name: "Lena Fischer", emailVerified: true });
    // Again: the same account, a new session
    const again = await google();
    expect(sessionCookie(again)).toBe(true);
    expect(await prisma.user.count({ where: { email: person.email } })).toBe(1);
  });

  it("signs in with the instance's OpenID Connect provider", async () => {
    person = { email: `omar-${run}@example.test`, name: "Omar Haddad" };
    const res = await oidc();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/\/after$/);
    expect(sessionCookie(res)).toBe(true);
    expect(await prisma.account.findFirst({ where: { providerId: "oidc", user: { email: person.email } } })).not.toBeNull();
  });

  it("refuses Google for a domain requiring its company's sign-in, and lets the company's provider in", async () => {
    person = { email: `ana@${SSO_DOMAIN}`, name: "Ana Costa" };
    const refused = await google();
    expect(refused.status).toBe(302);
    expect(refused.headers.get("location")).toMatch(/\/sign-in\?error=SSO_REQUIRED/);
    expect(sessionCookie(refused)).toBe(false);
    const user = await prisma.user.findUnique({ where: { email: person.email } });
    if (user) expect(await prisma.authSession.count({ where: { userId: user.id } })).toBe(0);

    const company = await oidc();
    expect(company.headers.get("location")).toMatch(/\/after$/);
    expect(sessionCookie(company)).toBe(true);
  });
});
