import { generateKeyPairSync, sign } from "node:crypto";
import { prisma, scoped } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enterprise } from "@/ee-bridge";
import { auth } from "@/lib/server/auth";
import { captured, captureNewUser, endDomainSessions, ssoRequired } from "@/lib/server/domains";
import { saveLicense } from "@/lib/server/license";
import { workspace } from "./fixtures";

// Email domains: DNS verification, capture of new accounts, single sign-on required at sign-in

const pair = generateKeyPairSync("ed25519");
process.env.RONDE_LICENSE_TEST_KEYS = JSON.stringify({ "test-dom": pair.publicKey.export({ format: "jwk" }).x });
const body = Buffer.from(
  JSON.stringify({
    kid: "test-dom",
    id: "lic_d",
    customer: "Acme",
    edition: "enterprise",
    seats: 0,
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
  }),
).toString("base64url");
const KEY = `ronde_lic_v1.${body}.${sign(null, Buffer.from(`ronde_lic_v1.${body}`), pair.privateKey).toString("base64url")}`;

let w: Awaited<ReturnType<typeof workspace>>;
const DOMAIN = `acme-${Date.now().toString(36)}.test`;
let domainId: string;
const db = () => scoped(prisma, w.ws.id);

beforeAll(async () => {
  w = await workspace("domains");
  await saveLicense(KEY);
});

afterAll(async () => {
  await saveLicense("");
});

describe("email domains", () => {
  it("are verified by their DNS record only", async () => {
    const view = await enterprise.domains.add(db(), w.ws.id, DOMAIN.toUpperCase());
    domainId = view.id;
    expect(view).toMatchObject({ domain: DOMAIN, verified: false, record: { name: `_ronde-challenge.${DOMAIN}` } });
    await expect(enterprise.domains.update(db(), view.id, { capture: true })).rejects.toMatchObject({ key: "domainNotVerified" });
    expect(await enterprise.domains.verify(db(), view.id, async () => [["ronde-verification=wrong"]])).toBe(false);
    expect(
      await enterprise.domains.verify(db(), view.id, async (name) =>
        name === view.record.name ? [[view.record.value.slice(0, 10), view.record.value.slice(10)]] : [],
      ),
    ).toBe(true);
  });

  it("capture new accounts of the domain as members", async () => {
    await enterprise.domains.update(db(), domainId, { capture: true });
    expect(await captured(`zoe@${DOMAIN}`)).toBe(true);
    expect(await captured("zoe@elsewhere.test")).toBe(false);
    const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `zoe@${DOMAIN}`, name: "Zoe Martin" } });
    await captureNewUser(user);
    const member = await prisma.workspaceMember.findFirstOrThrow({ where: { userId: user.id }, include: { person: true } });
    expect(member).toMatchObject({ workspaceId: w.ws.id, role: "member", person: { firstName: "Zoe", lastName: "Martin" } });
  });

  it("refuse a password sign-in once single sign-on is required", async () => {
    await enterprise.domains.update(db(), domainId, { enforceSso: true });
    expect(await ssoRequired(`zoe@${DOMAIN}`)).toBe(true);
    await expect(auth.api.signInEmail({ body: { email: `zoe@${DOMAIN}`, password: "whatever-password" } })).rejects.toMatchObject({
      body: { code: "SSO_REQUIRED" },
    });
    expect(await ssoRequired("zoe@elsewhere.test")).toBe(false);
  });

  it("open no session another way: a sign-in link sent before is refused, and older sessions end", async () => {
    const email = `zoe@${DOMAIN}`;
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    // A link asked for while single sign-on was not required yet
    await enterprise.domains.update(db(), domainId, { enforceSso: false });
    await auth.api.signInMagicLink({ body: { email, callbackURL: "/" }, headers: new Headers() });
    const link = await prisma.verification.findFirstOrThrow({ where: { value: { contains: email } }, orderBy: { createdAt: "desc" } });
    await enterprise.domains.update(db(), domainId, { enforceSso: true });
    // Following the link in a browser opens nothing: back to the sign-in page, which explains why
    const token = link.identifier.replace(/^magic-link:/, "");
    const res = await auth.handler(new Request(`http://localhost:3000/api/auth/magic-link/verify?token=${token}&callbackURL=/`));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toMatch(/\/sign-in\?error=SSO_REQUIRED$/);
    expect(await prisma.authSession.count({ where: { userId: user.id } })).toBe(0);
    // Sessions opened before the requirement
    await prisma.authSession.create({
      data: { id: crypto.randomUUID(), token: crypto.randomUUID(), userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    const kept = await prisma.authSession.create({
      data: { id: crypto.randomUUID(), token: crypto.randomUUID(), userId: user.id, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    // Turning the requirement on ends the sessions opened before, but the administrator's
    expect(await endDomainSessions(DOMAIN.toUpperCase(), kept.id)).toBe(1);
    expect(await prisma.authSession.findMany({ where: { userId: user.id }, select: { id: true } })).toEqual([{ id: kept.id }]);
  });

  it("stop applying without the license", async () => {
    await saveLicense("");
    expect(await ssoRequired(`zoe@${DOMAIN}`)).toBe(false);
    expect(await captured(`zoe@${DOMAIN}`)).toBe(false);
  });
});
