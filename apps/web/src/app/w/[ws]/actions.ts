"use server";

import { randomBytes } from "node:crypto";
import type { Permission, WorkspaceRole } from "@ronde/core/permissions";
import { prisma } from "@ronde/db";
import type { SsoProviderInput } from "@ronde/editions/ee";
import { resolveLocale } from "@ronde/i18n";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { enterprise } from "@/ee-bridge";
import { type AbsenceInput, addAbsence, removeAbsence } from "@/lib/server/absences";
import { run } from "@/lib/server/action";
import { AI_MODELS, aiConfig, aiOn } from "@/lib/server/ai";
import { audit, auditStreamOn } from "@/lib/server/audit";
import { auth, SSO_PROVIDERS, signInProviders } from "@/lib/server/auth";
import { authorize, type WorkspaceContext } from "@/lib/server/authz";
import { openPortal, startCheckout } from "@/lib/server/billing";
import {
  type CalendarAccountInput,
  calendarSyncOn,
  deleteCalendarAccount,
  meetingAvailability,
  saveCalendarAccount,
  setMeetingCalendar,
  syncMeetingCalendar,
  testCalendarAccount,
} from "@/lib/server/calendars";
import { domainsOn, domainTakenElsewhere, endDomainSessions, ssoEnforcementOn } from "@/lib/server/domains";
import { AccessError, OpError } from "@/lib/server/errors";
import { createGuestLink, listGuestLinks, revokeGuestLink } from "@/lib/server/guest-links";
import { INTERNAL_HEADER, INTERNAL_TOKEN, identityHost, refreshTrustedOrigins, withPendingOrigin } from "@/lib/server/identity";
import { meetingContext } from "@/lib/server/meeting/context";
import { runOp } from "@/lib/server/meeting/ops";
import { createMeeting, type NewMeeting } from "@/lib/server/meetings";
import { type ConnectorInput, deleteConnector, saveConnector, testConnector } from "@/lib/server/notify/connectors";
import { assertPublicHost, assertPublicUrl } from "@/lib/server/outbound";
import { publicUrl } from "@/lib/server/public-url";
import { reportsOn, sendReport } from "@/lib/server/reports";
import { customRolesOn } from "@/lib/server/roles";
import { createSample, deleteSample, sampleMeeting } from "@/lib/server/sample";
import { newScimToken } from "@/lib/server/scim";
import { canEncrypt, decryptSecret, encryptSecret } from "@/lib/server/secrets";
import { disconnectSlack, setSlackReminders } from "@/lib/server/slack";
import { linkTeams, setTeamsReminders, unlinkTeams } from "@/lib/server/teams";
import { deleteTemplate } from "@/lib/server/templates";
import { createTicket, deleteTracker, saveTracker, type TrackerInput, testTracker, trackersOn } from "@/lib/server/trackers";
import { transcriptionOn } from "@/lib/server/transcripts";
import {
  createMeetingRoom,
  deleteVideoAccount,
  saveVideoAccount,
  testVideoAccount,
  type VideoAccountInput,
  videoLinksOn,
} from "@/lib/server/video-accounts";
import { deleteWiki, publishSession, saveWiki, setMeetingWiki, testWiki, type WikiInput, wikiFailed, wikisOn } from "@/lib/server/wikis";
import {
  addJobCategory,
  addPerson,
  changeRole,
  deleteJobCategory,
  deleteWorkspace,
  invite,
  leaveWorkspace,
  moveJobCategory,
  type PersonInput,
  removePerson,
  renameJobCategory,
  revokeInvitation,
  styleJobCategory,
  updatePerson,
  updateWorkspace,
} from "@/lib/server/workspaces";
import { firstStepsHidden } from "@/lib/shared/prefs";

// Every action re-checks the permission against the workspace in the URL: the client is never trusted
const refresh = (slug: string) => revalidatePath(`/w/${slug}`, "layout");

/** Keeps the change in the audit log (Enterprise) */
const log = (ctx: WorkspaceContext, action: string, targetType: string, targetId: string | null, data?: unknown) =>
  audit(ctx, ctx.db, { action, targetType, targetId, data });

/** Opens the sample meeting (created on first use) and gives its id */
export async function openSampleAction(slug: string) {
  return run(async () => {
    const ctx = await authorize(slug, "meeting.create");
    const existed = await sampleMeeting(ctx);
    const result = await createSample(ctx);
    if (!existed) await log(ctx, "meeting.sample", "meeting", result.id);
    refresh(slug);
    return result;
  });
}

/** Deletes the sample meeting and its fictitious team, for good */
export async function deleteSampleAction(slug: string, meetingId: string) {
  return run(async () => {
    const ctx = await authorize(slug);
    await deleteSample(ctx, meetingId);
    await log(ctx, "meeting.sampleDeleted", "meeting", meetingId);
    refresh(slug);
    return null;
  });
}

/** What the audit log keeps of a profile: who it is, and which other fields were set, not their values */
const personLogged = (input: PersonInput) => ({
  email: input.email,
  firstName: input.firstName,
  lastName: input.lastName ?? "",
  set: (["phone", "birthday", "jobCategoryId"] as const).filter((k) => !!input[k]),
});

