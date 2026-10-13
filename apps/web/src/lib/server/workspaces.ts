import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { PHONE_NUMBER } from "@ronde/connectors/kinds";
import { authEmail } from "@ronde/core/emails";
import { assignableRoles, type WorkspaceRole } from "@ronde/core/permissions";
import { availableSlug, isSlugFormat, RESERVED_SLUGS, slugify, splitName } from "@ronde/core/slug";
import { prisma } from "@ronde/db";
import { isLocale, type Locale, resolveLocale } from "@ronde/i18n";
import { erasePerson } from "./account-data";
import type { CurrentUser, WorkspaceContext, WorkspaceSettings } from "./authz";
import { billingOn, endSubscription } from "./billing";
import { emailBrand } from "./branding";
import { removeMeetingEvents } from "./calendars";
import { env } from "./env";
import { AccessError, OpError } from "./errors";
import { guessHolidays, isHolidayCode } from "./holidays";
import { instanceSettings } from "./instance";
import { isCloud } from "./license";
import { isSampleAddress, sendEmail } from "./mailer";
import { resyncSession } from "./meeting/schedule";
import { publicUrl } from "./public-url";
import { disconnectSlack } from "./slack";

const INVITATION_DAYS = 14;
const PALETTE_SIZE = 6;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const isEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** Workspaces of a user, most recent first */
export function userWorkspaces(userId: string) {
  return prisma.workspace.findMany({
    where: { deletedAt: null, members: { some: { userId, status: "active" } } },
    select: { id: true, slug: true, name: true, members: { where: { userId }, select: { role: true } } },
    orderBy: { createdAt: "desc" },
  });
}

/** Suggested slug for a new workspace name */
export async function suggestSlug(name: string): Promise<string> {
  const base = slugify(name);
  const taken = await prisma.workspace.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } });
  return availableSlug(base, new Set(taken.map((w) => w.slug)));
}

/**
 * A workspace address: lowercase letters, digits and dashes; none of the reserved ones (which would pass for
 * Ronde's own pages), except for the instance's administrators and for the address a workspace already has
 */
function checkSlug(user: CurrentUser, slug: string, current?: string) {
  if (!isSlugFormat(slug)) throw new OpError("slugInvalid");
  if (slug !== current && RESERVED_SLUGS.has(slug) && user.instanceRole !== "admin")
    throw new OpError("slugReserved", { slug: `${slug}-team` });
}

/** Creates a workspace: its creator becomes the owner, with their directory profile */
export async function createWorkspace(
  user: CurrentUser,
  input: { name: string; slug?: string; locale?: string; timezone?: string },
): Promise<{ slug: string }> {
  const name = input.name.trim();
  if (!name) throw new OpError("nameRequired");
  const slug = input.slug?.trim() ? input.slug.trim().toLowerCase() : await suggestSlug(name);
  checkSlug(user, slug);
  if (await prisma.workspace.findUnique({ where: { slug }, select: { id: true } })) throw new OpError("slugTaken");
  const locale: Locale = resolveLocale(input.locale, user.locale, (await instanceSettings()).defaultLocale);
  const timezone = input.timezone && isTimeZone(input.timezone) ? input.timezone : "UTC";
  const [firstName, lastName] = splitName(user.name || user.email.split("@")[0] || "");
  await prisma.$transaction(async (tx) => {
    // The public holidays of the country of its time zone, when only one country has it (a setting to change)
    const holidays = guessHolidays(timezone);
    const workspace = await tx.workspace.create({
      data: { name, slug, locale, timezone, ...(holidays ? { settings: { holidays } } : {}) },
    });
    const person = await tx.person.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        email: user.email,
        firstName,
        lastName,
        locale: user.locale,
        timezone: user.timezone,
      },
    });
    await tx.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, personId: person.id, role: "owner" } });
  });
  return { slug };
}

/** Margins offered between two meetings, in minutes */
export const BUFFERS = [0, 5, 10, 15, 30];

