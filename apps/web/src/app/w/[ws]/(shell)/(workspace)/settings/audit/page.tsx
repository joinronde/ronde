import { getTranslations } from "next-intl/server";
import { PlanNotice } from "@/components/plan-notice";
import { AuditLogView } from "@/components/workspace/audit-log";
import { enterprise } from "@/ee-bridge";
import { AUDIT_DAYS, auditReadable, auditSince, auditStreamOn, withinPlan } from "@/lib/server/audit";
import { pageWorkspace } from "@/lib/server/authz";
import { listConnectors } from "@/lib/server/notify/connectors";
import { plansUrl } from "@/lib/server/plans";
import { readAuditQuery } from "@/lib/shared/audit-query";

export async function generateMetadata() {
  const t = await getTranslations("audit");
  return { title: `${t("title")} · Ronde` };
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const ctx = await pageWorkspace((await params).ws, "audit.read");
  if (!auditReadable(ctx.workspace)) return <PlanNotice feature="compliance.auditLog" plansUrl={await plansUrl(ctx)} />;
  const filters = readAuditQuery(new URLSearchParams(await searchParams));
  const page = await enterprise.audit.list(ctx.db, { ...withinPlan(ctx.workspace, filters), limit: 50 });
  const webhooks =
    ctx.can("workspace.manage") && auditStreamOn(ctx.workspace) ? (await listConnectors(ctx)).filter((c) => c.kind === "webhook") : null;
  return (
    <AuditLogView
      slug={ctx.workspace.slug}
      rows={page.rows}
      next={page.next}
      days={auditSince(ctx.workspace) ? AUDIT_DAYS : null}
      filters={{ action: filters.action ?? "", actor: filters.actor ?? "", from: filters.fromDay ?? "", to: filters.toDay ?? "" }}
      stream={
        webhooks && {
          connectors: webhooks.map((c) => ({ id: c.id, name: c.name })),
          current: ctx.workspace.settings.auditStream?.connectorId ?? "",
        }
      }
    />
  );
}
