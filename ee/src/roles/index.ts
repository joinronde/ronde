// SPDX-License-Identifier: LicenseRef-Ronde-EE
// Custom roles: permissions of the workspace's own, added to the built-in role of the members holding one.

import { CUSTOM_ROLE_PERMISSIONS } from "@ronde/core/permissions";
import type { ScopedClient, ScopedTx } from "@ronde/db";
import type { EnterpriseEdition } from "@ronde/editions/ee";
import { OpError } from "@ronde/module-sdk";

type Db = ScopedClient | ScopedTx;

async function list(db: Db) {
  const roles = await db.customRole.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { members: true } } } });
  return roles.map((r) => ({ id: r.id, name: r.name, description: r.description, permissions: r.permissions, members: r._count.members }));
}

async function save(db: Db, workspaceId: string, input: { id?: string; name: string; description: string; permissions: string[] }) {
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new OpError("nameRequired");
  const unknown = input.permissions.filter((p) => !(CUSTOM_ROLE_PERMISSIONS as readonly string[]).includes(p));
  if (unknown.length) throw new OpError("invalidRequest", { details: `permissions: ${unknown.join(", ")}` });
  const permissions = [...new Set(input.permissions)];
  const taken = await db.customRole.findFirst({ where: { name, ...(input.id ? { NOT: { id: input.id } } : {}) }, select: { id: true } });
  if (taken) throw new OpError("roleNameTaken");
  const data = { name, description: input.description.trim().slice(0, 300), permissions };
  if (!input.id) return db.customRole.create({ data: { workspaceId, ...data }, select: { id: true } });
  const { count } = await db.customRole.updateMany({ where: { id: input.id }, data });
  if (!count) throw new OpError("notFound");
  return { id: input.id };
}

async function remove(db: Db, id: string) {
  // Members holding it go back to their built-in role alone
  await db.workspaceMember.updateMany({ where: { customRoleId: id }, data: { customRoleId: null } });
  const { count } = await db.customRole.deleteMany({ where: { id } });
  if (!count) throw new OpError("notFound");
}

async function assign(db: Db, personId: string, roleId: string | null) {
  if (roleId && !(await db.customRole.findFirst({ where: { id: roleId }, select: { id: true } }))) throw new OpError("notFound");
  const { count } = await db.workspaceMember.updateMany({
    where: { personId, role: { in: ["organizer", "member", "guest"] } },
    data: { customRoleId: roleId },
  });
  if (!count) throw new OpError("roleNotAssignable");
}

export const roles: EnterpriseEdition["roles"] = { list, save, remove, assign };
