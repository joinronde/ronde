import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "@ronde/db";
import { translator } from "@ronde/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "@/lib/server/workspaces";
import { workspace } from "./fixtures";

// Joining a workspace from an invitation, signed in for real: the link opens a seat only for the address it
// was sent to, while it is valid; the onboarding page's list (no link) only for an address that was proven

let request: Record<string, string> = {};
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(request),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
}));

const { env } = await import("@/lib/server/env");
const { acceptInvitationAction } = await import("@/app/(auth)/invite/[token]/actions");
const { joinInvitationAction } = await import("@/app/onboarding/actions");

const t = translator("en", "errors");
const refused = (key: Parameters<typeof t>[0], values?: Record<string, string | number>) => ({ ok: false, error: t(key, values) });

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
beforeEach(async () => {
  w = await workspace(`inv-guard-${run}-${++n}`);
});

const account = (email: string, verified = true) =>
  prisma.user.create({ data: { id: crypto.randomUUID(), email, name: "Lena Fischer", emailVerified: verified } });

/** An invitation to the workspace, and the token of its link */
async function invitation(email: string, data: { expiresAt?: Date; revokedAt?: Date; role?: "member" | "admin" } = {}) {
  const token = randomBytes(32).toString("base64url");
  const row = await prisma.invitation.create({
    data: {
      workspaceId: w.ws.id,
      email,
      role: data.role ?? "member",
      tokenHash: hashToken(token),
      invitedById: w.user.id,
      expiresAt: data.expiresAt ?? new Date(Date.now() + 86_400_000),
      revokedAt: data.revokedAt ?? null,
    },
  });
  return { id: row.id, token };
}
const seatOf = (userId: string) => prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: w.ws.id, userId } } });

describe("an invitation link", () => {
  it("opens a seat, with the role it names, to the account of the address it was sent to", async () => {
    const email = `lena-${run}-${n}@inv.test`;
    const { id, token } = await invitation(email, { role: "admin" });
    const user = await account(email);
    await signIn(user.id);
    expect(await acceptInvitationAction(token)).toEqual({ ok: true, data: { slug: w.ws.slug } });
    expect(await seatOf(user.id)).toMatchObject({ role: "admin", status: "active" });
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id } })).acceptedAt).not.toBeNull();
  });

  it("is refused to an account of another address, which it names", async () => {
    const email = `lena-${run}-${n}@inv.test`;
    const { id, token } = await invitation(email);
    const user = await account(`someone-else-${run}-${n}@inv.test`);
    await signIn(user.id);
    expect(await acceptInvitationAction(token)).toEqual(refused("invitationOtherEmail", { email }));
    expect(await seatOf(user.id)).toBeNull();
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id } })).acceptedAt).toBeNull();
  });

  it("is refused once expired", async () => {
    const email = `lena-${run}-${n}@inv.test`;
    const { token } = await invitation(email, { expiresAt: new Date(Date.now() - 1000) });
    const user = await account(email);
    await signIn(user.id);
    expect(await acceptInvitationAction(token)).toEqual(refused("invitationExpired"));
    expect(await seatOf(user.id)).toBeNull();
  });

  it("is refused once revoked, even before it expires", async () => {
    const email = `lena-${run}-${n}@inv.test`;
    const { token } = await invitation(email, { revokedAt: new Date() });
    const user = await account(email);
    await signIn(user.id);
    expect(await acceptInvitationAction(token)).toEqual(refused("invitationInvalid"));
    expect(await seatOf(user.id)).toBeNull();
  });

  it("opens one seat only: used, it is refused to the next account", async () => {
    const email = `lena-${run}-${n}@inv.test`;
    const { token } = await invitation(email);
    const first = await account(email);
    await signIn(first.id);
    expect(await acceptInvitationAction(token)).toMatchObject({ ok: true });
    // The same address, a second account (another instance of the user table, after a deletion and sign-up)
    await prisma.workspaceMember.deleteMany({ where: { userId: first.id } });
    await prisma.user.delete({ where: { id: first.id } });
    const second = await account(email);
    await signIn(second.id);
    expect(await acceptInvitationAction(token)).toEqual(refused("invitationInvalid"));
    expect(await seatOf(second.id)).toBeNull();
  });

  it("is refused to someone signed out, and an unknown token to anyone", async () => {
    const email = `lena-${run}-${n}@inv.test`;
    const { token } = await invitation(email);
    await signIn(null);
    expect(await acceptInvitationAction(token)).toEqual(refused("signInRequired"));
    const user = await account(email);
    await signIn(user.id);
    expect(await acceptInvitationAction(randomBytes(32).toString("base64url"))).toEqual(refused("invitationInvalid"));
    expect(await seatOf(user.id)).toBeNull();
  });
});

describe("an invitation joined from the onboarding page", () => {
  it("needs a proven address: anyone may sign up with any address", async () => {
    const email = `lena-${run}-${n}@inv.test`;
    const { id } = await invitation(email);
    const user = await account(email, false);
    await signIn(user.id);
    expect(await joinInvitationAction(id)).toEqual(refused("invitationInvalid"));
    expect(await seatOf(user.id)).toBeNull();
    expect((await prisma.invitation.findUniqueOrThrow({ where: { id } })).acceptedAt).toBeNull();
    // Once proven, the same invitation opens the seat
    await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
    expect(await joinInvitationAction(id)).toEqual({ ok: true, data: { slug: w.ws.slug } });
    expect(await seatOf(user.id)).toMatchObject({ role: "member" });
  });

  it("is only one sent to the account's own address", async () => {
    const { id } = await invitation(`lena-${run}-${n}@inv.test`);
    const user = await account(`other-${run}-${n}@inv.test`);
    await signIn(user.id);
    expect(await joinInvitationAction(id)).toEqual(refused("invitationInvalid"));
    expect(await seatOf(user.id)).toBeNull();
  });

  it("is refused once expired or revoked", async () => {
    const email = `lena-${run}-${n}@inv.test`;
    const expired = await invitation(email, { expiresAt: new Date(Date.now() - 1000) });
    const revoked = await invitation(email, { revokedAt: new Date() });
    const user = await account(email);
    await signIn(user.id);
    expect(await joinInvitationAction(expired.id)).toEqual(refused("invitationInvalid"));
    expect(await joinInvitationAction(revoked.id)).toEqual(refused("invitationInvalid"));
    expect(await seatOf(user.id)).toBeNull();
  });

  it("is refused to someone signed out", async () => {
    const { id } = await invitation(`lena-${run}-${n}@inv.test`);
    await signIn(null);
    expect(await joinInvitationAction(id)).toEqual(refused("signInRequired"));
  });
});

describe("an invitation opened by someone already in the workspace", () => {
  it("says who it is for while it waits, so it reaches that person", async () => {
    const { invitationState } = await import("@/lib/server/workspaces");
    const owner = {
      id: w.user.id,
      name: w.user.name,
      email: w.user.email,
      image: null,
      locale: null,
      timezone: null,
      instanceRole: "user" as const,
    };
    const { token } = await invitation(`mia-${run}-${n}@example.com`);
    expect(await invitationState(token, owner)).toMatchObject({ status: "member", forOther: `mia-${run}-${n}@example.com` });
    // Their own invitation: nothing more to say
    const own = await invitation(owner.email);
    expect(await invitationState(own.token, owner)).toMatchObject({ status: "member", forOther: null });
    // Expired: nothing to forward
    const late = await invitation(`late-${run}-${n}@example.com`, { expiresAt: new Date(Date.now() - 1000) });
    expect(await invitationState(late.token, owner)).toMatchObject({ status: "member", forOther: null });
  });
});
