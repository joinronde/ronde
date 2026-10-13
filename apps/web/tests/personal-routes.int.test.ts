import { createHash, createHmac, randomBytes } from "node:crypto";
import type { WorkspaceRole } from "@ronde/core/permissions";
import { prisma } from "@ronde/db";
import { translator } from "@ronde/i18n";
import sharp from "sharp";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type Fixture, meeting, workspace } from "./fixtures";

// Routes about one person or one guest, signed in for real: their photo, their data, the instance's
// administration, and what a guest link or a private project lets through

let request: Record<string, string> = {};
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(request),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
}));

const { env } = await import("@/lib/server/env");
const { AVATAR_MAX_BYTES } = await import("@/lib/server/images");
const avatar = await import("@/app/api/w/[ws]/avatar/[id]/route");
const accountExport = await import("@/app/api/account/export/route");
const accountAvatar = await import("@/app/api/account/avatar/route");
const screenshot = await import("@/app/api/admin/feedback/[id]/screenshot/route");
const admin = await import("@/app/admin/actions");
const guestAvatar = await import("@/app/api/g/[token]/avatar/[id]/route");
const guestLogo = await import("@/app/api/g/[token]/projects/[id]/logo/route");
const projectLogo = await import("@/app/api/w/[ws]/projects/[id]/logo/route");

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

type Route = (req: Request, ctx: { params: Promise<never> }) => Promise<Response>;
/** Calls a route handler as Next does, and reads its status and error message (or body) */
async function call(handler: Route, params: Record<string, string>, init?: RequestInit) {
  const res = await handler(new Request("http://localhost:3000/api/x", init), { params: Promise.resolve(params) as Promise<never> });
  const text = res.status >= 400 ? await res.text() : "";
  return { status: res.status, error: text ? (JSON.parse(text) as { error?: string }).error : undefined, res };
}
const status = async (...args: Parameters<typeof call>) => {
  const { status, error } = await call(...args);
  return error ? { status, error } : { status };
};

const run = Date.now().toString(36);
let n = 0;
let w: Awaited<ReturnType<typeof workspace>>;
let f: Fixture;
let png: Buffer;

async function seat(role: WorkspaceRole, instanceRole: "user" | "admin" = "user") {
  const user = await prisma.user.create({
    data: { id: crypto.randomUUID(), email: `${role}-${run}-${++n}@personal.test`, name: role, instanceRole },
  });
  const person = await prisma.person.create({ data: { workspaceId: w.ws.id, userId: user.id, email: user.email, firstName: role } });
  await prisma.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: user.id, personId: person.id, role } });
  return { userId: user.id, personId: person.id };
}

beforeAll(async () => {
  w = await workspace(`personal-${run}`);
  f = await meeting(w, "Weekly");
  png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#e05" } })
    .png()
    .toBuffer();
});
afterEach(() => vi.unstubAllEnvs());

describe("a person's photo in a workspace", () => {
  const put = (id: string) => status(avatar.PUT, { ws: w.ws.slug, id }, { method: "PUT", body: new Uint8Array(png) });
  const del = (id: string) => status(avatar.DELETE, { ws: w.ws.slug, id }, { method: "DELETE" });

  it("is set and removed by the person themselves", async () => {
    const me = await seat("member");
    await signIn(me.userId);
    expect(await put(me.personId)).toEqual({ status: 200 });
    expect(await prisma.personAvatar.findUnique({ where: { personId: me.personId } })).toMatchObject({ type: "image/webp" });
    expect(await del(me.personId)).toEqual({ status: 200 });
    expect(await prisma.personAvatar.count({ where: { personId: me.personId } })).toBe(0);
  });

  it("of someone else is not touched by a member", async () => {
    const me = await seat("member");
    await prisma.personAvatar.create({
      data: { personId: f.memberId, workspaceId: w.ws.id, data: new Uint8Array(png), type: "image/png" },
    });
    await signIn(me.userId);
    expect(await put(f.memberId)).toEqual({ status: 403, error: t("ownAvatarOnly") });
    expect(await del(f.memberId)).toEqual({ status: 403, error: t("ownAvatarOnly") });
    expect(await prisma.personAvatar.findUniqueOrThrow({ where: { personId: f.memberId } })).toMatchObject({ type: "image/png" });
  });

  it("is only set on someone of the workspace, even by whoever manages its people", async () => {
    const elsewhere = await workspace(`personal-else-${run}`);
    await signIn(w.user.id);
    expect(await put(elsewhere.host.id)).toEqual({ status: 403, error: t("unknownMember") });
    expect(await del(elsewhere.host.id)).toEqual({ status: 403, error: t("unknownMember") });
    expect(await prisma.personAvatar.count({ where: { personId: elsewhere.host.id } })).toBe(0);
    // Their own person in the address, this workspace's slug: not theirs to change
    await signIn(elsewhere.user.id);
    expect(await put(elsewhere.host.id)).toEqual({ status: 403, error: t("accessDenied") });
  });

  it("is refused to a guest of the workspace, even their own", async () => {
    const guest = await seat("guest");
    await signIn(guest.userId);
    expect(await put(guest.personId)).toEqual({ status: 403, error: t("accessDenied") });
  });
});

