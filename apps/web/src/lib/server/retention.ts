import "server-only";
import { prisma } from "@ronde/db";
import { AUDIT_DAYS, auditSince } from "./audit";

// How long Ronde keeps what it keeps, as the privacy policy says: a deleted workspace is erased 30 days later
// (time to undo a mistake through support), the audit log 90 days (Enterprise keeps its whole history, the
// customer's compliance record, until the workspace goes), records of
// notifications sent 90 days, the bell's items 180 days, expired sign-in sessions and links not at all, Stripe's
// event ids a year (enough to ignore their retries).

const DAY = 86_400_000;
export const RETENTION = {
  deletedWorkspaceDays: 30,
  auditDays: AUDIT_DAYS,
  deliveryDays: 90,
  inboxDays: 180,
  stripeEventDays: 365,
} as const;

/** Every night: erases what is past its time. Returns how many rows went, by kind. */
export async function purgeExpired(now = Date.now()): Promise<Record<string, number>> {
  const before = (days: number) => new Date(now - days * DAY);
  const out: Record<string, number> = {};
  // Workspaces deleted a month ago, with everything they hold (their rows go with them)
  const gone = await prisma.workspace.findMany({
    where: { deletedAt: { lt: before(RETENTION.deletedWorkspaceDays) } },
    select: { id: true },
  });
  for (const w of gone) {
    try {
      await prisma.workspace.delete({ where: { id: w.id } });
    } catch (e) {
      console.error(`[retention] erasing workspace ${w.id}`, e);
    }
  }
  out.workspaces = gone.length;
  // The audit log beyond 90 days, unless the workspace keeps its whole history (Enterprise)
  out.audit = 0;
  const logged = await prisma.auditLog.groupBy({ by: ["workspaceId"], where: { createdAt: { lt: before(RETENTION.auditDays) } } });
  for (const { workspaceId } of logged) {
    const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { plan: true } });
    if (ws && auditSince(ws, now) === null) continue;
    out.audit += (await prisma.auditLog.deleteMany({ where: { workspaceId, createdAt: { lt: before(RETENTION.auditDays) } } })).count;
  }
  out.deliveries = (await prisma.delivery.deleteMany({ where: { createdAt: { lt: before(RETENTION.deliveryDays) } } })).count;
  out.inbox = (await prisma.inboxItem.deleteMany({ where: { createdAt: { lt: before(RETENTION.inboxDays) } } })).count;
  out.sessions = (await prisma.authSession.deleteMany({ where: { expiresAt: { lt: new Date(now) } } })).count;
  out.verifications = (await prisma.verification.deleteMany({ where: { expiresAt: { lt: new Date(now) } } })).count;
  out.stripeEvents = (await prisma.stripeEvent.deleteMany({ where: { receivedAt: { lt: before(RETENTION.stripeEventDays) } } })).count;
  return out;
}
