import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { can, type Principal } from "@ronde/core/permissions";
import { prisma, scoped } from "@ronde/db";
import { BASE_PATH } from "../shared/base-path";
import type { WorkspaceContext, WorkspaceSettings } from "./authz";
import { AccessError, OpError } from "./errors";
import { loadLicense } from "./license";
import type { MeetingCtx } from "./meeting/context";

// Guest links: someone without an account follows a meeting's shared screen, read-only, until the link
// expires or a host revokes it. The link itself is never stored, only its hash.

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const TOKEN = /^g_[A-Za-z0-9_-]{32}$/;
const DAY = 86_400_000;

export interface GuestLinkView {
  id: string;
  label: string;
  expiresAt: number;
  expired: boolean;
  createdAt: number;
}

export async function listGuestLinks(db: WorkspaceContext["db"], meetingId: string): Promise<GuestLinkView[]> {
  const rows = await db.guestLink.findMany({ where: { meetingId, revokedAt: null }, orderBy: { createdAt: "desc" } });
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    expiresAt: r.expiresAt.getTime(),
    expired: r.expiresAt.getTime() < now,
    createdAt: r.createdAt.getTime(),
  }));
}

/** A new link for a meeting: the token is returned once, to be shared */
export async function createGuestLink(
  ctx: MeetingCtx,
  input: { label: string; days: number },
): Promise<{ id: string; url: string; expiresAt: number }> {
  const label = input.label.trim().slice(0, 80);
  if (!label) throw new OpError("nameRequired");
  const days = Math.round(input.days);
  if (!(days >= 1 && days <= 90)) throw new OpError("invalidRequest", { details: "days" });
  const token = `g_${randomBytes(24).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + days * DAY);
  const row = await ctx.ws.db.guestLink.create({
    data: {
      workspaceId: ctx.ws.workspace.id,
      meetingId: ctx.meeting.id,
      tokenHash: hash(token),
      label,
      expiresAt,
      createdById: ctx.ws.user.id,
    },
  });
  return { id: row.id, url: `/g/${token}`, expiresAt: expiresAt.getTime() };
}

export async function revokeGuestLink(ctx: MeetingCtx, id: string) {
  const { count } = await ctx.ws.db.guestLink.updateMany({
    where: { id, meetingId: ctx.meeting.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!count) throw new OpError("notFound");
}

/**
 * The meeting as a guest sees it: an observer without an account, who may only read what the shared
 * screen shows. Null for an unknown, revoked or expired link.
 */
export async function guestContext(token: string): Promise<MeetingCtx | null> {
  if (!TOKEN.test(token)) return null;
  const link = await prisma.guestLink.findUnique({ where: { tokenHash: hash(token) } });
  if (!link || link.revokedAt || link.expiresAt.getTime() < Date.now()) return null;
  await loadLicense();
  const workspace = await prisma.workspace.findFirst({
    where: { id: link.workspaceId, deletedAt: null, suspendedAt: null },
    select: { id: true, slug: true, name: true, locale: true, timezone: true, plan: true, settings: true },
  });
  if (!workspace) return null;
  const db = scoped(prisma, workspace.id);
  const meeting = await db.meeting.findFirst({ where: { id: link.meetingId, archivedAt: null } });
  if (!meeting) return null;
  const settings = (workspace.settings ?? {}) as WorkspaceSettings;
  const principal: Principal = { userId: "", personId: "", workspaceId: workspace.id, workspaceRole: "guest", meetingRole: "observer" };
  const allowed = (p: Parameters<typeof can>[1]) => can(principal, p, settings);
  const ws: WorkspaceContext = {
    user: { id: `guest:${link.id}`, name: link.label, email: "", image: null, locale: null, timezone: null, instanceRole: "user" },
    workspace: { ...workspace, settings },
    member: { id: "", personId: "", role: "guest" },
    principal,
    db,
    can: allowed,
  };
  const api = `${BASE_PATH}/api/g/${token}`;
  return {
    ws,
    workspace: ws.workspace,
    meeting,
    role: "observer",
    viewer: { userId: ws.user.id, personId: "", email: "", name: link.label, memberId: null, isHost: false, isAdmin: false },
    links: {
      workspace: { slug: workspace.slug, name: workspace.name },
      meetingId: meeting.id,
      path: `/g/${token}`,
      api,
      workspaceApi: api,
    },
    can: allowed,
  };
}

/** For the guest API routes: the context, or 404 */
export async function requireGuest(token: string): Promise<MeetingCtx> {
  const ctx = await guestContext(token);
  if (!ctx) throw new AccessError(403, "guestLinkInvalid");
  return ctx;
}
