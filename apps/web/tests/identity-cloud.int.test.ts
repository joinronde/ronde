import { prisma } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/scim/v2/[ws]/[[...path]]/route";
import { enterprise } from "@/ee-bridge";
import { companyIdentity, identityHost } from "@/lib/server/identity";
import { newScimToken } from "@/lib/server/scim";
import { workspace } from "./fixtures";

// In the cloud there is no license: each workspace's plan decides. An Enterprise workspace signs its people in
// with its own provider or directory and provisions them with SCIM; a Team workspace next to it cannot.

const run = Date.now().toString(36);
let ent: Awaited<ReturnType<typeof workspace>>;
let team: Awaited<ReturnType<typeof workspace>>;
const DOMAIN = { ent: `ent-${run}.test`, team: `team-${run}.test` };

beforeAll(async () => {
  process.env.RONDE_CLOUD = "1";
  ent = await workspace(`id-ent-${run}`);
  team = await workspace(`id-team-${run}`);
  await prisma.workspace.update({ where: { id: ent.ws.id }, data: { plan: "enterprise" } });
  await prisma.workspace.update({ where: { id: team.ws.id }, data: { plan: "team" } });
  for (const [w, domain] of [
    [ent, DOMAIN.ent],
    [team, DOMAIN.team],
  ] as const) {
    await prisma.workspaceDomain.create({ data: { workspaceId: w.ws.id, domain, token: "t", verifiedAt: new Date() } });
    await prisma.ldapDirectory.create({
      data: { workspaceId: w.ws.id, url: "ldap://127.0.0.1:1", bindDn: "cn=ronde", baseDn: "dc=test", enabled: true },
    });
    await prisma.ssoProvider.create({
      data: { id: `sp-${w.ws.slug}`, providerId: `sp-${w.ws.slug}`, issuer: `https://idp.${domain}`, domain, workspaceId: w.ws.id },
    });
  }
});

afterAll(() => {
  delete process.env.RONDE_CLOUD;
});

const scim = async (token: string, ws: string) =>
  (
    await GET(new Request(`http://localhost:3000/api/scim/v2/${ws}/Users`, { headers: { authorization: `Bearer ${token}` } }), {
      params: Promise.resolve({ ws, path: ["Users"] }),
    })
  ).status;

describe("company sign-in in the cloud", () => {
  it("follows each workspace's plan, never an instance license", async () => {
    for (const feature of ["identity.saml", "identity.ldap", "identity.scim"] as const) {
      expect(await identityHost.allowed(feature, ent.ws.id)).toBe(true);
      expect(await identityHost.allowed(feature, team.ws.id)).toBe(false);
    }
    // A deleted workspace keeps nothing
    const gone = await workspace(`id-gone-${run}`);
    await prisma.workspace.update({ where: { id: gone.ws.id }, data: { plan: "enterprise", deletedAt: new Date() } });
    expect(await identityHost.allowed("identity.saml", gone.ws.id)).toBe(false);
  });

  it("signs in with the Enterprise workspace's provider only", async () => {
    expect(await enterprise.identity.resolveSsoUser(identityHost, `sp-${ent.ws.slug}`, `new@${DOMAIN.ent}`)).toEqual({
      action: "continue",
    });
    expect(await enterprise.identity.resolveSsoUser(identityHost, `sp-${team.ws.slug}`, `new@${DOMAIN.team}`)).toEqual({
      action: "reject",
      code: "SSO_NOT_IN_PLAN",
    });
  });

  it("finds the Enterprise workspace's directory only, and lets its people create their account", async () => {
    expect(await identityHost.ldapDirectoryFor(`ana@${DOMAIN.ent}`)).toMatchObject({ workspaceId: ent.ws.id });
    expect(await identityHost.ldapDirectoryFor(`ben@${DOMAIN.team}`)).toBeNull();
    expect(await companyIdentity(`ana@${DOMAIN.ent}`)).toBe(true);
    expect(await companyIdentity(`ben@${DOMAIN.team}`)).toBe(false);
  });

  it("provisions with SCIM for the Enterprise workspace, refuses the Team one", async () => {
    const tokens = { ent: newScimToken(), team: newScimToken() };
    await prisma.scimToken.create({
      data: { workspaceId: ent.ws.id, name: "Okta", tokenHash: tokens.ent.hash, prefix: tokens.ent.prefix },
    });
    await prisma.scimToken.create({
      data: { workspaceId: team.ws.id, name: "Okta", tokenHash: tokens.team.hash, prefix: tokens.team.prefix },
    });
    expect(await scim(tokens.ent.token, ent.ws.slug)).toBe(200);
    expect(await scim(tokens.team.token, team.ws.slug)).toBe(403);
  });
});
