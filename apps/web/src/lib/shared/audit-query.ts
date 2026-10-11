import type { AuditQuery } from "@ronde/editions/ee";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Filters of the audit log from the address: ?action=&actor=&from=YYYY-MM-DD&to=YYYY-MM-DD&after= */
export function readAuditQuery(p: URLSearchParams): AuditQuery & { fromDay?: string; toDay?: string } {
  const from = p.get("from") ?? "";
  const to = p.get("to") ?? "";
  return {
    action: p.get("action")?.trim().slice(0, 80) || undefined,
    actor: p.get("actor")?.trim().slice(0, 100) || undefined,
    from: DAY.test(from) ? new Date(`${from}T00:00:00Z`) : undefined,
    to: DAY.test(to) ? new Date(`${to}T23:59:59.999Z`) : undefined,
    after: p.get("after") || undefined,
    fromDay: DAY.test(from) ? from : undefined,
    toDay: DAY.test(to) ? to : undefined,
  };
}
