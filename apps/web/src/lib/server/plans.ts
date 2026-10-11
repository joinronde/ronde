import "server-only";
import type { WorkspaceRole } from "@ronde/core/permissions";
import { prisma } from "@ronde/db";
import { FEATURES, type FeatureId, hasFeature } from "@ronde/editions";
import { HIDE_UPGRADE_HINTS } from "@/lib/shared/prefs";
import type { WorkspaceContext } from "./authz";
import { billingOn } from "./billing";
import { env } from "./env";
import { editionOf, type PlanScope, readEditionOf } from "./license";

/**
 * Where a person sees the paid plans: the workspace's billing page for the ones who pay (owner and billing, in
 * the cloud, where a workspace changes its plan there, once payments are set up), the public pricing for the
 * administrators and wherever payments are not set up; nothing for the others, nor where the suggestions are
 * turned off for the instance or the workspace already has Enterprise
 */
export function upgradeTarget(ws: PlanScope & { slug: string }, role: WorkspaceRole): string | null {
  if (!["owner", "admin", "billing"].includes(role) || env.hideUpgradeHints() || editionOf(ws) === "enterprise") return null;
  return billingOn() && role !== "admin" ? `/w/${ws.slug}/settings/billing` : `${env.siteUrl()}/pricing`;
}

/** The same, unless the person turned the suggestions off */
export async function plansUrl(ctx: Pick<WorkspaceContext, "member" | "user" | "workspace">): Promise<string | null> {
  const target = upgradeTarget(ctx.workspace, ctx.member.role);
  if (!target) return null;
  const hidden = await prisma.userPref.findUnique({ where: { userId_key: { userId: ctx.user.id, key: HIDE_UPGRADE_HINTS } } });
  return hidden ? null : target;
}

/** Plan a workspace lacks for a feature: "team" or "enterprise"; null when it has it */
export function lockedEdition(ws: PlanScope, feature: FeatureId): "team" | "enterprise" | null {
  return hasFeature(readEditionOf(ws), feature) ? null : (FEATURES[feature].edition as "team" | "enterprise");
}
