import "server-only";
import { prisma, type ScopedClient, type ScopedTx, scoped } from "@ronde/db";
import { hasFeature } from "@ronde/editions";
import type { AuditInput } from "@ronde/editions/ee";
import { currentJobs } from "@ronde/jobs";
import { enterprise } from "@/ee-bridge";
import { type WorkspaceSettings, workspaceContext } from "./authz";
import { featureOn, type PlanScope, readEditionOf } from "./license";
import { outboundFetch } from "./outbound";
import { decryptSecret } from "./secrets";

// Audit log: configuration and membership changes, written where they happen. Team shows the last 90 days;
// Enterprise the whole history, and streams it to a SIEM. Without the feature in the plan, nothing is
// written; an expired license keeps the log readable.

type Actor = { id: string; name: string; email: string } | null;

export const auditOn = (ws: PlanScope) => featureOn("compliance.auditLog", ws);
export const auditReadable = (ws: PlanScope) => hasFeature(readEditionOf(ws), "compliance.auditLog");
/** The whole history and the SIEM stream (Enterprise) */
export const auditStreamOn = (ws: PlanScope) => featureOn("compliance.auditStream", ws);

/** Days of the log shown without the whole history */
export const AUDIT_DAYS = 90;

/** Oldest moment of the log shown: none with the whole history, 90 days back otherwise */
export const auditSince = (ws: PlanScope, now = Date.now()): Date | null =>
  hasFeature(readEditionOf(ws), "compliance.auditStream") ? null : new Date(now - AUDIT_DAYS * 86_400_000);

/** The filters of a query, held to what the plan shows */
export const withinPlan = <Q extends { from?: Date }>(ws: PlanScope, q: Q): Q => {
  const since = auditSince(ws);
  return since && (!q.from || q.from < since) ? { ...q, from: since } : q;
};

const label = (u: Actor) => (!u ? "Ronde" : u.email ? `${u.name || u.email} <${u.email}>` : u.name);

/** Keeps an action in the workspace's log, then hands it to its SIEM stream when one is set */
export async function audit(
  ws: { workspace: { id: string; plan?: string; settings?: WorkspaceSettings }; user: Actor },
  db: ScopedClient | ScopedTx,
  entry: Omit<AuditInput, "actorUserId" | "actorLabel">,
): Promise<void> {
  if (!auditOn(ws.workspace)) return;
  const id = await enterprise.audit.record(db, ws.workspace.id, { actorUserId: ws.user?.id ?? null, actorLabel: label(ws.user), ...entry });
  if (!id || !ws.workspace.settings?.auditStream?.connectorId || !auditStreamOn(ws.workspace)) return;
  const jobs = currentJobs();
  if (jobs) await (await jobs).send("audit.stream", { workspaceId: ws.workspace.id, auditId: id }, { singletonKey: id });
}

/** Someone joined a workspace through an invitation: kept in its log; returns what it is given */
export async function auditJoin<T extends { slug: string }>(joined: T): Promise<T> {
  const ctx = await workspaceContext(joined.slug);
  if (ctx)
    await audit(ctx, ctx.db, {
      action: "members.join",
      targetType: "person",
      targetId: ctx.member.personId,
      data: { role: ctx.member.role },
    });
  return joined;
}

/** Job: sends one entry to the workspace's SIEM endpoint (a webhook connector); retried on failure */
export async function streamAudit({ workspaceId, auditId }: { workspaceId: string; auditId: string }): Promise<void> {
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { slug: true, plan: true, settings: true } });
  if (!auditStreamOn(workspace)) return;
  const connectorId = ((workspace?.settings ?? {}) as WorkspaceSettings).auditStream?.connectorId;
  if (!workspace || !connectorId) return;
  const db = scoped(prisma, workspaceId);
  const [row, connector] = await Promise.all([
    db.auditLog.findFirst({ where: { id: auditId } }),
    db.connector.findFirst({ where: { id: connectorId, kind: "webhook" } }),
  ]);
  // Not committed yet: the retry finds it
  if (!row) throw new Error(`audit entry ${auditId} not found yet`);
  if (!connector) return;
  const url = String((connector.config as { url?: unknown }).url ?? "");
  await enterprise.audit.stream(
    { ...row, createdAt: row.createdAt.toISOString() },
    { url, secret: decryptSecret(connector.secret), workspace: workspace.slug },
    outboundFetch,
  );
}