export async function inviteAction(slug: string, input: PersonInput & { role: WorkspaceRole }) {
  return run(async () => {
    const ctx = await authorize(slug, "people.invite");
    const result = await invite(ctx, input);
    await log(ctx, "people.invite", "person", null, { email: input.email, role: input.role });
    refresh(slug);
    return result;
  });
}

export async function addPersonAction(slug: string, input: PersonInput) {
  return run(async () => {
    const ctx = await authorize(slug, "people.manage");
    await addPerson(ctx, input);
    await log(ctx, "people.add", "person", null, personLogged(input));
    refresh(slug);
    return null;
  });
}

export async function updatePersonAction(slug: string, personId: string, input: PersonInput) {
  return run(async () => {
    // Permission checked inside: managers edit anyone, everyone edits their own profile
    const ctx = await authorize(slug, "people.read");
    await updatePerson(ctx, personId, input);
    await log(ctx, "people.update", "person", personId, personLogged(input));
    refresh(slug);
    return null;
  });
}

export async function removePersonAction(slug: string, personId: string) {
  return run(async () => {
    const ctx = await authorize(slug, "people.manage");
    await removePerson(ctx, personId);
    await log(ctx, "people.remove", "person", personId);
    refresh(slug);
    return null;
  });
}

export async function changeRoleAction(slug: string, personId: string, role: WorkspaceRole) {
  return run(async () => {
    const ctx = await authorize(slug, "members.manage");
    await changeRole(ctx, personId, role);
    await log(ctx, "members.role", "person", personId, { role });
    refresh(slug);
    return null;
  });
}

export async function revokeInvitationAction(slug: string, invitationId: string) {
  return run(async () => {
    const ctx = await authorize(slug, "people.invite");
    await revokeInvitation(ctx, invitationId);
    await log(ctx, "people.invitationRevoked", "invitation", invitationId);
    refresh(slug);
    return null;
  });
}

export async function updateWorkspaceAction(
  slug: string,
  input: {
    name: string;
    slug: string;
    locale: string;
    timezone: string;
    meetingCreation: "members" | "admins";
    bufferMin: number;
    holidays: string;
  },
) {
  return run(async () => {
    const ctx = await authorize(slug, "workspace.manage");
    const result = await updateWorkspace(ctx, input);
    await log(ctx, "workspace.update", "workspace", ctx.workspace.id, input);
    refresh(result.slug);
    return result;
  });
}

export async function addJobCategoryAction(slug: string, name: string, parentId: string | null = null) {
  return run(async () => {
    const ctx = await authorize(slug, "workspace.manage");
    await addJobCategory(ctx, name, parentId);
    await log(ctx, "workspace.categoryAdd", "category", null, { name, parentId });
    refresh(slug);
    return null;
  });
}

export async function moveJobCategoryAction(slug: string, id: string, parentId: string | null) {
  return run(async () => {
    const ctx = await authorize(slug, "workspace.manage");
    await moveJobCategory(ctx, id, parentId);
    await log(ctx, "workspace.categoryMove", "category", id, { parentId });
    refresh(slug);
    return null;
  });
}

export async function styleJobCategoryAction(slug: string, id: string, style: { color?: number; icon?: string }) {
  return run(async () => {
    const ctx = await authorize(slug, "workspace.manage");
    await styleJobCategory(ctx, id, style);
    refresh(slug);
    return null;
  });
}

export async function renameJobCategoryAction(slug: string, id: string, name: string) {
  return run(async () => {
    const ctx = await authorize(slug, "workspace.manage");
    await renameJobCategory(ctx, id, name);
    await log(ctx, "workspace.categoryRename", "category", id, { name });
    refresh(slug);
    return null;
  });
}

export async function deleteJobCategoryAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await authorize(slug, "workspace.manage");
    await deleteJobCategory(ctx, id);
    await log(ctx, "workspace.categoryDelete", "category", id);
    refresh(slug);
    return null;
  });
}

export async function leaveWorkspaceAction(slug: string) {
  return run(async () => {
    const ctx = await authorize(slug);
    await leaveWorkspace(ctx);
    await log(ctx, "members.leave", "person", ctx.member.personId);
    return null;
  });
}

export async function deleteWorkspaceAction(slug: string, confirmation: string) {
  return run(async () => {
    const ctx = await authorize(slug, "workspace.delete");
    await deleteWorkspace(ctx, confirmation);
    await log(ctx, "workspace.delete", "workspace", ctx.workspace.id);
    return null;
  });
}

export async function createMeetingAction(slug: string, input: NewMeeting) {
  return run(async () => {
    const ctx = await authorize(slug, "meeting.create");
    const result = await createMeeting(ctx, input);
    await log(ctx, "meeting.new", "meeting", result.id, { name: input.name, template: input.template });
    refresh(slug);
    return result;
  });
}

// ---------- Notification connectors ----------