export async function updateWorkspace(
  ctx: WorkspaceContext,
  input: {
    name: string;
    slug: string;
    locale: string;
    timezone: string;
    meetingCreation: WorkspaceSettings["meetingCreation"];
    bufferMin?: number;
    /** Public holidays the meetings skip ("" for none); missing: unchanged */
    holidays?: string;
  },
): Promise<{ slug: string }> {
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  if (!name) throw new OpError("nameRequired");
  checkSlug(ctx.user, slug, ctx.workspace.slug);
  if (slug !== ctx.workspace.slug && (await prisma.workspace.findUnique({ where: { slug }, select: { id: true } })))
    throw new OpError("slugTaken");
  if (!isLocale(input.locale) || !isTimeZone(input.timezone)) throw new OpError("invalidRequest", { details: "locale, timezone" });
  if (input.holidays && !isHolidayCode(input.holidays)) throw new OpError("invalidRequest", { details: "holidays" });
  const settings: WorkspaceSettings = {
    ...ctx.workspace.settings,
    meetingCreation: input.meetingCreation === "admins" ? "admins" : "members",
    bufferMin: BUFFERS.includes(input.bufferMin ?? 0) ? (input.bufferMin ?? 0) : 0,
  };
  if (input.holidays !== undefined) {
    if (input.holidays) settings.holidays = input.holidays;
    // Left out of the stored JSON
    else settings.holidays = undefined;
  }
  await prisma.workspace.update({
    where: { id: ctx.workspace.id },
    data: { name, slug, locale: input.locale, timezone: input.timezone, settings: settings as object },
  });
  // Other holidays (or another time zone): the sessions planned by the meetings that follow the workspace move along
  // (the meetings following the workspace's holidays for the first, its time zone for the second)
  const holidaysMoved = settings.holidays !== ctx.workspace.settings.holidays;
  const zoneMoved = input.timezone !== ctx.workspace.timezone;
  if (holidaysMoved || zoneMoved) {
    const workspace = { timezone: input.timezone };
    const following = [...(holidaysMoved ? [{ holidays: null }] : []), ...(zoneMoved ? [{ timezone: null }] : [])];
    for (const meeting of await ctx.db.meeting.findMany({ where: { archivedAt: null, OR: following } }))
      await resyncSession(ctx.db, meeting, workspace);
  }
  return { slug };
}

/**
 * The workspace disappears at once, and everything it holds is erased 30 days later (purgeDeleted). Before:
 * its subscription ends (refused by Stripe, nothing is deleted), its coming sessions leave the calendars, Slack
 * forgets it.
 */
export async function deleteWorkspace(ctx: WorkspaceContext, confirmation: string): Promise<void> {
  if (confirmation.trim() !== ctx.workspace.slug) throw new OpError("confirmationMismatch");
  await endSubscription(ctx.workspace.id);
  for (const m of await ctx.db.meeting.findMany({ where: { calendarAccountId: { not: null } }, select: { id: true } }))
    await removeMeetingEvents(ctx.workspace.id, m.id).catch((e) => console.error(`[workspace] calendar of meeting ${m.id}`, e));
  await disconnectSlack(ctx).catch((e) => console.error("[workspace] slack", e));
  await prisma.workspace.update({
    where: { id: ctx.workspace.id },
    data: { deletedAt: new Date(), slug: `${ctx.workspace.slug}-deleted-${Date.now()}` },
  });
}

// ---------- Directory ----------

export interface PersonInput {
  email: string;
  firstName: string;
  lastName?: string;
  jobCategoryId?: string | null;
  birthday?: string | null;
  /** Mobile number in international form, for SMS and WhatsApp reminders */
  phone?: string | null;
}

const BIRTHDAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

async function personData(ctx: WorkspaceContext, input: PersonInput) {
  const email = normalizeEmail(input.email);
  const firstName = input.firstName.trim();
  if (!isEmail(email)) throw new OpError("emailInvalid");
  if (!firstName) throw new OpError("nameRequired");
  const birthday = input.birthday?.trim() || null;
  if (birthday && !BIRTHDAY.test(birthday)) throw new OpError("invalidRequest", { details: "birthday" });
  const jobCategoryId = input.jobCategoryId || null;
  if (jobCategoryId && !(await ctx.db.jobCategory.findFirst({ where: { id: jobCategoryId }, select: { id: true } }))) {
    throw new OpError("invalidRequest", { details: "jobCategoryId" });
  }
  const phone = input.phone?.replace(/[\s.()-]/g, "") || null;
  if (phone && !PHONE_NUMBER.test(phone)) throw new OpError("phoneInvalid");
  return { email, firstName, lastName: input.lastName?.trim() ?? "", birthday, jobCategoryId, phone };
}