describe("the account's data export", () => {
  it("answers 401 to someone signed out", async () => {
    await signIn(null);
    const res = await accountExport.GET();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: t("signInRequired") });
  });

  it("holds the caller's account and workspaces, nobody else's", async () => {
    const me = await seat("member");
    const colleague = await seat("member");
    await prisma.person.update({ where: { id: me.personId }, data: { phone: "+33611111111" } });
    await prisma.person.update({ where: { id: colleague.personId }, data: { phone: "+33622222222" } });
    const elsewhere = await workspace(`personal-export-${run}`);
    await signIn(me.userId);
    const res = await accountExport.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    const data = JSON.parse(text) as { account: { email: string }; workspaces: { workspace: { slug: string } }[] };
    expect(data.account.email).toMatch(/^member-.*@personal\.test$/);
    expect(data.account.email).toBe((await prisma.user.findUniqueOrThrow({ where: { id: me.userId } })).email);
    expect(data.workspaces.map((x) => x.workspace.slug)).toEqual([w.ws.slug]);
    expect(text).toContain("+33611111111");
    expect(text).not.toContain("+33622222222");
    expect(text).not.toContain(w.user.email);
    expect(text).not.toContain(elsewhere.ws.slug);
  });
});

describe("the account's photo", () => {
  it("is refused past its size, before anything is drawn", async () => {
    const me = await seat("member");
    await signIn(me.userId);
    const res = await accountAvatar.PUT(
      new Request("http://localhost/api/account/avatar", { method: "PUT", body: new Uint8Array(AVATAR_MAX_BYTES + 1) }),
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: t("avatarTooLarge", { max: AVATAR_MAX_BYTES / 1000 }) });
    expect(await prisma.personAvatar.count({ where: { personId: me.personId } })).toBe(0);
    // Within it, it goes on every card of the account
    const ok = await accountAvatar.PUT(new Request("http://localhost/api/account/avatar", { method: "PUT", body: new Uint8Array(png) }));
    expect(await ok.json()).toEqual({ ok: true, cards: 1 });
  });

  it("answers 401 to someone signed out", async () => {
    await signIn(null);
    const res = await accountAvatar.PUT(new Request("http://localhost/api/account/avatar", { method: "PUT", body: new Uint8Array(png) }));
    expect(res.status).toBe(401);
    expect((await accountAvatar.DELETE()).status).toBe(401);
  });
});