export async function saveConnectorAction(slug: string, input: ConnectorInput) {
  return run(async () => {
    const ctx = await authorize(slug, "connectors.manage");
    const result = await saveConnector(ctx, input);
    await log(ctx, "connectors.save", "connector", result.id, input);
    refresh(slug);
    return result;
  });
}

export async function deleteConnectorAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await authorize(slug, "connectors.manage");
    await deleteConnector(ctx, id);
    await log(ctx, "connectors.delete", "connector", id);
    refresh(slug);
    return null;
  });
}

export async function testConnectorAction(slug: string, id: string, room?: string) {
  return run(async () => {
    await testConnector(await authorize(slug, "connectors.manage"), id, room);
    refresh(slug);
    return null;
  });
}

export async function deleteTemplateAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await authorize(slug, "templates.manage");
    await deleteTemplate(ctx, id);
    await log(ctx, "templates.delete", "template", id);
    refresh(slug);
    return null;
  });
}

// ---------- Audit log (stream: Enterprise) ----------

/** SIEM stream of the audit log: a webhook connector of the workspace, or none */
export async function setAuditStreamAction(slug: string, connectorId: string) {
  return run(async () => {
    const ctx = await authorize(slug, "workspace.manage");
    if (!auditStreamOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
    if (connectorId && !(await ctx.db.connector.findFirst({ where: { id: connectorId, kind: "webhook" }, select: { id: true } })))
      throw new OpError("notFound");
    const { auditStream: _old, ...rest } = ctx.workspace.settings;
    const settings = connectorId ? { ...rest, auditStream: { connectorId } } : rest;
    await prisma.workspace.update({ where: { id: ctx.workspace.id }, data: { settings } });
    await log(ctx, "workspace.auditStream", "connector", connectorId || null);
    refresh(slug);
    return null;
  });
}

// ---------- Custom roles (Enterprise) ----------

async function rolesContext(slug: string) {
  const ctx = await authorize(slug, "members.manage");
  if (!customRolesOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
  return ctx;
}

export async function saveRoleAction(slug: string, input: { id?: string; name: string; description: string; permissions: string[] }) {
  return run(async () => {
    const ctx = await rolesContext(slug);
    // Nobody hands out a permission they do not hold, nor changes the role they hold themselves
    if (input.permissions.some((p) => !ctx.can(p as Permission))) throw new AccessError(403, "accessDenied");
    if (
      input.id &&
      (await ctx.db.workspaceMember.findFirst({ where: { personId: ctx.member.personId, customRoleId: input.id }, select: { id: true } }))
    )
      throw new AccessError(403, "accessDenied");
    const result = await enterprise.roles.save(ctx.db, ctx.workspace.id, input);
    await log(ctx, "roles.save", "role", result.id, input);
    refresh(slug);
    return result;
  });
}

export async function deleteRoleAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await rolesContext(slug);
    await enterprise.roles.remove(ctx.db, id);
    await log(ctx, "roles.delete", "role", id);
    refresh(slug);
    return null;
  });
}

export async function assignRoleAction(slug: string, personId: string, roleId: string | null) {
  return run(async () => {
    const ctx = await rolesContext(slug);
    // Not to oneself, and not a role giving more than one holds
    if (personId === ctx.member.personId) throw new AccessError(403, "accessDenied");
    if (roleId) {
      const role = await ctx.db.customRole.findFirst({ where: { id: roleId }, select: { permissions: true } });
      if (role?.permissions.some((p) => !ctx.can(p as Permission))) throw new AccessError(403, "accessDenied");
    }
    await enterprise.roles.assign(ctx.db, personId, roleId);
    await log(ctx, "members.customRole", "person", personId, { roleId });
    refresh(slug);
    return null;
  });
}

// ---------- Email domains and single sign-on (Enterprise) ----------

async function domainsContext(slug: string) {
  const ctx = await authorize(slug, "workspace.manage");
  if (!domainsOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
  return ctx;
}

export async function addDomainAction(slug: string, domain: string) {
  return run(async () => {
    const ctx = await domainsContext(slug);
    const view = await enterprise.domains.add(ctx.db, ctx.workspace.id, domain);
    await log(ctx, "domains.add", "domain", view.id, { domain: view.domain });
    refresh(slug);
    return view;
  });
}

export async function verifyDomainAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await domainsContext(slug);
    const row = await ctx.db.workspaceDomain.findFirst({ where: { id }, select: { domain: true } });
    if (!row) throw new OpError("notFound");
    if (await domainTakenElsewhere(row.domain, ctx.workspace.id)) throw new OpError("domainTaken");
    const verified = await enterprise.domains.verify(ctx.db, id);
    if (!verified) throw new OpError("domainRecordMissing");
    await log(ctx, "domains.verify", "domain", id, { domain: row.domain });
    refresh(slug);
    return null;
  });
}