/** Adds someone to the directory without inviting them (people who never sign in still get a profile) */
export async function addPerson(ctx: WorkspaceContext, input: PersonInput) {
  const data = await personData(ctx, input);
  if (await ctx.db.person.findFirst({ where: { email: data.email }, select: { id: true } })) throw new OpError("personExists");
  const count = await ctx.db.person.count();
  return ctx.db.person.create({ data: { ...data, workspaceId: ctx.workspace.id, color: count % PALETTE_SIZE } });
}

/** Edits a profile: people managers edit anyone, everyone edits their own (except the address, tied to their account) */
export async function updatePerson(ctx: WorkspaceContext, personId: string, input: PersonInput) {
  const person = await ctx.db.person.findFirst({ where: { id: personId }, select: { id: true, email: true, userId: true } });
  if (!person) throw new OpError("notFound");
  const own = person.id === ctx.member.personId;
  if (!own && !ctx.can("people.manage")) throw new AccessError(403, "accessDenied");
  const data = await personData(ctx, { ...input, email: person.userId ? person.email : input.email });
  if (data.email !== person.email && (await ctx.db.person.findFirst({ where: { email: data.email }, select: { id: true } }))) {
    throw new OpError("personExists");
  }
  return ctx.db.person.update({ where: { id: person.id }, data });
}

/** Removes a person from the directory, and their seat in the workspace if they have one */
export async function removePerson(ctx: WorkspaceContext, personId: string): Promise<void> {
  const person = await ctx.db.person.findFirst({ where: { id: personId }, select: { id: true, member: { select: { role: true } } } });
  if (!person) throw new OpError("notFound");
  if (person.member) await assertCanChangeRole(ctx, person.member.role, null);
  // Their profile and access go; what they said stays the team's, signed by a former member (their open actions
  // included, to hand over)
  await erasePerson(ctx.db, ctx.workspace.id, person.id);
}

// ---------- Roles ----------

async function assertCanChangeRole(ctx: WorkspaceContext, from: WorkspaceRole, to: WorkspaceRole | null) {
  const allowed = assignableRoles(ctx.member.role, { billing: billingOn() });
  // Nobody acts on a role above their own, nor hands one out
  if (!allowed.includes(from) || (to && !allowed.includes(to))) throw new AccessError(403, "roleNotAssignable");
  if (from === "owner" && to !== "owner" && (await ctx.db.workspaceMember.count({ where: { role: "owner", status: "active" } })) <= 1) {
    throw new OpError("lastOwner");
  }
}

export async function changeRole(ctx: WorkspaceContext, personId: string, role: WorkspaceRole): Promise<void> {
  const member = await ctx.db.workspaceMember.findFirst({ where: { personId }, select: { id: true, role: true } });
  if (!member) throw new OpError("notFound");
  if (member.role === role) return;
  await assertCanChangeRole(ctx, member.role, role);
  await ctx.db.workspaceMember.update({ where: { id: member.id }, data: { role } });
}

/**
 * Leaves the workspace; the directory profile stays, unlinked from the account and inactive: no reminder, digest,
 * notification or turn reaches the person any more
 */
export async function leaveWorkspace(ctx: WorkspaceContext): Promise<void> {
  if (ctx.member.role === "owner" && (await ctx.db.workspaceMember.count({ where: { role: "owner", status: "active" } })) <= 1) {
    throw new OpError("lastOwner");
  }
  await prisma.$transaction([
    prisma.workspaceMember.delete({ where: { id: ctx.member.id } }),
    prisma.person.update({ where: { id: ctx.member.personId }, data: { userId: null, active: false } }),
  ]);
}

// ---------- Invitations ----------

/**
 * Invites someone by email: creates their profile when needed and sends a link valid for 14 days.
 * Returns the link, so it can also be shared by hand (no mail server on the instance).
 */