describe("the instance's administration", () => {
  let feedbackId: string;
  beforeAll(async () => {
    const fb = await prisma.feedback.create({ data: { kind: "bug", message: "It broke", userId: w.user.id } });
    await prisma.feedbackImage.create({ data: { feedbackId: fb.id, data: new Uint8Array(png), type: "image/png", width: 4, height: 4 } });
    feedbackId = fb.id;
  });

  it("shows a feedback's screenshot to its administrators only", async () => {
    const user = await seat("owner");
    const root = await seat("member", "admin");
    await signIn(null);
    expect(await status(screenshot.GET, { id: feedbackId })).toEqual({ status: 401, error: t("signInRequired") });
    // A workspace owner is not the instance's administrator
    await signIn(user.userId);
    expect(await status(screenshot.GET, { id: feedbackId })).toEqual({ status: 404 });
    await signIn(root.userId);
    const { res } = await call(screenshot.GET, { id: feedbackId });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true);
    // The cloud's administrators work from its back-office
    vi.stubEnv("RONDE_CLOUD", "1");
    expect(await status(screenshot.GET, { id: feedbackId })).toEqual({ status: 404 });
  });

  it("keeps its settings, license and feedback to its administrators", async () => {
    const user = await seat("owner");
    await signIn(user.userId);
    expect(await admin.saveInstanceSettingsAction({ defaultLocale: "en", signupPolicy: "open", signupDomains: "" })).toEqual(
      refused("accessDenied"),
    );
    expect(await admin.saveLicenseAction("")).toEqual(refused("accessDenied"));
    expect(await admin.feedbackStatusAction(feedbackId, "handled")).toEqual(refused("accessDenied"));
    expect(await prisma.feedback.findUniqueOrThrow({ where: { id: feedbackId } })).toMatchObject({ status: "new", handledBy: null });
    await signIn(null);
    expect(await admin.feedbackStatusAction(feedbackId, "handled")).toEqual(refused("signInRequired"));
  });

  it("is open to an administrator of a self-hosted instance, closed in the cloud", async () => {
    const root = await seat("member", "admin");
    await signIn(root.userId);
    // Past the gate, the input's own checks answer
    expect(await admin.saveInstanceSettingsAction({ defaultLocale: "xx", signupPolicy: "open", signupDomains: "" })).toEqual(
      refused("invalidRequest", { details: "locale" }),
    );
    expect(await admin.saveLicenseAction("not-a-license")).toEqual(refused("licenseFormat"));
    expect(await admin.feedbackStatusAction(feedbackId, "handled")).toEqual({ ok: true, data: null });
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: root.userId } })).email;
    expect(await prisma.feedback.findUniqueOrThrow({ where: { id: feedbackId } })).toMatchObject({ status: "handled", handledBy: email });
    vi.stubEnv("RONDE_CLOUD", "1");
    expect(await admin.feedbackStatusAction(feedbackId, "archived")).toEqual(refused("accessDenied"));
    expect(await admin.saveLicenseAction("not-a-license")).toEqual(refused("accessDenied"));
    expect((await prisma.feedback.findUniqueOrThrow({ where: { id: feedbackId } })).status).toBe("handled");
  });
});

