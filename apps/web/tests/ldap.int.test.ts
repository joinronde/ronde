import { generateKeyPairSync, sign } from "node:crypto";
import { prisma } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auth } from "@/lib/server/auth";
import { saveLicense } from "@/lib/server/license";
import { encryptSecret } from "@/lib/server/secrets";
import { workspace } from "./fixtures";
import { startDirectory } from "./ldap-server";

// Company directory sign-in: the directory's password opens a Ronde session, the person joins the workspace

const pair = generateKeyPairSync("ed25519");
process.env.RONDE_LICENSE_TEST_KEYS = JSON.stringify({ "test-ldap": pair.publicKey.export({ format: "jwk" }).x });
const body = Buffer.from(
  JSON.stringify({
    kid: "test-ldap",
    id: "lic_l",
    customer: "Acme",
    edition: "enterprise",
    seats: 0,
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
  }),
).toString("base64url");
const KEY = `ronde_lic_v1.${body}.${sign(null, Buffer.from(`ronde_lic_v1.${body}`), pair.privateKey).toString("base64url")}`;

const DOMAIN = `ldap-${Date.now().toString(36)}.test`;
let dir: Awaited<ReturnType<typeof startDirectory>>;
let w: Awaited<ReturnType<typeof workspace>>;
const api = () => auth.api as unknown as Record<string, (args: object) => Promise<unknown>>;

beforeAll(async () => {
  dir = await startDirectory([
    { dn: "uid=grace,ou=people,dc=acme,dc=test", password: "grace-secret", attributes: { mail: `grace@${DOMAIN}`, cn: "Grace Hopper" } },
  ]);
  w = await workspace(`ldap-${Date.now().toString(36)}`);
  await prisma.workspaceDomain.create({ data: { workspaceId: w.ws.id, domain: DOMAIN, token: "t", verifiedAt: new Date() } });
  await prisma.ldapDirectory.create({
    data: {
      workspaceId: w.ws.id,
      url: dir.url,
      bindDn: dir.service.dn,
      bindPassword: encryptSecret(dir.service.password),
      baseDn: "ou=people,dc=acme,dc=test",
    },
  });
  await saveLicense(KEY);
});

afterAll(async () => {
  dir.close();
  await saveLicense("");
});

describe("company directory sign-in", () => {
  it("opens a session with the directory password and makes the person a member", async () => {
    const res = (await api().signInLdap!({ body: { email: `grace@${DOMAIN}`, password: "grace-secret" }, returnHeaders: true })) as {
      headers: Headers;
      response: { user: { id: string } };
    };
    expect(res.headers.getSetCookie().some((c) => c.startsWith("ronde.session_token="))).toBe(true);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: `grace@${DOMAIN}` } });
    expect(user).toMatchObject({ name: "Grace Hopper", emailVerified: true });
    expect(await prisma.workspaceMember.findFirst({ where: { workspaceId: w.ws.id, userId: user.id, role: "member" } })).not.toBeNull();
  });

  it("refuses a wrong password, and says when an address has no directory", async () => {
    await expect(api().signInLdap!({ body: { email: `grace@${DOMAIN}`, password: "nope" } })).rejects.toMatchObject({ statusCode: 401 });
    await expect(api().signInLdap!({ body: { email: "grace@elsewhere.test", password: "grace-secret" } })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("stops without the license", async () => {
    await saveLicense("");
    await expect(api().signInLdap!({ body: { email: `grace@${DOMAIN}`, password: "grace-secret" } })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
