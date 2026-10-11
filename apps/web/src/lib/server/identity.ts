import "server-only";
import { randomUUID } from "node:crypto";
import { prisma, scoped } from "@ronde/db";
import { hasFeature } from "@ronde/editions";
import type { IdentityHost } from "@ronde/editions/ee";
import { audit } from "./audit";
import { env } from "./env";
import { edition, loadLicense } from "./license";
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
    where: { domain: domainOf(email), verifiedAt: { not: null }, workspace: { deletedAt: null } },
    select: { workspaceId: true },
  });
  return rows.map((r) => r.workspaceId);
}

const allowed = async (feature: "identity.saml" | "identity.ldap" | "identity.scim") => {
  await loadLicense();
  return hasFeature(edition(), feature);
};

export const identityHost: IdentityHost = {
  allowed,
  joinWorkspace: (user, workspaceId) => joinWorkspace(user, workspaceId, "members.sso"),
  ldapDirectoryFor: async (email) => {
    const workspaces = await verifiedWorkspaces(email);
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
  if ((await allowed("identity.ldap")) && (await prisma.ldapDirectory.count({ where: { workspaceId: { in: workspaces }, enabled: true } })))
    return true;
  if (!(await allowed("identity.saml"))) return false;
  const providers = await prisma.ssoProvider.findMany({ where: { workspaceId: { in: workspaces } }, select: { domain: true } });
  return providers.some((p) => p.domain.split(",").includes(domainOf(email)));
}

/** Some workspace of the instance signs its people in through its company directory */
export async function companyLdapAvailable(): Promise<boolean> {
  return (await allowed("identity.ldap")) && (await prisma.ldapDirectory.count({ where: { enabled: true } })) > 0;
}

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

/** Origins Better Auth trusts: the app's, and those of the workspaces' identity providers (read every 30 s) */
export async function trustedOrigins(): Promise<string[]> {
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
  return [...new Set([...(env.appUrl() ? [new URL(env.appUrl()).origin] : []), ...pending, ...providerOrigins.list])];
}

/** Some workspace of the instance signs its people in with its own provider (Enterprise license in force) */
export async function companySsoAvailable(): Promise<boolean> {
  if (!(await identityHost.allowed("identity.saml"))) return false;
  return (await prisma.ssoProvider.count({ where: { workspaceId: { not: null } } })) > 0;
}