export async function updateDomainAction(slug: string, id: string, input: { capture?: boolean; enforceSso?: boolean }) {
  return run(async () => {
    // What the browser sends is anything: only the two switches are read
    const patch = {
      ...(typeof input?.capture === "boolean" ? { capture: input.capture } : {}),
      ...(typeof input?.enforceSso === "boolean" ? { enforceSso: input.enforceSso } : {}),
    };
    const ctx = await domainsContext(slug);
    if (patch.enforceSso && !ssoEnforcementOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
    // Requiring SSO without a provider would lock everyone of the domain out
    if (patch.enforceSso) {
      const row = await ctx.db.workspaceDomain.findFirst({ where: { id }, select: { domain: true } });
      const own =
        row && (await ctx.db.ssoProvider.findMany({ select: { domain: true } })).some((p) => p.domain.split(",").includes(row.domain));
      if (!own && !signInProviders().some((p) => SSO_PROVIDERS.has(p.id))) throw new OpError("ssoNotConfigured");
    }
    await enterprise.domains.update(ctx.db, id, patch);
    // Sessions opened before, another way, end now: the domain's people sign in again through their company
    // (the administrator turning it on keeps theirs, to check the result)
    let signedOut = 0;
    if (patch.enforceSso) {
      const row = await ctx.db.workspaceDomain.findFirst({ where: { id }, select: { domain: true } });
      const current = (await auth.api.getSession({ headers: await headers() }))?.session.id;
      if (row) signedOut = await endDomainSessions(row.domain, current);
    }
    await log(ctx, "domains.update", "domain", id, { ...patch, ...(patch.enforceSso ? { signedOut } : {}) });
    refresh(slug);
    return null;
  });
}

export async function removeDomainAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await domainsContext(slug);
    await enterprise.domains.remove(ctx.db, id);
    await log(ctx, "domains.remove", "domain", id);
    refresh(slug);
    return null;
  });
}

// ---------- Identity providers of the workspace (Enterprise) ----------

async function ssoContext(slug: string) {
  const ctx = await authorize(slug, "workspace.manage");
  if (!(await identityHost.allowed("identity.saml", ctx.workspace.id))) throw new AccessError(403, "featureNotInPlan");
  return ctx;
}

export async function addSsoProviderAction(slug: string, input: SsoProviderInput) {
  return run(async () => {
    const ctx = await ssoContext(slug);
    const name = input.name.trim().slice(0, 60);
    if (!name || !(input.oidc || input.saml)) throw new OpError("invalidRequest", { details: "name and settings" });
    // A provider only signs in addresses of domains this workspace verified
    const domains = [...new Set(input.domains.map((d) => d.trim().toLowerCase()).filter(Boolean))];
    const verified = await ctx.db.workspaceDomain.findMany({
      where: { domain: { in: domains }, verifiedAt: { not: null } },
      select: { domain: true },
    });
    if (!domains.length || verified.length !== domains.length) throw new OpError("ssoDomainNotVerified");
    // The provider's addresses: https, and never one of the server's own network (the library fetches them itself)
    for (const u of input.oidc ? [input.oidc.discoveryUrl, input.oidc.issuer] : [input.saml?.entryPoint]) {
      if (!u) continue;
      if (!/^https:\/\//i.test(u.trim())) throw new OpError("ssoProviderRefused", { details: "https://" });
      await assertPublicUrl(u.trim()).catch(() => {
        throw new OpError("ssoProviderRefused", { details: new URL(u.trim()).host });
      });
    }
    const providerId = `ws-${ctx.workspace.slug}-${randomBytes(3).toString("hex")}`;
    const reg = enterprise.identity.ssoRegistration({ ...input, name, domains }, { appUrl: await publicUrl(""), providerId });
    const h = new Headers(await headers());
    h.set(INTERNAL_HEADER, INTERNAL_TOKEN);
    // The plugin's endpoints are added at runtime (Enterprise build): not in the typed API
    const api = auth.api as unknown as { registerSSOProvider: (args: { body: unknown; headers: Headers }) => Promise<unknown> };
    const register = () => api.registerSSOProvider({ body: reg.body, headers: h });
    try {
      await (input.oidc ? withPendingOrigin(input.oidc.discoveryUrl || input.oidc.issuer, register) : register());
    } catch (e) {
      throw new OpError("ssoProviderRefused", { details: e instanceof Error ? e.message : String(e) });
    }
    await prisma.ssoProvider.update({ where: { providerId }, data: { workspaceId: ctx.workspace.id, name } });
    refreshTrustedOrigins();
    await log(ctx, "sso.add", "provider", providerId, { name, domains, kind: input.oidc ? "oidc" : "saml" });
    refresh(slug);
    return reg.endpoints;
  });
}

export async function removeSsoProviderAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await ssoContext(slug);
    const { count } = await ctx.db.ssoProvider.deleteMany({ where: { id } });
    if (!count) throw new OpError("notFound");
    refreshTrustedOrigins();
    await log(ctx, "sso.remove", "provider", id);
    refresh(slug);
    return null;
  });
}

// ---------- Company directory (LDAP, Enterprise) ----------

