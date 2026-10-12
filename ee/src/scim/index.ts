// SPDX-License-Identifier: LicenseRef-Ronde-EE
// SCIM 2.0 provisioning (RFC 7643, 7644): the company directory (Okta, Entra ID…) creates people in the
// workspace's directory, keeps their names and address up to date, and removes them. Removing never erases
// their history: they leave the workspace and are marked as deprovisioned.

import type { ScopedClient, ScopedTx } from "@ronde/db";
import type { EnterpriseEdition, ScimRequest, ScimResult } from "@ronde/editions/ee";

type Db = ScopedClient | ScopedTx;

const USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
const ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";
const PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

const error = (status: number, detail: string, scimType?: string): ScimResult => ({
  status,
  body: { schemas: [ERROR], status: String(status), detail, ...(scimType ? { scimType } : {}) },
});

type PersonRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  externalId: string | null;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  member: { status: string } | null;
};

export function toScimUser(p: PersonRow, baseUrl: string) {
  const formatted = `${p.firstName} ${p.lastName}`.trim();
  return {
    schemas: [USER],
    id: p.id,
    ...(p.externalId ? { externalId: p.externalId } : {}),
    userName: p.email,
    name: { givenName: p.firstName, familyName: p.lastName, formatted },
    displayName: formatted || p.email,
    emails: [{ value: p.email, type: "work", primary: true }],
    active: p.active && p.member?.status !== "suspended",
    meta: {
      resourceType: "User",
      created: p.createdAt.toISOString(),
      lastModified: p.updatedAt.toISOString(),
      location: `${baseUrl}/Users/${p.id}`,
    },
  };
}

/** An email address, with nothing that could break out of a line where it is written (calendar files, headers) */
const ADDRESS = /^[^@\s;:,"<>\\\x00-\x1f\x7f]+@[^@\s;:,"<>\\\x00-\x1f\x7f]+$/;

/** Filters the directories send to find someone: userName, externalId or emails.value, with "eq" */
export function parseFilter(filter: string | null): { field: "email" | "externalId"; value: string } | null | "unsupported" {
  if (!filter) return null;
  const m = /^\s*(userName|externalId|emails(?:\.value)?|emails\[type eq "work"\]\.value)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i.exec(filter);
  if (!m) return "unsupported";
  const value = m[2]!.replace(/\\(.)/g, "$1");
  return m[1]!.toLowerCase() === "externalid" ? { field: "externalId", value } : { field: "email", value: value.toLowerCase() };
}

interface Changes {
  email?: string;
  firstName?: string;
  lastName?: string;
  externalId?: string | null;
  active?: boolean;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);
const bool = (v: unknown) => (typeof v === "boolean" ? v : v === "true" ? true : v === "false" ? false : undefined);

/** What a full User resource (POST, PUT) says about the person */
export function fromScimUser(body: unknown): Changes {
  const u = (body ?? {}) as Record<string, unknown>;
  const name = (u.name ?? {}) as Record<string, unknown>;
  const emails = Array.isArray(u.emails) ? (u.emails as Record<string, unknown>[]) : [];
  const email = str(emails.find((e) => e.primary)?.value) ?? str(emails[0]?.value) ?? str(u.userName);
  return {
    email: email?.toLowerCase(),
    firstName: str(name.givenName) ?? str(u.displayName)?.split(/\s+/)[0],
    lastName: str(name.familyName),
    externalId: u.externalId === undefined ? undefined : (str(u.externalId) ?? null),
    active: bool(u.active),
  };
}

/** Applies PATCH operations (Okta and Entra ID shapes): replace/add on a path, or on the resource itself */
export function fromPatch(body: unknown): Changes | null {
  const b = (body ?? {}) as { Operations?: unknown };
  if (!Array.isArray(b.Operations)) return null;
  const out: Changes = {};
  const apply = (path: string, value: unknown) => {
    const p = path.toLowerCase();
    if (p === "active") out.active = bool(value);
    else if (p === "username" || p.startsWith("emails")) out.email = str(value)?.toLowerCase();
    else if (p === "name.givenname") out.firstName = str(value);
    else if (p === "name.familyname") out.lastName = str(value);
    else if (p === "externalid") out.externalId = str(value) ?? null;
    else if (p === "displayname" && out.firstName === undefined) out.firstName = str(value)?.split(/\s+/)[0];
  };
  for (const raw of b.Operations as Record<string, unknown>[]) {
    const op = String(raw.op ?? "").toLowerCase();
    if (op !== "replace" && op !== "add" && op !== "remove") continue;
    const value = op === "remove" ? null : raw.value;
    if (typeof raw.path === "string") apply(raw.path, value);
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) apply(k, v);
  }
  return out;
}

const select = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  externalId: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  member: { select: { status: true } },
} as const;

async function setActive(db: Db, personId: string, active: boolean) {
  await db.person.updateMany({ where: { id: personId }, data: { active } });
  await db.workspaceMember.updateMany({ where: { personId }, data: { status: active ? "active" : "suspended" } });
}

