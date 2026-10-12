import "server-only";
import { prisma } from "@ronde/db";
import { joinWorkspace } from "./identity";
import { featureOn, loadLicense, type PlanScope } from "./license";

// Verified email domains of workspaces (Enterprise): new accounts of a captured domain join the workspace,
// and addresses of a domain requiring SSO cannot sign in with a password or an email link.

const domainOf = (email: string) => email.trim().toLowerCase().split("@")[1] ?? "";

export const domainsOn = (ws: PlanScope) => featureOn("identity.domainCapture", ws);
export const ssoEnforcementOn = (ws: PlanScope) => featureOn("identity.enforcedSso", ws);

async function verified(email: string) {
  const domain = domainOf(email);
  if (!domain) return [];
  return prisma.workspaceDomain.findMany({
    where: { domain, verifiedAt: { not: null }, workspace: { deletedAt: null } },
    select: { workspaceId: true, capture: true, enforceSso: true, workspace: { select: { plan: true } } },
  });
}

/** The address must sign in through single sign-on */
export async function ssoRequired(email: string): Promise<boolean> {
  await loadLicense();
  return (await verified(email)).some((d) => d.enforceSso && ssoEnforcementOn(d.workspace));
}

/**
 * Single sign-on just became required for the domain: the sessions its people opened another way end (they sign in
 * again through their company). The session of the administrator who turned it on is kept. Returns how many ended.
 */
export async function endDomainSessions(domain: string, keepSessionId?: string | null): Promise<number> {
  const { count } = await prisma.authSession.deleteMany({
    where: { user: { email: { endsWith: `@${domain}`, mode: "insensitive" } }, ...(keepSessionId ? { NOT: { id: keepSessionId } } : {}) },
  });
  return count;
}

/** A workspace captures this address: its owner may sign up even on an invite-only instance */
export async function captured(email: string): Promise<boolean> {
  await loadLicense();
  return (await verified(email)).some((d) => d.capture && domainsOn(d.workspace));
}

/** A new account joins the workspaces capturing its domain, as a member (its directory card is reused if any) */
export async function captureNewUser(user: { id: string; email: string; name: string }): Promise<void> {
  await loadLicense();
  for (const d of (await verified(user.email)).filter((x) => x.capture && domainsOn(x.workspace)))
    await joinWorkspace(user, d.workspaceId, "members.captured");
}

/** Another workspace already verified this domain: a domain belongs to one workspace */
export async function domainTakenElsewhere(domain: string, workspaceId: string): Promise<boolean> {
  return !!(await prisma.workspaceDomain.findFirst({
    where: { domain, verifiedAt: { not: null }, NOT: { workspaceId }, workspace: { deletedAt: null } },
    select: { id: true },
  }));
}