export interface LdapInput {
  url: string;
  startTls: boolean;
  bindDn: string;
  /** null: unchanged */
  bindPassword: string | null;
  baseDn: string;
  userFilter: string;
  emailAttribute: string;
  nameAttribute: string;
  phoneAttribute: string;
  teamAttribute: string;
  birthdayAttribute: string;
  enabled: boolean;
}

async function ldapContext(slug: string) {
  const ctx = await authorize(slug, "workspace.manage");
  if (!(await identityHost.allowed("identity.ldap", ctx.workspace.id))) throw new AccessError(403, "featureNotInPlan");
  return ctx;
}

/** In the cloud, a directory on the server's own network is out of reach (nor probed through the test) */
async function ldapReachable(url: string) {
  await assertPublicHost(new URL(url).hostname).catch(() => {
    throw new OpError("ldapUrlInvalid");
  });
}

function cleanLdap(input: LdapInput) {
  const url = input.url.trim();
  if (!/^ldaps?:\/\/[^\s/]+/i.test(url)) throw new OpError("ldapUrlInvalid");
  if (!input.userFilter.includes("{{email}}")) throw new OpError("ldapFilterInvalid");
  return {
    url,
    startTls: input.startTls,
    bindDn: input.bindDn.trim().slice(0, 500),
    baseDn: input.baseDn.trim().slice(0, 500),
    userFilter: input.userFilter.trim().slice(0, 500),
    emailAttribute: input.emailAttribute.trim().slice(0, 60) || "mail",
    nameAttribute: input.nameAttribute.trim().slice(0, 60) || "cn",
    // Empty: that attribute is not read
    phoneAttribute: input.phoneAttribute.trim().slice(0, 60),
    teamAttribute: input.teamAttribute.trim().slice(0, 60),
    birthdayAttribute: input.birthdayAttribute.trim().slice(0, 60),
    enabled: input.enabled,
  };
}

export async function saveLdapAction(slug: string, input: LdapInput) {
  return run(async () => {
    const ctx = await ldapContext(slug);
    const data = cleanLdap(input);
    await ldapReachable(data.url);
    if (input.bindPassword !== null && input.bindPassword && !canEncrypt()) throw new OpError("encryptionNotConfigured");
    const secret = input.bindPassword === null ? {} : { bindPassword: input.bindPassword ? encryptSecret(input.bindPassword) : "" };
    await ctx.db.ldapDirectory.upsert({
      where: { workspaceId: ctx.workspace.id },
      create: { workspaceId: ctx.workspace.id, ...data, ...secret },
      update: { ...data, ...secret },
    });
    await log(ctx, "ldap.save", "directory", null, { ...data, bindPassword: input.bindPassword === null ? undefined : "set" });
    refresh(slug);
    return null;
  });
}

/** Tries the saved directory with an address: how many people it finds */
export async function testLdapAction(slug: string, sampleEmail: string) {
  return run(async () => {
    const ctx = await ldapContext(slug);
    const d = await ctx.db.ldapDirectory.findFirst({});
    if (!d) throw new OpError("notFound");
    await ldapReachable(d.url);
    return enterprise.identity.ldapTest({ ...d, bindPassword: decryptSecret(d.bindPassword) }, sampleEmail);
  });
}

export async function removeLdapAction(slug: string) {
  return run(async () => {
    const ctx = await ldapContext(slug);
    await ctx.db.ldapDirectory.deleteMany({});
    await log(ctx, "ldap.remove", "directory", null);
    refresh(slug);
    return null;
  });
}

// ---------- SCIM provisioning (Enterprise) ----------

async function scimContext(slug: string) {
  const ctx = await authorize(slug, "workspace.manage");
  if (!(await identityHost.allowed("identity.scim", ctx.workspace.id))) throw new AccessError(403, "featureNotInPlan");
  return ctx;
}

/** A new provisioning token: returned once, only its hash is kept */
export async function createScimTokenAction(slug: string, name: string) {
  return run(async () => {
    const ctx = await scimContext(slug);
    const label = name.trim().slice(0, 60) || "SCIM";
    const { token, hash, prefix } = newScimToken();
    const row = await ctx.db.scimToken.create({ data: { workspaceId: ctx.workspace.id, name: label, tokenHash: hash, prefix } });
    await log(ctx, "scim.tokenCreate", "token", row.id, { name: label });
    refresh(slug);
    return { token };
  });
}

export async function revokeScimTokenAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await scimContext(slug);
    const { count } = await ctx.db.scimToken.deleteMany({ where: { id } });
    if (!count) throw new OpError("notFound");
    await log(ctx, "scim.tokenRevoke", "token", id);
    refresh(slug);
    return null;
  });
}

// ---------- Insights by email (Team) ----------

