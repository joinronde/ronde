import { generateKeyPairSync, sign } from "node:crypto";
import { prisma } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DELETE, GET, PATCH, POST, PUT } from "@/app/api/scim/v2/[ws]/[[...path]]/route";
import { joinWorkspace } from "@/lib/server/identity";
import { saveLicense } from "@/lib/server/license";
import { newScimToken } from "@/lib/server/scim";
import { workspace } from "./fixtures";

// SCIM provisioning, as Okta or Entra ID would call it: create, find, update, deactivate, remove

process.env.APP_URL = "http://localhost:3000";
const pair = generateKeyPairSync("ed25519");
process.env.RONDE_LICENSE_TEST_KEYS = JSON.stringify({ "test-scim": pair.publicKey.export({ format: "jwk" }).x });
const body = Buffer.from(
  JSON.stringify({
    kid: "test-scim",
    id: "lic_c",
    customer: "Acme",
    edition: "enterprise",
    seats: 0,
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
  }),
).toString("base64url");
const KEY = `ronde_lic_v1.${body}.${sign(null, Buffer.from(`ronde_lic_v1.${body}`), pair.privateKey).toString("base64url")}`;

let w: Awaited<ReturnType<typeof workspace>>;
let token: string;
let other: string;

type Handler = (req: Request, ctx: { params: Promise<{ ws: string; path?: string[] }> }) => Promise<Response>;
async function call(
  handler: Handler,
  path: string[],
  init: { method?: string; body?: unknown; query?: string; token?: string; ws?: string } = {},
) {
  const ws = init.ws ?? w.ws.slug;
  const req = new Request(`http://localhost:3000/api/scim/v2/${ws}/${path.join("/")}${init.query ? `?${init.query}` : ""}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: { authorization: `Bearer ${init.token ?? token}`, "content-type": "application/scim+json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const res = await handler(req, { params: Promise.resolve({ ws, path }) });
  return { status: res.status, json: res.status === 204 ? null : ((await res.json()) as Record<string, unknown>) };
}

beforeAll(async () => {
  w = await workspace(`scim-${Date.now().toString(36)}`);
  const t = newScimToken();
  await prisma.scimToken.create({ data: { workspaceId: w.ws.id, name: "Okta", tokenHash: t.hash, prefix: t.prefix } });
  token = t.token;
  const o = await workspace(`scim-other-${Date.now().toString(36)}`);
  const ot = newScimToken();
  await prisma.scimToken.create({ data: { workspaceId: o.ws.id, name: "Other", tokenHash: ot.hash, prefix: ot.prefix } });
  other = ot.token;
  await saveLicense(KEY);
});

afterAll(async () => {
  await saveLicense("");
});

describe("SCIM provisioning", () => {
  let id: string;

  it("refuses a missing, wrong or other workspace's token", async () => {
    expect((await call(GET, ["Users"], { token: "nope" })).status).toBe(401);
    expect((await call(GET, ["Users"], { token: other })).status).toBe(401);
  });

  it("creates a person, then finds them by userName and externalId", async () => {
    const created = await call(POST, ["Users"], {
      body: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        userName: "Grace@Acme.test",
        externalId: "00u1",
        name: { givenName: "Grace", familyName: "Hopper" },
        active: true,
      },
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ userName: "grace@acme.test", externalId: "00u1", active: true, name: { givenName: "Grace" } });
    id = created.json!.id as string;
    expect((await call(POST, ["Users"], { body: { userName: "grace@acme.test" } })).status).toBe(409);
    const found = await call(GET, ["Users"], { query: `filter=${encodeURIComponent('userName eq "GRACE@acme.test"')}` });
    expect(found.json).toMatchObject({ totalResults: 1, Resources: [{ id }] });
    expect((await call(GET, ["Users"], { query: `filter=${encodeURIComponent('externalId eq "00u1"')}` })).json).toMatchObject({
      totalResults: 1,
    });
    expect((await call(GET, ["Users"], { query: `filter=${encodeURIComponent('displayName co "x"')}` })).status).toBe(400);
  });

  it("updates names with PATCH (Okta and Entra ID shapes) and PUT", async () => {
    await call(PATCH, ["Users", id], {
      method: "PATCH",
      body: { Operations: [{ op: "replace", value: { "name.familyName": "Murray Hopper" } }] },
    });
    await call(PATCH, ["Users", id], {
      method: "PATCH",
      body: { Operations: [{ op: "Replace", path: "name.givenName", value: "Amazing Grace" }] },
    });
    expect((await call(GET, ["Users", id])).json).toMatchObject({ name: { givenName: "Amazing Grace", familyName: "Murray Hopper" } });
    const put = await call(PUT, ["Users", id], {
      method: "PUT",
      body: { userName: "grace@acme.test", name: { givenName: "Grace", familyName: "Hopper" }, active: true },
    });
    expect(put.json).toMatchObject({ name: { givenName: "Grace", familyName: "Hopper" } });
  });

  it("deactivates the member, and removing them keeps their history but stops their way back", async () => {
    const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: "grace@acme.test", name: "Grace Hopper" } });
    await joinWorkspace(user, w.ws.id, "members.sso");
    await call(PATCH, ["Users", id], { method: "PATCH", body: { Operations: [{ op: "replace", path: "active", value: false }] } });
    expect(await prisma.workspaceMember.findFirst({ where: { personId: id } })).toMatchObject({ status: "suspended" });
    expect((await call(GET, ["Users", id])).json).toMatchObject({ active: false });
    expect((await call(DELETE, ["Users", id], { method: "DELETE" })).status).toBe(204);
    expect((await call(GET, ["Users", id])).status).toBe(404);
    expect(await prisma.person.findUnique({ where: { id } })).toMatchObject({ active: false });
    expect(await prisma.workspaceMember.count({ where: { personId: id } })).toBe(0);
    // Signing in again through the company's provider does not bring them back
    await joinWorkspace(user, w.ws.id, "members.sso");
    expect(await prisma.workspaceMember.count({ where: { workspaceId: w.ws.id, userId: user.id } })).toBe(0);
    // Each change is in the audit log
    const actions = (await prisma.auditLog.findMany({ where: { workspaceId: w.ws.id }, orderBy: { id: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["scim.create", "scim.update", "scim.deactivate", "scim.delete"]));
  });

  it("answers the discovery endpoints, and nothing without the license", async () => {
    expect((await call(GET, ["ServiceProviderConfig"])).json).toMatchObject({ patch: { supported: true } });
    expect((await call(GET, ["Groups"])).json).toMatchObject({ totalResults: 0 });
    await saveLicense("");
    expect((await call(GET, ["Users"])).status).toBe(403);
  });
});
