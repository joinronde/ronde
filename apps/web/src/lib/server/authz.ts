import "server-only";
import {
  CUSTOM_ROLE_PERMISSIONS,
  can,
  type MeetingRole,
  type Permission,
  type Principal,
  type WorkspaceRole,
} from "@ronde/core/permissions";
import { prisma, scoped } from "@ronde/db";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { auth, signupAllowed } from "./auth";
import { env } from "./env";
import { AccessError } from "./errors";
import { featureOn, loadLicense } from "./license";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  locale: string | null;
  timezone: string | null;
  instanceRole: "user" | "admin";
}

const select = { id: true, name: true, email: true, image: true, locale: true, timezone: true, instanceRole: true } as const;

/**
 * Signed-in user of the current request: the Better Auth session, otherwise the address set by a trusted
 * authenticating proxy (AUTH_TRUSTED_EMAIL_HEADER), whose account is created on first visit.
 * Cached for the duration of the request.
 */
/** An account disabled by the Ronde team counts as signed out */
function enabled<T extends { disabledAt: Date | null }>(user: T | null): Omit<T, "disabledAt"> | null {
  if (!user || user.disabledAt) return null;
  const { disabledAt: _, ...rest } = user;
  return rest;
}

export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (session) return enabled(await prisma.user.findUnique({ where: { id: session.user.id }, select: { ...select, disabledAt: true } }));
  const header = env.trustedEmailHeader();
  const email = header ? h.get(header)?.trim().toLowerCase() : "";
  if (!email) return null;
  const existing = await prisma.user.findUnique({ where: { email }, select: { ...select, disabledAt: true } });
  if (existing || !(await signupAllowed(email))) return enabled(existing);
  const first = (await prisma.user.count()) === 0;
  return prisma.user.create({
    data: {
      id: crypto.randomUUID(),
      email,
      name: email.split("@")[0] ?? email,
      emailVerified: true,
      instanceRole: first ? "admin" : "user",
    },
    select,
  });
});

/** For server actions and API routes: the signed-in user, or a 401 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) throw new AccessError(401, "signInRequired");
  return user;
}

export interface WorkspaceContext {
  user: CurrentUser;
  workspace: { id: string; slug: string; name: string; locale: string; timezone: string; plan: string; settings: WorkspaceSettings };
  member: { id: string; personId: string; role: WorkspaceRole };
  principal: Principal;
  /** Prisma client confined to this workspace */
  db: ReturnType<typeof scoped>;
  can: (permission: Permission) => boolean;
}

export interface WorkspaceSettings {
  /** Who may create meetings: every member (default) or admins only */
  meetingCreation?: "members" | "admins";
  /** Minutes kept free between two meetings of a person: "find a slot" and the schedule warnings respect it */
  bufferMin?: number;
  /** Audit log entries also sent to a SIEM through this webhook connector (Enterprise) */
  auditStream?: { connectorId: string };
  /** Insights by email (Team): how often, to whom, and the last period sent */
  reports?: { frequency: "weekly" | "monthly"; recipients: "admins" | "custom"; emails: string[]; lastSentFor?: string };
  /** AI assistant (Team): turned on, the model, the workspace's own key (encrypted; empty: the instance key) */
  ai?: { enabled: boolean; model: string; key: string };
  /** Transcription (Team): the speech-to-text service, its model and language, its key (encrypted; empty: the instance's) */
  transcription?: { enabled: boolean; baseUrl: string; model: string; language: string; key: string };
  /** The Slack app added to the workspace (Team) */
  slack?: SlackSettings;
  /** The Microsoft Teams app, linked to a team and its channel (Team) */
  teams?: TeamsSettings;
  /** Public holidays that skip the sessions of its meetings (a country "FR" or a region "DE-BY"; a meeting may
   * choose others); missing: none */
  holidays?: string;
}

export type SlackSettings = {
  teamId: string;
  teamName: string;
  botUserId: string;
  /** The bot's token, encrypted */
  botToken: string;
  /** Channel picked during the installation ("#team"), and the connector posting there */
  channel: string;
  connectorId: string | null;
  /** Check-in reminders by direct message, in place of the email, for the people found in Slack */
  reminders: boolean;
  installedAt: string;
  installedById: string;
};