export async function saveReportsAction(
  slug: string,
  input: { frequency: "off" | "weekly" | "monthly"; recipients: "admins" | "custom"; emails: string },
) {
  return run(async () => {
    const ctx = await authorize(slug, "workspace.manage");
    if (!reportsOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
    const emails = [
      ...new Set(
        input.emails
          .split(/[\s,;]+/)
          .map((e) => e.trim().toLowerCase())
          .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)),
      ),
    ].slice(0, 50);
    if (input.recipients === "custom" && input.frequency !== "off" && !emails.length) throw new OpError("reportNoRecipient");
    const { reports: previous, ...rest } = ctx.workspace.settings;
    const settings =
      input.frequency === "off"
        ? rest
        : {
            ...rest,
            reports: {
              frequency: input.frequency,
              recipients: input.recipients,
              emails,
              ...(previous?.lastSentFor ? { lastSentFor: previous.lastSentFor } : {}),
            },
          };
    await prisma.workspace.update({ where: { id: ctx.workspace.id }, data: { settings } });
    await log(ctx, "reports.save", "workspace", ctx.workspace.id, {
      frequency: input.frequency,
      recipients: input.recipients,
      emails: emails.length,
    });
    refresh(slug);
    return null;
  });
}

/** The report of the past week, now, to the person asking */
export async function sendTestReportAction(slug: string) {
  return run(async () => {
    const ctx = await authorize(slug, "workspace.manage");
    if (!reportsOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    await sendReport({ ...ctx.workspace }, { from, to }, [ctx.user.email]);
    return { email: ctx.user.email };
  });
}

/** Moves a follow-up action forward from the actions page, with the same rules as in the meeting */
export async function setActionStatusAction(slug: string, actionId: string, status: "open" | "doing" | "done") {
  return run(async () => {
    const ctx = await authorize(slug);
    const action = await ctx.db.action.findFirst({ where: { id: actionId }, select: { meetingId: true } });
    const meeting = action && (await meetingContext(slug, action.meetingId));
    if (!meeting) throw new AccessError(403, "accessDenied");
    await runOp(meeting, { op: "action.update", id: actionId, status });
    revalidatePath(`/w/${slug}/actions`);
    return null;
  });
}

// ---------- AI assistant (Team) ----------

/** Turns the assistant on or off, picks the model; the key is kept (undefined), replaced, or removed ("") */
export async function saveAiAction(slug: string, input: { enabled: boolean; model: string; key?: string }) {
  return run(async () => {
    const ctx = await authorize(slug, "workspace.manage");
    if (!aiOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
    if (!(AI_MODELS as readonly string[]).includes(input.model)) throw new OpError("invalidRequest");
    const previous = ctx.workspace.settings.ai;
    let key = previous?.key ?? "";
    if (input.key !== undefined) {
      const plain = input.key.trim();
      if (plain && !canEncrypt()) throw new OpError("encryptionNotConfigured");
      key = plain ? encryptSecret(plain.slice(0, 300)) : "";
    }
    const settings = { ...ctx.workspace.settings, ai: { enabled: input.enabled, model: input.model, key } };
    await prisma.workspace.update({ where: { id: ctx.workspace.id }, data: { settings } });
    // The key itself never goes to the audit log
    await log(ctx, "ai.settings", "workspace", ctx.workspace.id, { enabled: input.enabled, model: input.model, ownKey: !!key });
    refresh(slug);
    return null;
  });
}

/** Asks the provider for a one-line summary, to check the key and the model */
export async function testAiAction(slug: string) {
  return run(async () => {
    const ctx = await authorize(slug, "workspace.manage");
    if (!aiOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
    const config = aiConfig(ctx.workspace.settings, ctx.workspace);
    if (!config) throw new OpError("aiNotConfigured");
    try {
      return await enterprise.ai.summarize(
        {
          meeting: "Test",
          minutes: "## Done\n- The AI assistant of Ronde is set up.",
          locale: resolveLocale(ctx.workspace.locale),
        },
        config,
      );
    } catch (e) {
      const code = (e as { code?: string }).code;
      throw new OpError(code === "aiKey" ? "aiKey" : "aiUnavailable");
    }
  });
}

// ---------- Issue trackers (Team) ----------

export async function saveTrackerAction(slug: string, input: TrackerInput) {
  return run(async () => {
    const ctx = await authorize(slug, "connectors.manage");
    if (!trackersOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
    const res = await saveTracker(ctx, input);
    refresh(slug);
    return res;
  });
}

export async function deleteTrackerAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await authorize(slug, "connectors.manage");
    await deleteTracker(ctx, id);
    refresh(slug);
    return null;
  });
}

export async function testTrackerAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await authorize(slug, "connectors.manage");
    if (!trackersOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
    const res = await testTracker(ctx, id);
    if (!res.ok) throw new OpError("ticketFailed", { detail: res.error });
    return null;
  });
}

/** Opens the ticket of a follow-up action in one of the workspace's trackers */
export async function createTicketAction(slug: string, actionId: string, trackerId: string) {
  return run(async () => {
    const ctx = await authorize(slug);
    const ref = await createTicket(ctx, actionId, trackerId);
    revalidatePath(`/w/${slug}/actions`);
    return { key: ref.key, url: ref.url };
  });
}

// ---------- Slack app (Team) ----------

export async function setSlackRemindersAction(slug: string, on: boolean) {
  return run(async () => {
    const ctx = await authorize(slug, "connectors.manage");
    await setSlackReminders(ctx, on === true);
    refresh(slug);
    return null;
  });
}