/** Invitations a person may send in a day: RONDE_INVITES_PER_DAY, otherwise 100 in the cloud, no limit elsewhere */
export const invitationsPerDay = () => Number(process.env.RONDE_INVITES_PER_DAY) || (isCloud() ? 100 : 0);

export async function invite(
  ctx: WorkspaceContext,
  input: PersonInput & { role: WorkspaceRole },
): Promise<{ url: string; emailed: boolean }> {
  if (!assignableRoles(ctx.member.role, { billing: billingOn() }).includes(input.role)) throw new AccessError(403, "roleNotAssignable");
  const data = await personData(ctx, input);
  const existing = await ctx.db.person.findFirst({
    where: { email: data.email },
    select: { id: true, sample: true, member: { select: { id: true } } },
  });
  if (existing?.member) throw new OpError("alreadyMember");
  if (existing?.sample || isSampleAddress(data.email)) throw new OpError("samplePerson");
  // Invitations are emails sent on someone's behalf: a person sends a limited number a day (the cloud would
  // otherwise relay anyone's mass mailing)
  const limit = invitationsPerDay();
  if (
    limit &&
    (await prisma.invitation.count({ where: { invitedById: ctx.user.id, createdAt: { gt: new Date(Date.now() - 86_400_000) } } })) >= limit
  )
    throw new OpError("tooManyInvitations", { count: limit });
  const person = existing ?? (await addPerson(ctx, data));
  // A new invitation replaces the pending ones
  await ctx.db.invitation.updateMany({ where: { email: data.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  const token = randomBytes(32).toString("base64url");
  await ctx.db.invitation.create({
    data: {
      workspaceId: ctx.workspace.id,
      personId: person.id,
      email: data.email,
      role: input.role,
      tokenHash: hashToken(token),
      invitedById: ctx.user.id,
      expiresAt: new Date(Date.now() + INVITATION_DAYS * 86_400_000),
    },
  });
  const url = await publicUrl(`/invite/${token}`);
  const locale = resolveLocale(ctx.workspace.locale, (await instanceSettings()).defaultLocale);
  await sendEmail({
    to: data.email,
    ...authEmail("invitation", {
      url,
      locale,
      workspace: ctx.workspace.name,
      inviter: ctx.user.name || ctx.user.email,
      brand: await emailBrand(ctx.workspace.id),
    }),
  });
  return { url, emailed: !!env.smtpUrl() };
}

export async function revokeInvitation(ctx: WorkspaceContext, invitationId: string): Promise<void> {
  const { count } = await ctx.db.invitation.updateMany({
    where: { id: invitationId, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!count) throw new OpError("notFound");
}

export type InvitationState =
  | { status: "invalid" }
  | { status: "expired"; workspace: string }
  | { status: "member"; workspace: string; slug: string; forOther: string | null }
  | { status: "pending"; id: string; workspace: string; slug: string; email: string; inviter: string; role: WorkspaceRole };

/** What an invitation link leads to, for the given (possibly signed-out) user */
export async function invitationState(token: string, user: CurrentUser | null): Promise<InvitationState> {
  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      email: true,
      role: true,
      invitedById: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      workspace: { select: { id: true, name: true, slug: true, deletedAt: true } },
    },
  });
  if (!invitation || invitation.revokedAt || invitation.workspace.deletedAt) return { status: "invalid" };
  const { workspace } = invitation;
  if (
    user &&
    (await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } } }))
  ) {
    // Someone else's invitation, still waiting: say so, so it reaches the person it is for
    const forOther = !invitation.acceptedAt && invitation.email !== user.email.toLowerCase() ? invitation.email : null;
    return { status: "member", workspace: workspace.name, slug: workspace.slug, forOther };
  }
  if (invitation.acceptedAt) return { status: "invalid" };
  if (invitation.expiresAt < new Date()) return { status: "expired", workspace: workspace.name };
  const inviter = await prisma.user.findUnique({ where: { id: invitation.invitedById }, select: { name: true, email: true } });
  return {
    status: "pending",
    id: invitation.id,
    workspace: workspace.name,
    slug: workspace.slug,
    email: invitation.email,
    inviter: inviter?.name || inviter?.email || "",
    role: invitation.role,
  };
}