async function users(db: Db, workspaceId: string, req: ScimRequest): Promise<ScimResult> {
  const id = req.path[1];
  const visible = { deprovisionedAt: null };
  if (req.method === "GET" && !id) {
    const filter = parseFilter(req.query.get("filter"));
    if (filter === "unsupported") return error(400, "Only userName, externalId and emails.value with eq are supported", "invalidFilter");
    const where = {
      ...visible,
      ...(filter?.field === "email" ? { email: { equals: filter.value, mode: "insensitive" as const } } : {}),
      ...(filter?.field === "externalId" ? { externalId: filter.value } : {}),
    };
    const start = Math.max(1, Number(req.query.get("startIndex")) || 1);
    const count = Math.min(200, Math.max(0, Number(req.query.get("count") ?? 100) || 0));
    const [total, rows] = await Promise.all([
      db.person.count({ where }),
      db.person.findMany({ where, select, orderBy: { createdAt: "asc" }, skip: start - 1, take: count }),
    ]);
    return {
      status: 200,
      body: {
        schemas: [LIST],
        totalResults: total,
        startIndex: start,
        itemsPerPage: rows.length,
        Resources: rows.map((r) => toScimUser(r, req.baseUrl)),
      },
    };
  }
  if (req.method === "POST" && !id) {
    const c = fromScimUser(req.body);
    if (!c.email || !ADDRESS.test(c.email)) return error(400, "userName or a primary email is required", "invalidValue");
    const existing = await db.person.findFirst({
      where: { email: { equals: c.email, mode: "insensitive" } },
      select: { id: true, deprovisionedAt: true },
    });
    if (existing && !existing.deprovisionedAt) return error(409, "A person with this address already exists", "uniqueness");
    const data = {
      email: c.email,
      firstName: c.firstName || c.email.split("@")[0]!,
      lastName: c.lastName ?? "",
      externalId: c.externalId ?? null,
      active: c.active ?? true,
      deprovisionedAt: null,
    };
    // Someone removed earlier comes back: the same card, history included
    const row = existing
      ? await db.person.update({ where: { id: existing.id }, data, select })
      : await db.person.create({ data: { workspaceId, ...data, color: Math.floor(Math.random() * 6) }, select });
    if (existing) await setActive(db, row.id, data.active);
    return { status: 201, body: toScimUser(row, req.baseUrl), change: { action: "scim.create", personId: row.id, email: row.email } };
  }
  if (!id) return error(405, "Method not allowed");
  const current = await db.person.findFirst({ where: { id, ...visible }, select });
  if (!current) return error(404, "User not found");
  if (req.method === "GET") return { status: 200, body: toScimUser(current, req.baseUrl) };
  if (req.method === "DELETE") {
    await db.workspaceMember.deleteMany({ where: { personId: id } });
    await db.person.update({ where: { id }, data: { active: false, deprovisionedAt: new Date(), externalId: null } });
    return { status: 204, change: { action: "scim.delete", personId: id, email: current.email } };
  }
  const c = req.method === "PATCH" ? fromPatch(req.body) : req.method === "PUT" ? fromScimUser(req.body) : null;
  if (!c) return req.method === "PATCH" ? error(400, `PATCH needs ${PATCH} Operations`, "invalidSyntax") : error(405, "Method not allowed");
  if (c.email !== undefined && !ADDRESS.test(c.email)) return error(400, "userName must be an email address", "invalidValue");
  if (c.email && c.email !== current.email.toLowerCase()) {
    if (await db.person.findFirst({ where: { email: { equals: c.email, mode: "insensitive" }, NOT: { id } }, select: { id: true } }))
      return error(409, "A person with this address already exists", "uniqueness");
  }
  const row = await db.person.update({
    where: { id },
    data: {
      ...(c.email ? { email: c.email } : {}),
      ...(c.firstName ? { firstName: c.firstName } : {}),
      ...(c.lastName !== undefined ? { lastName: c.lastName } : {}),
      ...(c.externalId !== undefined ? { externalId: c.externalId } : {}),
    },
    select,
  });
  if (c.active !== undefined && c.active !== current.active) await setActive(db, id, c.active);
  const fresh = (await db.person.findFirst({ where: { id }, select })) ?? row;
  return {
    status: 200,
    body: toScimUser(fresh, req.baseUrl),
    change: { action: c.active === false ? "scim.deactivate" : "scim.update", personId: id, email: fresh.email },
  };
}

const CONFIG = {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
  patch: { supported: true },
  bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
  filter: { supported: true, maxResults: 200 },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: false },
  authenticationSchemes: [
    { type: "oauthbearertoken", name: "Bearer token", description: "A token created in the workspace's security settings", primary: true },
  ],
};

async function handle(db: Db, workspaceId: string, req: ScimRequest): Promise<ScimResult> {
  const [resource] = req.path;
  if (resource === "Users") return users(db, workspaceId, req);
  if (resource === "ServiceProviderConfig") return { status: 200, body: CONFIG };
  if (resource === "ResourceTypes")
    return {
      status: 200,
      body: {
        schemas: [LIST],
        totalResults: 1,
        Resources: [
          { schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"], id: "User", name: "User", endpoint: "/Users", schema: USER },
        ],
      },
    };
  if (resource === "Schemas") return { status: 200, body: { schemas: [LIST], totalResults: 1, Resources: [{ id: USER, name: "User" }] } };
  // Groups are not provisioned: an empty list keeps directories that ask for them happy
  if (resource === "Groups" && req.method === "GET")
    return { status: 200, body: { schemas: [LIST], totalResults: 0, startIndex: 1, itemsPerPage: 0, Resources: [] } };
  return error(404, "Not found");
}

export const scim: EnterpriseEdition["scim"] = { handle };