export async function disconnectSlackAction(slug: string) {
  return run(async () => {
    const ctx = await authorize(slug, "connectors.manage");
    await disconnectSlack(ctx);
    refresh(slug);
    return null;
  });
}

// ---------- Video accounts (Team) ----------

export async function saveVideoAccountAction(slug: string, input: VideoAccountInput) {
  return run(async () => {
    const ctx = await authorize(slug, "connectors.manage");
    if (!videoLinksOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
    const res = await saveVideoAccount(ctx, input);
    refresh(slug);
    return res;
  });
}

export async function deleteVideoAccountAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await authorize(slug, "connectors.manage");
    await deleteVideoAccount(ctx, id);
    refresh(slug);
    return null;
  });
}

export async function testVideoAccountAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await authorize(slug, "connectors.manage");
    if (!videoLinksOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
    const res = await testVideoAccount(ctx, id);
    if (!res.ok) throw new OpError("videoRoomFailed", { detail: res.error });
    return null;
  });
}

/** Opens the lasting room of a meeting with a video account of the workspace: its link becomes the meeting's */
export async function createVideoRoomAction(slug: string, meetingId: string, accountId: string) {
  return run(async () => {
    await authorize(slug);
    const m = await meetingContext(slug, meetingId);
    if (!m) throw new AccessError(403, "accessDenied");
    return createMeetingRoom(m, accountId);
  });
}

// ---------- Calendars (Team) ----------

export async function saveCalendarAccountAction(slug: string, input: CalendarAccountInput) {
  return run(async () => {
    const ctx = await authorize(slug, "connectors.manage");
    if (!calendarSyncOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
    const res = await saveCalendarAccount(ctx, input);
    refresh(slug);
    return res;
  });
}

export async function deleteCalendarAccountAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await authorize(slug, "connectors.manage");
    await deleteCalendarAccount(ctx, id);
    refresh(slug);
    return null;
  });
}

export async function testCalendarAccountAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await authorize(slug, "connectors.manage");
    if (!calendarSyncOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
    const res = await testCalendarAccount(ctx, id);
    if (!res.ok) throw new OpError("calendarFailed", { detail: res.error });
    return null;
  });
}

async function meetingFor(slug: string, meetingId: string) {
  await authorize(slug);
  const m = await meetingContext(slug, meetingId);
  if (!m || !m.can("meeting.configure")) throw new AccessError(403, "accessDenied");
  return m;
}

/** The calendar account of a meeting (null: none): its sessions are written, or removed, right away */
export async function setMeetingCalendarAction(slug: string, meetingId: string, accountId: string | null) {
  return run(async () => setMeetingCalendar(await meetingFor(slug, meetingId), accountId));
}

export async function syncMeetingCalendarAction(slug: string, meetingId: string) {
  return run(async () => {
    const m = await meetingFor(slug, meetingId);
    if (!calendarSyncOn(m.ws.workspace)) throw new AccessError(403, "featureNotInPlan");
    return syncMeetingCalendar(meetingId);
  });
}

export async function meetingAvailabilityAction(slug: string, meetingId: string) {
  return run(async () => meetingAvailability(await meetingFor(slug, meetingId)));
}

// ---------- Microsoft Teams (Team) ----------

/** "Link to Ronde", from the card the Teams app posted in a channel: that team, linked to this workspace */
export async function linkTeamsAction(slug: string, token: string) {
  return run(async () => {
    const ctx = await authorize(slug, "connectors.manage");
    await linkTeams(ctx, token);
    refresh(slug);
    return null;
  });
}

export async function unlinkTeamsAction(slug: string) {
  return run(async () => {
    const ctx = await authorize(slug, "connectors.manage");
    await unlinkTeams(ctx);
    refresh(slug);
    return null;
  });
}

export async function setTeamsRemindersAction(slug: string, on: boolean) {
  return run(async () => {
    const ctx = await authorize(slug, "connectors.manage");
    await setTeamsReminders(ctx, on);
    refresh(slug);
    return null;
  });
}

// ---------- Wikis (Team) ----------

export async function saveWikiAction(slug: string, input: WikiInput) {
  return run(async () => {
    const ctx = await authorize(slug, "connectors.manage");
    if (!wikisOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
    const res = await saveWiki(ctx, input);
    refresh(slug);
    return res;
  });
}

export async function deleteWikiAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await authorize(slug, "connectors.manage");
    await deleteWiki(ctx, id);
    refresh(slug);
    return null;
  });
}

export async function testWikiAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await authorize(slug, "connectors.manage");
    if (!wikisOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
    await testWiki(ctx, id);
    return null;
  });
}

/** The wiki where a meeting publishes its minutes (null: none) */
export async function setMeetingWikiAction(slug: string, meetingId: string, wikiId: string | null) {
  return run(async () => setMeetingWiki(await meetingFor(slug, meetingId), wikiId));
}

