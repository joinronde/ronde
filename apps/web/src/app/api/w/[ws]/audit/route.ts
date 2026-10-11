import { enterprise } from "@/ee-bridge";
import { auditReadable, withinPlan } from "@/lib/server/audit";
import { authorize } from "@/lib/server/authz";
import { AccessError } from "@/lib/server/errors";
import { errorResponse } from "@/lib/server/http";
import { readAuditQuery } from "@/lib/shared/audit-query";

export const dynamic = "force-dynamic";

/** Most entries in one export */
const MAX_ROWS = 50_000;

// Audit log as CSV, with the filters of the page (?action=&actor=&from=&to=)
export async function GET(req: Request, { params }: { params: Promise<{ ws: string }> }) {
  try {
    const ctx = await authorize((await params).ws, "audit.read");
    if (!auditReadable(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
    const { after: _after, ...filters } = withinPlan(ctx.workspace, readAuditQuery(new URL(req.url).searchParams));
    const rows = [];
    let after: string | undefined;
    do {
      const page = await enterprise.audit.list(ctx.db, { ...filters, after, limit: 1000 });
      rows.push(...page.rows);
      after = page.next ?? undefined;
    } while (after && rows.length < MAX_ROWS);
    const day = new Date().toISOString().slice(0, 10);
    return new Response(enterprise.audit.toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-${ctx.workspace.slug}-${day}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
