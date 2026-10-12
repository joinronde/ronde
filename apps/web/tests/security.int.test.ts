import { createHash, randomBytes } from "node:crypto";
import { can, type Permission, type WorkspaceRole } from "@ronde/core/permissions";
import { prisma, scoped } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "@/lib/server/authz";
import { workspace } from "./fixtures";

// What the launch review found and closed: a verified domain cannot be swapped for another one, a custom role
// gives no more than its maker holds, a provider being registered is trusted for single sign-on only, a
// directory cannot remove or rename the workspace's owners.

let current: WorkspaceContext;
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
}));
vi.mock("@/lib/server/authz", async (original) => {
  const real = await original<typeof import("@/lib/server/authz")>();
  return { ...real, authorize: async () => current, requireUser: async () => current.user, currentUser: async () => current.user };
});

const actions = await import("@/app/w/[ws]/actions");
// After the actions (they load the sign-in module, which identity's origins serve)
const { trustedOrigins, withPendingOrigin } = await import("@/lib/server/identity");
const { POST: scimPost, DELETE: scimDelete, PATCH: scimPatch } = await import("@/app/api/scim/v2/[ws]/[[...path]]/route");

const run = Date.now().toString(36);
let w: Awaited<ReturnType<typeof workspace>>;
const as = (role: WorkspaceRole, personId = w.host.id): WorkspaceContext => {
  const principal = { userId: w.user.id, personId, workspaceId: w.ws.id, workspaceRole: role };
  return {
    user: { id: w.user.id, name: w.user.name, email: w.user.email, image: null, locale: null, timezone: null, instanceRole: "user" },
    workspace: { id: w.ws.id, slug: w.ws.slug, name: w.ws.name, locale: "en", timezone: "UTC", plan: "enterprise", settings: {} },
    member: { id: w.member.id, personId, role },
    principal,
    db: scoped(prisma, w.ws.id),
    can: (p: Permission) => can(principal, p),
  };
};

beforeAll(async () => {
  vi.stubEnv("RONDE_CLOUD", "1");
  w = await workspace(`sec-${run}`);
  await prisma.workspace.update({ where: { id: w.ws.id }, data: { plan: "enterprise" } });
});
afterAll(() => vi.unstubAllEnvs());

describe("a verified domain", () => {
  it("keeps its name: only its two switches change, whatever the browser sends", async () => {
    current = as("owner");
    const d = await prisma.workspaceDomain.create({
      data: { workspaceId: w.ws.id, domain: `own-${run}.test`, token: "t", verifiedAt: new Date() },
    });
    const res = await actions.updateDomainAction(w.ws.slug, d.id, { capture: true, domain: `victim-${run}.test` } as { capture: boolean });
    expect(res).toMatchObject({ ok: true });
    expect(await prisma.workspaceDomain.findUniqueOrThrow({ where: { id: d.id } })).toMatchObject({
      domain: `own-${run}.test`,
      capture: true,
    });
  });
});

describe("custom roles", () => {
  it("give no permission their maker lacks, and are not given to oneself", async () => {
    // Someone managing members through a custom role, not an administrator
    const person = await prisma.person.create({ data: { workspaceId: w.ws.id, email: `pm-${run}@sec.test`, firstName: "Pat" } });
    const role = await prisma.customRole.create({
      data: { workspaceId: w.ws.id, name: `People ${run}`, permissions: ["members.manage", "people.read"] },
    });
    current = {
      ...as("member", person.id),
      can: (p: Permission) => p === "members.manage" || p === "people.read" || can(as("member", person.id).principal, p),
    };
    const saved = await actions.saveRoleAction(w.ws.slug, { name: "Boss", description: "", permissions: ["workspace.manage"] });
    expect(saved).toMatchObject({ ok: false });
    expect(await prisma.customRole.count({ where: { workspaceId: w.ws.id, name: "Boss" } })).toBe(0);
    expect(await actions.assignRoleAction(w.ws.slug, person.id, role.id)).toMatchObject({ ok: false });
    // Their own role cannot be widened either
    const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: person.email, name: "Pat" } });
    await prisma.workspaceMember.create({
      data: { workspaceId: w.ws.id, userId: user.id, personId: person.id, role: "member", customRoleId: role.id },
    });
    expect(
      await actions.saveRoleAction(w.ws.slug, {
        id: role.id,
        name: role.name,
        description: "",
        permissions: ["members.manage", "people.read", "people.manage"],
      }),
    ).toMatchObject({ ok: false });
  });
});

describe("an identity provider being registered", () => {
  it("is trusted on the single sign-on paths only, never for a reset link's way back", async () => {
    const at = (path: string) => trustedOrigins(new Request(`http://localhost:3000/api/auth${path}`));
    await withPendingOrigin("https://idp-pending.example/.well-known/openid-configuration", async () => {
      expect(await at("/request-password-reset")).not.toContain("https://idp-pending.example");
      expect(await at("/reset-password/abc")).not.toContain("https://idp-pending.example");
      expect(await at("/sso/register")).toContain("https://idp-pending.example");
    });
  });

  it("must be reached over https at a public address", async () => {
    current = as("owner");
    await prisma.workspaceDomain.create({ data: { workspaceId: w.ws.id, domain: `idp-${run}.test`, token: "t", verifiedAt: new Date() } });
    for (const issuer of ["http://idp.example.com", "https://127.0.0.1", "https://localhost:8443"]) {
      const res = await actions.addSsoProviderAction(w.ws.slug, {
        name: "IdP",
        domains: [`idp-${run}.test`],
        oidc: { issuer, discoveryUrl: "", clientId: "x", clientSecret: "y" },
      } as Parameters<typeof actions.addSsoProviderAction>[1]);
      expect(res).toMatchObject({ ok: false });
    }
  });
});

describe("SCIM", () => {
  it("cannot remove, suspend or rename the workspace's owners, nor change the address someone signs in with", async () => {
    const token = `ronde_scim_${randomBytes(16).toString("hex")}`;
    await prisma.scimToken.create({
      data: { workspaceId: w.ws.id, name: "Okta", tokenHash: createHash("sha256").update(token).digest("hex"), prefix: token.slice(0, 12) },
    });
    const call = async (fn: typeof scimPost, path: string[], method: string, body?: object) => {
      const res = await fn(
        new Request(`http://localhost/api/scim/v2/${w.ws.slug}/${path.join("/")}`, {
          method,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/scim+json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        { params: Promise.resolve({ ws: w.ws.slug, path }) },
      );
      return res.status;
    };
    const replace = (path: string, value: unknown) => ({ Operations: [{ op: "replace", path, value }] });
    expect(await call(scimDelete, ["Users", w.host.id], "DELETE")).toBe(403);
    expect(await call(scimPatch, ["Users", w.host.id], "PATCH", replace("active", false))).toBe(403);
    expect(await call(scimPatch, ["Users", w.host.id], "PATCH", replace("userName", `other-${run}@sec.test`))).toBe(409);
    const owner = await prisma.person.findUniqueOrThrow({ where: { id: w.host.id }, include: { member: true } });
    expect([owner.active, owner.email, owner.member?.role]).toEqual([true, w.user.email, "owner"]);
  });
});
