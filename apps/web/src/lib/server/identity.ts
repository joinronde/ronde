import "server-only";
import { randomUUID } from "node:crypto";
import { prisma, scoped } from "@ronde/db";
import { EDITIONS, hasFeature } from "@ronde/editions";
import type { IdentityHost } from "@ronde/editions/ee";
import { audit } from "./audit";
import { env } from "./env";
import { edition, featureOn, isCloud, loadLicense } from "./license";
import { decryptSecret } from "./secrets";

// Identity of the paid editions, as the core sees it: what the Enterprise sign-in code may ask, and the
// guard around the SSO plugin's administration endpoints (only Ronde's own server may call them).

/** Marks the SSO plugin calls made by this server; changes at every start, never leaves the process */
export const INTERNAL_TOKEN = randomUUID();
export const INTERNAL_HEADER = "x-ronde-internal";

/** Administration paths of the SSO plugin: refused unless called by this server */
export const SSO_ADMIN_PATHS = [
  "/sso/register",
  "/sso/update-provider",
  "/sso/delete-provider",
  "/sso/request-domain-verification",
  "/sso/verify-domain",
];

const domainOf = (email: string) => email.trim().toLowerCase().split("@")[1] ?? "";

/** Joins a workspace as a member (a directory card with the same address is reused) */
export async function joinWorkspace(user: { id: string; email: string; name: string }, workspaceId: string, reason: string): Promise<void> {
  if (await prisma.workspaceMember.findFirst({ where: { workspaceId, userId: user.id }, select: { id: true } })) return;
  const email = user.email.trim().toLowerCase();
  const existing = await prisma.person.findFirst({ where: { workspaceId, email: { equals: email, mode: "insensitive" } } });
  // Removed by the company directory: signing in does not bring them back (an invitation still can)
  if (existing?.deprovisionedAt) return;
  const [firstName, ...rest] = (user.name || email.split("@")[0]!).trim().split(/\s+/);
  const person =
    existing ??
    (await prisma.person.create({
      data: { workspaceId, email, firstName: firstName ?? email, lastName: rest.join(" "), color: Math.floor(Math.random() * 6) },
    }));
  if (!person.userId) await prisma.person.update({ where: { id: person.id }, data: { userId: user.id } });
  if (await prisma.workspaceMember.findFirst({ where: { personId: person.id }, select: { id: true } })) return;
  await prisma.workspaceMember.create({ data: { workspaceId, userId: user.id, personId: person.id, role: "member" } });
  await audit({ workspace: { id: workspaceId }, user }, scoped(prisma, workspaceId), {
    action: reason,
    targetType: "person",
    targetId: person.id,
    data: { domain: domainOf(email) },
  });
}

/** Workspaces that verified the address's domain */
async function verifiedWorkspaces(email: string): Promise<string[]> {
  const rows = await prisma.workspaceDomain.findMany({
    where: { domain: domainOf(email), verifiedAt: { not: null }, workspace: { deletedAt: null, suspendedAt: null } },
    select: { workspaceId: true },
  });
  return rows.map((r) => r.workspaceId);
}

type IdentityFeature = "identity.saml" | "identity.ldap" | "identity.scim";

/**
 * A workspace may use a sign-in feature: the license of a self-hosted instance, the workspace's own plan in the
 * cloud. Without a workspace, whether any may: in the cloud that is decided workspace by workspace afterwards.
 */
const allowed = async (feature: IdentityFeature, workspaceId: string | null): Promise<boolean> => {
  if (!isCloud()) {
    await loadLicense();
    return hasFeature(edition(), feature);
  }
  if (workspaceId === null) return true;
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { plan: true, deletedAt: true } });
  return !!ws && !ws.deletedAt && featureOn(feature, ws);
};

/** The workspaces among these that may use the feature */
async function allowedAmong(feature: IdentityFeature, workspaceIds: string[]): Promise<string[]> {
  const ok = await Promise.all(workspaceIds.map((id) => allowed(feature, id)));
  return workspaceIds.filter((_, i) => ok[i]);
}

