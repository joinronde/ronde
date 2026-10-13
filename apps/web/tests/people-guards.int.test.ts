import { createHmac } from "node:crypto";
import type { WorkspaceRole } from "@ronde/core/permissions";
import { prisma } from "@ronde/db";
import { translator } from "@ronde/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { workspace } from "./fixtures";

// The directory and its roles, through the real server actions and a real session: nobody acts on a role
// above their own, a workspace never loses its last owner, a profile is edited by its person or a manager

let request: Record<string, string> = {};
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(request),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
}));

const { env } = await import("@/lib/server/env");
const actions = await import("@/app/w/[ws]/actions");

const t = translator("en", "errors");
const refused = (key: Parameters<typeof t>[0], values?: Record<string, string | number>) => ({ ok: false, error: t(key, values) });
const done = { ok: true, data: null };

/** Opens a real session for the user: the row Better Auth reads, and the cookie it signs */
async function signIn(userId: string | null) {
  request = { "accept-language": "en" };
  if (!userId) return;
  const token = crypto.randomUUID().replaceAll("-", "");
  await prisma.authSession.create({ data: { id: crypto.randomUUID(), token, userId, expiresAt: new Date(Date.now() + 86_400_000) } });
  const signature = createHmac("sha256", env.authSecret()).update(token).digest("base64");
  request.cookie = `ronde.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

const run = Date.now().toString(36);
let n = 0;
let w: Awaited<ReturnType<typeof workspace>>;
let slug: string;

/** Someone with an account and a seat of this role in the workspace */
async function seat(role: WorkspaceRole, status: "active" | "suspended" = "active") {
  const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `${role}-${run}-${++n}@people.test`, name: role } });
  const person = await prisma.person.create({ data: { workspaceId: w.ws.id, userId: user.id, email: user.email, firstName: role } });
  await prisma.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: user.id, personId: person.id, role, status } });
  return { userId: user.id, personId: person.id };
}
const roleOf = async (personId: string) => (await prisma.workspaceMember.findUnique({ where: { personId } }))?.role ?? null;

beforeEach(async () => {
  w = await workspace(`people-${run}-${++n}`);
  slug = w.ws.slug;
});

describe("changing a role", () => {
  it("is refused to whoever does not manage members", async () => {
    const organizer = await seat("organizer");
    const member = await seat("member");
    await signIn(organizer.userId);
    expect(await actions.changeRoleAction(slug, member.personId, "admin")).toEqual(refused("accessDenied"));
    expect(await roleOf(member.personId)).toBe("member");
  });

  it("never reaches a role above the administrator's own, nor hands one out", async () => {
    const admin = await seat("admin");
    const member = await seat("member");
    await signIn(admin.userId);
    expect(await actions.changeRoleAction(slug, member.personId, "owner")).toEqual(refused("roleNotAssignable"));
    expect(await actions.changeRoleAction(slug, w.host.id, "member")).toEqual(refused("roleNotAssignable"));
    expect(await roleOf(member.personId)).toBe("member");
    expect(await roleOf(w.host.id)).toBe("owner");
    // Within their reach, it goes through
    expect(await actions.changeRoleAction(slug, member.personId, "organizer")).toEqual(done);
    expect(await roleOf(member.personId)).toBe("organizer");
  });

  it("does not hand out the billing role where the workspace pays for nothing (self-hosted)", async () => {
    const member = await seat("member");
    await signIn(w.user.id);
    expect(await actions.changeRoleAction(slug, member.personId, "billing")).toEqual(refused("roleNotAssignable"));
  });

  it("leaves the workspace at least one owner", async () => {
    await signIn(w.user.id);
    expect(await actions.changeRoleAction(slug, w.host.id, "admin")).toEqual(refused("lastOwner"));
    // An owner whose seat is suspended does not count
    await seat("owner", "suspended");
    expect(await actions.changeRoleAction(slug, w.host.id, "admin")).toEqual(refused("lastOwner"));
    expect(await roleOf(w.host.id)).toBe("owner");
    // With a second active owner, one may step down
    await seat("owner");
    expect(await actions.changeRoleAction(slug, w.host.id, "admin")).toEqual(done);
    expect(await roleOf(w.host.id)).toBe("admin");
  });

  it("is about someone of this workspace", async () => {
    const elsewhere = await workspace(`people-else-${run}-${++n}`);
    await signIn(w.user.id);
    expect(await actions.changeRoleAction(slug, elsewhere.host.id, "member")).toEqual(refused("notFound"));
    expect(await roleOf(elsewhere.host.id)).toBe("owner");
  });
});

describe("removing a person", () => {
  it("is refused to a member", async () => {
    const member = await seat("member");
    const target = await seat("member");
    await signIn(member.userId);
    expect(await actions.removePersonAction(slug, target.personId)).toEqual(refused("accessDenied"));
    expect(await roleOf(target.personId)).toBe("member");
  });

  it("never removes someone above the administrator's role", async () => {
    const admin = await seat("admin");
    await signIn(admin.userId);
    expect(await actions.removePersonAction(slug, w.host.id)).toEqual(refused("roleNotAssignable"));
    expect(await roleOf(w.host.id)).toBe("owner");
  });

  it("never removes the last owner", async () => {
    await signIn(w.user.id);
    expect(await actions.removePersonAction(slug, w.host.id)).toEqual(refused("lastOwner"));
    expect(await roleOf(w.host.id)).toBe("owner");
  });

  it("erases a member's profile and seat when an administrator does it", async () => {
    const admin = await seat("admin");
    const target = await seat("member");
    await signIn(admin.userId);
    expect(await actions.removePersonAction(slug, target.personId)).toEqual(done);
    expect(await roleOf(target.personId)).toBeNull();
    expect(await prisma.person.findUniqueOrThrow({ where: { id: target.personId } })).toMatchObject({ userId: null, active: false });
  });
});

describe("leaving a workspace", () => {
  it("is refused to its last owner, a suspended co-owner not counting", async () => {
    await seat("owner", "suspended");
    await signIn(w.user.id);
    expect(await actions.leaveWorkspaceAction(slug)).toEqual(refused("lastOwner"));
    expect(await roleOf(w.host.id)).toBe("owner");
  });

  it("lets an owner go when another one stays, the profile kept inactive", async () => {
    await seat("owner");
    await signIn(w.user.id);
    expect(await actions.leaveWorkspaceAction(slug)).toEqual(done);
    expect(await roleOf(w.host.id)).toBeNull();
    expect(await prisma.person.findUniqueOrThrow({ where: { id: w.host.id } })).toMatchObject({ userId: null, active: false });
    // Gone: the workspace refuses them now
    expect(await actions.leaveWorkspaceAction(slug)).toEqual(refused("accessDenied"));
  });

  it("is open to a member", async () => {
    const member = await seat("member");
    await signIn(member.userId);
    expect(await actions.leaveWorkspaceAction(slug)).toEqual(done);
    expect(await roleOf(member.personId)).toBeNull();
  });
});

describe("editing a profile", () => {
  it("is open to the person themselves, their address tied to their account", async () => {
    const member = await seat("member");
    await signIn(member.userId);
    const email = (await prisma.person.findUniqueOrThrow({ where: { id: member.personId } })).email;
    expect(await actions.updatePersonAction(slug, member.personId, { firstName: "Lucia", email: "changed@people.test" })).toEqual(done);
    expect(await prisma.person.findUniqueOrThrow({ where: { id: member.personId } })).toMatchObject({ firstName: "Lucia", email });
  });

  it("of someone else is refused without the right to manage people", async () => {
    const member = await seat("member");
    const organizer = await seat("organizer");
    await signIn(member.userId);
    expect(await actions.updatePersonAction(slug, w.host.id, { firstName: "Hacked", email: w.user.email })).toEqual(
      refused("accessDenied"),
    );
    // Inviting people is not managing them
    await signIn(organizer.userId);
    expect(await actions.updatePersonAction(slug, w.host.id, { firstName: "Hacked", email: w.user.email })).toEqual(
      refused("accessDenied"),
    );
    expect((await prisma.person.findUniqueOrThrow({ where: { id: w.host.id } })).firstName).toBe("Host");
  });

  it("is refused to a guest, who does not read the directory, even their own", async () => {
    const guest = await seat("guest");
    await signIn(guest.userId);
    expect(await actions.updatePersonAction(slug, guest.personId, { firstName: "Gus", email: "x@people.test" })).toEqual(
      refused("accessDenied"),
    );
  });

  it("of someone else is open to an administrator", async () => {
    const admin = await seat("admin");
    const target = await prisma.person.create({ data: { workspaceId: w.ws.id, email: `card-${run}@people.test`, firstName: "Card" } });
    await signIn(admin.userId);
    expect(await actions.updatePersonAction(slug, target.id, { firstName: "Carla", email: `carla-${run}@people.test` })).toEqual(done);
    expect(await prisma.person.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({
      firstName: "Carla",
      email: `carla-${run}@people.test`,
    });
  });
});

describe("adding a person", () => {
  it("is refused to a member, done by an administrator, once per address", async () => {
    const member = await seat("member");
    const admin = await seat("admin");
    const input = { firstName: "Amara", email: `amara-${run}-${n}@people.test` };
    await signIn(member.userId);
    expect(await actions.addPersonAction(slug, input)).toEqual(refused("accessDenied"));
    expect(await prisma.person.count({ where: { workspaceId: w.ws.id, email: input.email } })).toBe(0);
    await signIn(admin.userId);
    expect(await actions.addPersonAction(slug, input)).toEqual(done);
    expect(await actions.addPersonAction(slug, { ...input, email: input.email.toUpperCase() })).toEqual(refused("personExists"));
    expect(await prisma.person.count({ where: { workspaceId: w.ws.id, email: input.email } })).toBe(1);
  });
});

describe("revoking an invitation", () => {
  const invitation = async (workspaceId: string) =>
    prisma.invitation.create({
      data: {
        workspaceId,
        email: `invited-${run}-${++n}@people.test`,
        tokenHash: crypto.randomUUID(),
        invitedById: w.user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

  it("is refused to a member", async () => {
    const member = await seat("member");
    const i = await invitation(w.ws.id);
    await signIn(member.userId);
    expect(await actions.revokeInvitationAction(slug, i.id)).toEqual(refused("accessDenied"));
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: i.id } })).revokedAt).toBeNull();
  });

  it("works once, and only on the workspace's own invitations", async () => {
    const elsewhere = await workspace(`people-inv-${run}-${++n}`);
    const own = await invitation(w.ws.id);
    const theirs = await invitation(elsewhere.ws.id);
    await signIn(w.user.id);
    expect(await actions.revokeInvitationAction(slug, own.id)).toEqual(done);
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: own.id } })).revokedAt).not.toBeNull();
    expect(await actions.revokeInvitationAction(slug, own.id)).toEqual(refused("notFound"));
    expect(await actions.revokeInvitationAction(slug, theirs.id)).toEqual(refused("notFound"));
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id: theirs.id } })).revokedAt).toBeNull();
  });
});

describe("job categories", () => {
  it("are added, renamed and deleted by an administrator", async () => {
    const admin = await seat("admin");
    await signIn(admin.userId);
    expect(await actions.addJobCategoryAction(slug, "  Design  ")).toEqual(done);
    const category = await prisma.jobCategory.findFirstOrThrow({ where: { workspaceId: w.ws.id } });
    expect(category.name).toBe("Design");
    expect(await actions.renameJobCategoryAction(slug, category.id, "Product design")).toEqual(done);
    expect((await prisma.jobCategory.findUniqueOrThrow({ where: { id: category.id } })).name).toBe("Product design");
    expect(await actions.deleteJobCategoryAction(slug, category.id)).toEqual(done);
    expect(await prisma.jobCategory.count({ where: { workspaceId: w.ws.id } })).toBe(0);
  });

  it("keep their names unique and never empty", async () => {
    await signIn(w.user.id);
    expect(await actions.addJobCategoryAction(slug, "Sales")).toEqual(done);
    expect(await actions.addJobCategoryAction(slug, "Marketing")).toEqual(done);
    const marketing = await prisma.jobCategory.findFirstOrThrow({ where: { workspaceId: w.ws.id, name: "Marketing" } });
    expect(await actions.addJobCategoryAction(slug, "Sales")).toEqual(refused("categoryExists"));
    expect(await actions.addJobCategoryAction(slug, "   ")).toEqual(refused("nameRequired"));
    expect(await actions.renameJobCategoryAction(slug, marketing.id, "Sales")).toEqual(refused("categoryExists"));
    expect(await actions.renameJobCategoryAction(slug, marketing.id, "")).toEqual(refused("nameRequired"));
    expect((await prisma.jobCategory.findUniqueOrThrow({ where: { id: marketing.id } })).name).toBe("Marketing");
  });

  it("are left alone by members and by other workspaces", async () => {
    const member = await seat("member");
    const category = await prisma.jobCategory.create({ data: { workspaceId: w.ws.id, name: "Support" } });
    await signIn(member.userId);
    expect(await actions.addJobCategoryAction(slug, "Mine")).toEqual(refused("accessDenied"));
    expect(await actions.renameJobCategoryAction(slug, category.id, "Mine")).toEqual(refused("accessDenied"));
    expect(await actions.deleteJobCategoryAction(slug, category.id)).toEqual(refused("accessDenied"));
    // An owner elsewhere, naming this workspace's category from their own
    const elsewhere = await workspace(`people-cat-${run}-${++n}`);
    await signIn(elsewhere.user.id);
    expect(await actions.renameJobCategoryAction(elsewhere.ws.slug, category.id, "Mine")).toEqual(refused("notFound"));
    expect(await actions.deleteJobCategoryAction(elsewhere.ws.slug, category.id)).toEqual(refused("notFound"));
    expect(await prisma.jobCategory.findUniqueOrThrow({ where: { id: category.id } })).toMatchObject({ name: "Support" });
  });
});
