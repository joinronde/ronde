import { prisma } from "./client";

// The plan of a workspace in the cloud: the higher of what Stripe says and of the plans granted by hand by
// the Ronde team (education, a commercial gesture, a trial, a partner). Workspace.plan keeps the result, so
// the app reads a single column; billing webhooks, grants and a daily job call refreshPlan to keep it right.

const RANK: Record<string, number> = { community: 0, team: 1, enterprise: 2 };

/** Stripe statuses that keep the paid plan: paying, trying it, or a payment being retried */
export const PAYING_STATUSES = ["active", "trialing", "past_due"];

export interface GrantLike {
  plan: string;
  startsAt: Date;
  endsAt: Date | null;
  revokedAt: Date | null;
}

/** A grant gives its plan from its start until its end, unless it was revoked */
export const grantRuns = (g: GrantLike, now = new Date()) =>
  !g.revokedAt && g.startsAt.getTime() <= now.getTime() && (!g.endsAt || g.endsAt.getTime() > now.getTime());

/** The plan a workspace should have now */
export function effectivePlan(subscription: { status: string; plan: string } | null, grants: GrantLike[], now = new Date()): string {
  let plan = subscription && PAYING_STATUSES.includes(subscription.status) ? subscription.plan : "community";
  for (const g of grants) if (grantRuns(g, now) && (RANK[g.plan] ?? 0) > (RANK[plan] ?? 0)) plan = g.plan;
  return plan;
}

/** Recomputes the plan of one workspace and saves it when it changed; returns the plan */
export async function refreshPlan(workspaceId: string, now = new Date()): Promise<string> {
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { plan: true, subscription: { select: { status: true, plan: true } }, grants: true },
  });
  if (!ws) return "community";
  const plan = effectivePlan(ws.subscription, ws.grants, now);
  if (plan !== ws.plan) await prisma.workspace.update({ where: { id: workspaceId }, data: { plan } });
  return plan;
}

/** Every workspace whose grants or subscription may have moved: grants that start or end, any subscription */
export async function refreshPlans(now = new Date()): Promise<number> {
  const workspaces = await prisma.workspace.findMany({
    where: { OR: [{ grants: { some: {} } }, { subscription: { isNot: null } }, { plan: { not: "community" } }] },
    select: { id: true, plan: true },
  });
  let changed = 0;
  for (const w of workspaces) if ((await refreshPlan(w.id, now)) !== w.plan) changed++;
  return changed;
}