export const identityHost: IdentityHost = {
  allowed,
  joinWorkspace: (user, workspaceId) => joinWorkspace(user, workspaceId, "members.sso"),
  ldapDirectoryFor: async (email) => {
    const workspaces = await allowedAmong("identity.ldap", await verifiedWorkspaces(email));
    if (!workspaces.length) return null;
    const d = await prisma.ldapDirectory.findFirst({ where: { workspaceId: { in: workspaces }, enabled: true } });
    return d ? { ...d, bindPassword: decryptSecret(d.bindPassword) } : null;
  },
};

/**
 * The address belongs to a company that signs its people in itself (a verified domain with its own
 * identity provider or directory): its accounts may be created even when sign-up is by invitation.
 */
export async function companyIdentity(email: string): Promise<boolean> {
  const workspaces = await verifiedWorkspaces(email);
  if (!workspaces.length) return false;
  const withLdap = await allowedAmong("identity.ldap", workspaces);
  if (withLdap.length && (await prisma.ldapDirectory.count({ where: { workspaceId: { in: withLdap }, enabled: true } }))) return true;
  const withSso = await allowedAmong("identity.saml", workspaces);
  if (!withSso.length) return false;
  const providers = await prisma.ssoProvider.findMany({ where: { workspaceId: { in: withSso } }, select: { domain: true } });
  return providers.some((p) => p.domain.split(",").includes(domainOf(email)));
}

/** Some workspace of the instance signs its people in through its company directory */
export async function companyLdapAvailable(): Promise<boolean> {
  if (!(await allowed("identity.ldap", null))) return false;
  return (await prisma.ldapDirectory.count({ where: { enabled: true, workspace: inPlan("identity.ldap") } })) > 0;
}

/** Workspaces still there whose plan has the feature (in the cloud; a server's license was checked already) */
const inPlan = (feature: IdentityFeature) => ({
  deletedAt: null,
  ...(isCloud() ? { plan: { in: EDITIONS.filter((e) => hasFeature(e, feature)) } } : {}),
});

/** Origins of identity providers being registered, trusted for their discovery document */
const pending = new Set<string>();
export async function withPendingOrigin<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const origin = new URL(url).origin;
  pending.add(origin);
  try {
    return await fn();
  } finally {
    pending.delete(origin);
  }
}

let providerOrigins: { at: number; list: string[] } = { at: 0, list: [] };

/** Forgets the cached origins: a provider was added or removed */
export const refreshTrustedOrigins = () => {
  providerOrigins = { at: 0, list: [] };
};

/**
 * Origins Better Auth trusts: the app's, and for single sign-on only those of the workspaces' identity providers
 * (read every 30 s). Anywhere else (a password reset's redirect, a callback address) a provider a workspace
 * registered is not trusted: its administrator could otherwise send another person's reset link to it.
 */
export async function trustedOrigins(request?: Request): Promise<string[]> {
  const own = env.appUrl() ? [new URL(env.appUrl()).origin] : [];
  // Single sign-on only: signing in, the provider's way back, and the server's own calls registering one (a
  // provider being registered is trusted there only, never for a reset link's way back or anything else)
  if (request && !/\/sign-in\/sso$|\/sso\//.test(new URL(request.url).pathname)) return own;
  own.push(...pending);
  if (Date.now() - providerOrigins.at > 30_000) {
    const rows = await prisma.ssoProvider.findMany({ where: { oidcConfig: { not: null } }, select: { issuer: true } }).catch(() => []);
    const list: string[] = [];
    for (const p of rows) {
      try {
        list.push(new URL(p.issuer).origin);
      } catch {}
    }
    providerOrigins = { at: Date.now(), list };
  }
  return [...new Set([...own, ...providerOrigins.list])];
}

/** Some workspace of the instance signs its people in with its own provider (Enterprise license in force) */
export async function companySsoAvailable(): Promise<boolean> {
  if (!(await allowed("identity.saml", null))) return false;
  return (await prisma.ssoProvider.count({ where: { workspaceId: { not: null }, workspace: inPlan("identity.saml") } })) > 0;
}