/** Accepts an invitation: links the profile to the account and opens the seat. The address must match. */
export async function acceptInvitation(user: CurrentUser, token: string): Promise<{ slug: string }> {
  const state = await invitationState(token, user);
  if (state.status === "member") return { slug: state.slug };
  if (state.status === "expired") throw new OpError("invitationExpired");
  if (state.status !== "pending") throw new OpError("invitationInvalid");
  if (normalizeEmail(user.email) !== state.email) throw new OpError("invitationOtherEmail", { email: state.email });
  const invitation = await prisma.invitation.findUniqueOrThrow({
    where: { id: state.id },
    select: { workspaceId: true, personId: true, email: true, role: true },
  });
  await prisma.$transaction(async (tx) => {
    const { workspaceId } = invitation;
    const [firstName, lastName] = splitName(user.name || user.email.split("@")[0] || "");
    const person =
      (invitation.personId && (await tx.person.findFirst({ where: { id: invitation.personId, workspaceId } }))) ||
      (await tx.person.upsert({
        where: { workspaceId_email: { workspaceId, email: invitation.email } },
        create: { workspaceId, email: invitation.email, firstName, lastName },
        update: {},
      }));
    await tx.person.update({ where: { id: person.id }, data: { userId: user.id } });
    await tx.workspaceMember.create({ data: { workspaceId, userId: user.id, personId: person.id, role: invitation.role } });
    await tx.invitation.update({ where: { id: state.id }, data: { acceptedAt: new Date() } });
  });
  return { slug: state.slug };
}

/** Pending invitations sent to a user's address, for the onboarding page */
/** The account's address was proven (by email, or by a provider that vouches for it) */
export async function addressProven(userId: string): Promise<boolean> {
  return !!(await prisma.user.findUnique({ where: { id: userId }, select: { emailVerified: true } }))?.emailVerified;
}

export function pendingInvitationsFor(email: string) {
  return prisma.invitation.findMany({
    where: {
      email: normalizeEmail(email),
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
      workspace: { deletedAt: null },
    },
    select: { id: true, role: true, workspace: { select: { name: true, slug: true } } },
    orderBy: { createdAt: "desc" },
  });
}

/** Joins a workspace from an invitation listed on the onboarding page (same address, no token needed) */
export async function acceptInvitationById(user: CurrentUser, invitationId: string): Promise<{ slug: string }> {
  // Without the link, only a proven address vouches for the person (anyone may sign up with any address)
  if (!(await addressProven(user.id))) throw new OpError("invitationInvalid");
  const invitation = await prisma.invitation.findFirst({
    where: { id: invitationId, email: normalizeEmail(user.email), acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true },
  });
  if (!invitation) throw new OpError("invitationInvalid");
  // Re-issue a one-time token to go through the same path as a link
  const token = randomBytes(32).toString("base64url");
  await prisma.invitation.update({ where: { id: invitation.id }, data: { tokenHash: hashToken(token) } });
  return acceptInvitation(user, token);
}

// ---------- Job categories ----------

export async function addJobCategory(ctx: WorkspaceContext, name: string) {
  const label = name.trim();
  if (!label) throw new OpError("nameRequired");
  if (await ctx.db.jobCategory.findFirst({ where: { name: label }, select: { id: true } })) throw new OpError("categoryExists");
  const position = await ctx.db.jobCategory.count();
  return ctx.db.jobCategory.create({ data: { workspaceId: ctx.workspace.id, name: label, position, color: position % PALETTE_SIZE } });
}

export async function renameJobCategory(ctx: WorkspaceContext, id: string, name: string) {
  const label = name.trim();
  if (!label) throw new OpError("nameRequired");
  if (await ctx.db.jobCategory.findFirst({ where: { name: label, NOT: { id } }, select: { id: true } }))
    throw new OpError("categoryExists");
  const { count } = await ctx.db.jobCategory.updateMany({ where: { id }, data: { name: label } });
  if (!count) throw new OpError("notFound");
}

export async function deleteJobCategory(ctx: WorkspaceContext, id: string) {
  const { count } = await ctx.db.jobCategory.deleteMany({ where: { id } });
  if (!count) throw new OpError("notFound");
}
