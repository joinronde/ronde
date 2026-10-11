import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { enterprise } from "@/ee-bridge";
import { type Fixture, meeting, workspace } from "./fixtures";

// Custom roles: given to members and guests only, never owner-only permissions, never across workspaces

let f: Fixture;
let other: Fixture;
let guestId: string;

beforeAll(async () => {
  f = await meeting(await workspace("roles"), "Weekly");
  other = await meeting(await workspace("roles-other"), "Other");
  const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `guest-${f.workspaceId}@roles.test`, name: "Gina" } });
  const person = await prisma.person.create({
    data: { workspaceId: f.workspaceId, firstName: "Gina", email: user.email, userId: user.id },
  });
  await prisma.workspaceMember.create({ data: { workspaceId: f.workspaceId, userId: user.id, personId: person.id, role: "guest" } });
  guestId = person.id;
});

describe("custom roles", () => {
  it("are saved with known permissions only, and unique names", async () => {
    const { id } = await enterprise.roles.save(f.ctx.ws.db, f.workspaceId, {
      name: "Auditor",
      description: "",
      permissions: ["history.read", "stats.read", "meeting.read"],
    });
    expect((await enterprise.roles.list(f.ctx.ws.db))[0]).toMatchObject({ id, name: "Auditor", members: 0 });
    await expect(
      enterprise.roles.save(f.ctx.ws.db, f.workspaceId, { name: "Boss", description: "", permissions: ["workspace.billing"] }),
    ).rejects.toMatchObject({ key: "invalidRequest" });
    await expect(
      enterprise.roles.save(f.ctx.ws.db, f.workspaceId, { name: "Auditor", description: "", permissions: [] }),
    ).rejects.toMatchObject({ key: "roleNameTaken" });
  });

  it("are given to members and guests, not to owners", async () => {
    const [role] = await enterprise.roles.list(f.ctx.ws.db);
    await enterprise.roles.assign(f.ctx.ws.db, guestId, role!.id);
    expect((await prisma.workspaceMember.findFirstOrThrow({ where: { personId: guestId } })).customRoleId).toBe(role!.id);
    await expect(enterprise.roles.assign(f.ctx.ws.db, f.ctx.ws.member.personId, role!.id)).rejects.toMatchObject({
      key: "roleNotAssignable",
    });
  });

  it("never reach another workspace", async () => {
    const [role] = await enterprise.roles.list(f.ctx.ws.db);
    await expect(enterprise.roles.assign(other.ctx.ws.db, other.ctx.ws.member.personId, role!.id)).rejects.toMatchObject({
      key: "notFound",
    });
    await expect(enterprise.roles.remove(other.ctx.ws.db, role!.id)).rejects.toMatchObject({ key: "notFound" });
    expect(await enterprise.roles.list(other.ctx.ws.db)).toEqual([]);
  });

  it("hand their members back to their built-in role when deleted", async () => {
    const [role] = await enterprise.roles.list(f.ctx.ws.db);
    await enterprise.roles.remove(f.ctx.ws.db, role!.id);
    expect((await prisma.workspaceMember.findFirstOrThrow({ where: { personId: guestId } })).customRoleId).toBeNull();
  });
});