describe("a guest link's images", () => {
  /** A link to the meeting, as a host shares it */
  async function link(meetingId: string, data: { revokedAt?: Date; expiresAt?: Date } = {}) {
    const token = `g_${randomBytes(24).toString("base64url")}`;
    await prisma.guestLink.create({
      data: {
        workspaceId: w.ws.id,
        meetingId,
        label: "Board",
        tokenHash: createHash("sha256").update(token).digest("hex"),
        expiresAt: data.expiresAt ?? new Date(Date.now() + 86_400_000),
        revokedAt: data.revokedAt ?? null,
      },
    });
    return token;
  }
  let outsider: { personId: string };
  let unfollowed: string;
  beforeAll(async () => {
    await prisma.personAvatar.upsert({
      where: { personId: f.hostPersonId },
      create: { personId: f.hostPersonId, workspaceId: w.ws.id, data: new Uint8Array(png), type: "image/png" },
      update: {},
    });
    await prisma.personAvatar.upsert({
      where: { personId: f.memberId },
      create: { personId: f.memberId, workspaceId: w.ws.id, data: new Uint8Array(png), type: "image/png" },
      update: {},
    });
    // Someone of the workspace outside the meeting, with a photo too
    outsider = await seat("member");
    await prisma.personAvatar.create({
      data: { personId: outsider.personId, workspaceId: w.ws.id, data: new Uint8Array(png), type: "image/png" },
    });
    await prisma.projectLogo.create({
      data: { projectId: f.projectId, workspaceId: w.ws.id, data: new Uint8Array(png), type: "image/png" },
    });
    const p = await prisma.project.create({ data: { workspaceId: w.ws.id, slug: `unfollowed-${run}`, name: "Unfollowed" } });
    await prisma.projectLogo.create({ data: { projectId: p.id, workspaceId: w.ws.id, data: new Uint8Array(png), type: "image/png" } });
    unfollowed = p.id;
  });

  it("are the meeting's people only", async () => {
    const token = await link(f.meetingId);
    await signIn(null);
    expect(await status(guestAvatar.GET, { token, id: f.hostPersonId })).toEqual({ status: 200 });
    expect(await status(guestAvatar.GET, { token, id: f.memberId })).toEqual({ status: 200 });
    expect(await status(guestAvatar.GET, { token, id: outsider.personId })).toEqual({ status: 404 });
  });

  it("are the logos of the projects the meeting follows only", async () => {
    const token = await link(f.meetingId);
    await signIn(null);
    expect(await status(guestLogo.GET, { token, id: f.projectId })).toEqual({ status: 200 });
    expect(await status(guestLogo.GET, { token, id: unfollowed })).toEqual({ status: 404 });
  });

  it("of another meeting of the workspace stay out of reach", async () => {
    const otherMeeting = await meeting(w, "Other");
    const token = await link(otherMeeting.meetingId);
    // The host takes part in both; the participant of the first meeting does not take part in this one
    expect(await status(guestAvatar.GET, { token, id: f.hostPersonId })).toEqual({ status: 200 });
    expect(await status(guestAvatar.GET, { token, id: f.memberId })).toEqual({ status: 404 });
    expect(await status(guestLogo.GET, { token, id: f.projectId })).toEqual({ status: 404 });
  });

  it("are refused on a revoked or expired link, or a suspended workspace", async () => {
    const invalid = { status: 403, error: t("guestLinkInvalid") };
    const revoked = await link(f.meetingId, { revokedAt: new Date() });
    const expired = await link(f.meetingId, { expiresAt: new Date(Date.now() - 1000) });
    expect(await status(guestAvatar.GET, { token: revoked, id: f.hostPersonId })).toEqual(invalid);
    expect(await status(guestLogo.GET, { token: expired, id: f.projectId })).toEqual(invalid);
    expect(await status(guestAvatar.GET, { token: "g_not-a-token", id: f.hostPersonId })).toEqual(invalid);
    const token = await link(f.meetingId);
    await prisma.workspace.update({ where: { id: w.ws.id }, data: { suspendedAt: new Date() } });
    try {
      expect(await status(guestAvatar.GET, { token, id: f.hostPersonId })).toEqual(invalid);
    } finally {
      await prisma.workspace.update({ where: { id: w.ws.id }, data: { suspendedAt: null } });
    }
  });
});

describe("a private project's logo", () => {
  let project: string;
  let lead: { userId: string; personId: string };
  beforeAll(async () => {
    lead = await seat("member");
    const p = await prisma.project.create({
      data: { workspaceId: w.ws.id, slug: `private-${run}`, name: "Private", visibility: "members", leadId: lead.personId },
    });
    await prisma.projectLogo.create({ data: { projectId: p.id, workspaceId: w.ws.id, data: new Uint8Array(png), type: "image/png" } });
    project = p.id;
  });
  const get = () => status(projectLogo.GET, { ws: w.ws.slug, id: project });

  it("is shown to its people and to those managing every project", async () => {
    await signIn(lead.userId);
    expect(await get()).toEqual({ status: 200 });
    await signIn(w.user.id);
    expect(await get()).toEqual({ status: 200 });
  });

  it("is hidden from a member outside it, until a meeting of theirs follows the project", async () => {
    const outsider = await seat("member");
    await signIn(outsider.userId);
    expect(await get()).toEqual({ status: 404 });
    // The meeting's screen shows the project at its step: its participants see the logo
    await prisma.meetingParticipant.create({
      data: { workspaceId: w.ws.id, meetingId: f.meetingId, personId: outsider.personId, role: "participant", position: 5 },
    });
    expect(await get()).toEqual({ status: 404 });
    await prisma.meetingProject.create({ data: { workspaceId: w.ws.id, meetingId: f.meetingId, projectId: project } });
    try {
      expect(await get()).toEqual({ status: 200 });
    } finally {
      await prisma.meetingProject.deleteMany({ where: { meetingId: f.meetingId, projectId: project } });
    }
  });

  it("is refused to someone of another workspace, and to someone signed out", async () => {
    const elsewhere = await workspace(`personal-logo-${run}`);
    await signIn(elsewhere.user.id);
    expect(await get()).toEqual({ status: 403, error: t("accessDenied") });
    await signIn(null);
    expect(await get()).toEqual({ status: 401, error: t("signInRequired") });
  });
});
