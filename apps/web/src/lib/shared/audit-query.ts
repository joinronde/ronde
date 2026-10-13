import type { AuditQuery } from "@ronde/editions/ee";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A day of the calendar as written, or nothing: "2026-13-01" would be an invalid date, "2026-02-31" March 3rd */
function dayOf(s: string): string | undefined {
  const at = DAY.test(s) ? Date.parse(`${s}T00:00:00Z`) : Number.NaN;
  return !Number.isNaN(at) && new Date(at).toISOString().startsWith(s) ? s : undefined;
}

/** Filters of the audit log from the address: ?action=&actor=&from=YYYY-MM-DD&to=YYYY-MM-DD&after= */
export function readAuditQuery(p: URLSearchParams): AuditQuery & { fromDay?: string; toDay?: string } {
  const from = dayOf(p.get("from") ?? "");
  const to = dayOf(p.get("to") ?? "");
  return {
    action: p.get("action")?.trim().slice(0, 80) || undefined,
    actor: p.get("actor")?.trim().slice(0, 100) || undefined,
    from: from ? new Date(`${from}T00:00:00Z`) : undefined,
    to: to ? new Date(`${to}T23:59:59.999Z`) : undefined,
    after: p.get("after") || undefined,
    fromDay: from,
    toDay: to,
  };
}