/** Publishes the minutes of an archived session now, or updates their page: for the people who edit the minutes */
export async function publishMinutesAction(slug: string, meetingId: string, date: string) {
  return run(async () => {
    await authorize(slug);
    const m = await meetingContext(slug, meetingId);
    if (!m || !m.can("minutes.edit")) throw new AccessError(403, "accessDenied");
    if (!wikisOn(m.ws.workspace)) throw new AccessError(403, "featureNotInPlan");
    const s = await m.ws.db.session.findFirst({ where: { meetingId, date, status: "archived" }, select: { id: true } });
    if (!s) throw new OpError("notFound");
    const page = await publishSession(s.id);
    if (!page) throw new OpError("notFound");
    if (page.error) throw await wikiFailed(page.error);
    return { url: page.url };
  });
}

// ---------- Transcription (Team) ----------

/** The speech-to-text service of the workspace; the key is kept (undefined), replaced, or removed ("") */
export async function saveTranscriptionAction(
  slug: string,
  input: { enabled: boolean; baseUrl: string; model: string; language: string; key?: string },
) {
  return run(async () => {
    const ctx = await authorize(slug, "workspace.manage");
    if (!transcriptionOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
    const baseUrl = input.baseUrl.trim();
    if (baseUrl && !/^https?:\/\/\S+$/.test(baseUrl)) throw new OpError("invalidRequest");
    const previous = ctx.workspace.settings.transcription;
    let key = previous?.key ?? "";
    if (input.key !== undefined) {
      const plain = input.key.trim();
      if (plain && !canEncrypt()) throw new OpError("encryptionNotConfigured");
      key = plain ? encryptSecret(plain.slice(0, 300)) : "";
    }
    const transcription = {
      enabled: input.enabled,
      baseUrl: baseUrl.slice(0, 300),
      model: input.model.trim().slice(0, 100),
      language: /^[a-z]{2}$/.test(input.language) ? input.language : "",
      key,
    };
    await prisma.workspace.update({ where: { id: ctx.workspace.id }, data: { settings: { ...ctx.workspace.settings, transcription } } });
    await log(ctx, "transcription.settings", "workspace", ctx.workspace.id, { enabled: input.enabled, ownKey: !!key });
    refresh(slug);
    return null;
  });
}

// ---------- Billing of the cloud ----------

/** Stripe Checkout for the Team plan, monthly or yearly: the page to go to */
export async function checkoutAction(slug: string, interval: "month" | "year" = "month") {
  return run(async () => startCheckout(await authorize(slug, "workspace.billing"), interval === "year" ? "year" : "month"));
}

/** Stripe's customer portal: the page to go to */
export async function billingPortalAction(slug: string) {
  return run(async () => openPortal(await authorize(slug, "workspace.billing")));
}

export async function addAbsenceAction(slug: string, input: AbsenceInput) {
  return run(async () => {
    // Permission checked inside: everyone sets their own, people managers anyone's
    const ctx = await authorize(slug, "people.read");
    const id = await addAbsence(ctx, input);
    await log(ctx, "people.absence", "person", input.personId, { from: input.from, to: input.to });
    refresh(slug);
    return id;
  });
}

export async function removeAbsenceAction(slug: string, id: string) {
  return run(async () => {
    const ctx = await authorize(slug, "people.read");
    await removeAbsence(ctx, id);
    refresh(slug);
    return null;
  });
}

/** Guest links of a meeting: for the people who manage its participants */
async function guestMeeting(slug: string, meetingId: string) {
  const ctx = await meetingContext(slug, meetingId);
  if (!ctx || !ctx.can("participants.manage")) throw new AccessError(403, "accessDenied");
  return ctx;
}

export async function listGuestLinksAction(slug: string, meetingId: string) {
  return run(async () => listGuestLinks((await guestMeeting(slug, meetingId)).ws.db, meetingId));
}

export async function createGuestLinkAction(slug: string, meetingId: string, input: { label: string; days: number }) {
  return run(async () => {
    const ctx = await guestMeeting(slug, meetingId);
    const link = await createGuestLink(ctx, input);
    await log(ctx.ws, "guests.create", "meeting", meetingId, { label: input.label, days: input.days });
    return { ...link, url: await publicUrl(link.url) };
  });
}

export async function revokeGuestLinkAction(slug: string, meetingId: string, id: string) {
  return run(async () => {
    const ctx = await guestMeeting(slug, meetingId);
    await revokeGuestLink(ctx, id);
    await log(ctx.ws, "guests.revoke", "meeting", meetingId, { id });
    return null;
  });
}

/** The first steps of the home page skipped by the person (`hidden`), or shown again */
export async function setFirstStepsHiddenAction(slug: string, hidden: boolean) {
  return run(async () => {
    const ctx = await authorize(slug);
    const key = firstStepsHidden(ctx.workspace.id);
    if (!hidden) await prisma.userPref.deleteMany({ where: { userId: ctx.user.id, key } });
    else
      await prisma.userPref.upsert({
        where: { userId_key: { userId: ctx.user.id, key } },
        create: { userId: ctx.user.id, key, value: true },
        update: { value: true },
      });
    revalidatePath(`/w/${slug}`);
    return null;
  });
}