export type TeamsSettings = {
  /** The Microsoft organization (tenant), the team and the service its activities come from */
  tenantId: string;
  teamId: string;
  teamName: string;
  serviceUrl: string;
  /** The channel where the app was added: the bot's conversation there, and the connector posting to it */
  channelId: string;
  channelName: string;
  connectorId: string | null;
  /** Check-in reminders by personal message, in place of the email, for the people found in the team */
  reminders: boolean;
  linkedAt: string;
  linkedById: string;
};

/** The user's seat in a workspace, by slug; null when the workspace does not exist or they are not an active member */
export const workspaceContext = cache(async (slug: string): Promise<WorkspaceContext | null> => {
  const user = await currentUser();
  if (!user) return null;
  return contextFor(user, { slug });
});

/**
 * A member's context outside a request (scheduled jobs: the weekly summary…): the same workspace, the same
 * permissions as when they browse it
 */
export async function memberContext(workspaceId: string, userId: string): Promise<WorkspaceContext | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select });
  return user ? contextFor(user, { id: workspaceId }) : null;
}

async function contextFor(user: CurrentUser, at: { slug: string } | { id: string }): Promise<WorkspaceContext | null> {
  // The edition gates modules and features: its license is checked again at most once a minute
  await loadLicense();
  // A workspace suspended by the Ronde team is out of reach: its pages show a notice (pageWorkspace)
  const workspace = await prisma.workspace.findFirst({
    where: { ...at, deletedAt: null, suspendedAt: null },
    select: { id: true, slug: true, name: true, locale: true, timezone: true, plan: true, settings: true },
  });
  if (!workspace) return null;
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
    select: { id: true, personId: true, role: true, status: true, customRole: { select: { permissions: true } } },
  });
  if (!member || member.status !== "active") return null;
  const settings = (workspace.settings ?? {}) as WorkspaceSettings;
  // A custom role only counts while the license includes them; it is kept otherwise, without effect
  const extra = featureOn("permissions.customRoles", workspace)
    ? (member.customRole?.permissions ?? []).filter((p): p is Permission => (CUSTOM_ROLE_PERMISSIONS as readonly string[]).includes(p))
    : [];
  const principal: Principal = { userId: user.id, personId: member.personId, workspaceId: workspace.id, workspaceRole: member.role, extra };
  return {
    user,
    workspace: { ...workspace, settings },
    member: { id: member.id, personId: member.personId, role: member.role },
    principal,
    db: scoped(prisma, workspace.id),
    can: (permission) => can(principal, permission, settings),
  };
}

/** For server actions: the workspace context, after checking a permission (404 for strangers, 403 otherwise) */
export async function authorize(slug: string, permission?: Permission, meetingRole?: MeetingRole | null): Promise<WorkspaceContext> {
  await requireUser();
  const ctx = await workspaceContext(slug);
  if (!ctx) throw new AccessError(403, "accessDenied");
  if (permission && !can({ ...ctx.principal, meetingRole }, permission, ctx.workspace.settings)) throw new AccessError(403, "accessDenied");
  return ctx;
}

/** For pages: the signed-in user, otherwise a redirect to the sign-in page that comes back here */
export async function pageUser(next: string): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  return user;
}

/** For workspace pages: the context, a redirect to sign in, or a 404 for a workspace the user cannot see */
export async function pageWorkspace(slug: string, permission?: Permission): Promise<WorkspaceContext> {
  await pageUser(`/w/${slug}`);
  const ctx = await workspaceContext(slug);
  if (!ctx) {
    if (await suspendedFor(slug)) redirect(`/suspended?w=${encodeURIComponent(slug)}`);
    notFound();
  }
  if (permission && !ctx.can(permission)) redirect(`/w/${slug}`);
  return ctx;
}

/** A suspended workspace the signed-in user belongs to: its name, for the notice; null otherwise */
export async function suspendedFor(slug: string): Promise<{ name: string } | null> {
  const user = await currentUser();
  if (!user) return null;
  return prisma.workspace.findFirst({
    where: { slug, deletedAt: null, suspendedAt: { not: null }, members: { some: { userId: user.id, status: "active" } } },
    select: { name: true },
  });
}
