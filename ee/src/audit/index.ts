// SPDX-License-Identifier: LicenseRef-Ronde-EE
// Audit log: who did what in a workspace, searchable, exported as CSV, streamed to a SIEM.

import { isSafeUrl, signWebhook } from "@ronde/connectors";
import type { ScopedClient, ScopedTx } from "@ronde/db";
import type { AuditInput, AuditQuery, AuditRow, EnterpriseEdition } from "@ronde/editions/ee";

type Db = ScopedClient | ScopedTx;

const SECRET_KEY = /token|secret|password|passwd|apikey|api_key|signing|private|credential/i;
/** Personal details nobody needs in a log: kept out whatever the caller passes */
const PERSONAL_KEY = /^(phone|birthday|birthdate|mobile)$/i;
const MAX_STRING = 500;

/** Details as they are kept: secrets replaced, long texts cut, depth limited */
export function sanitize(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 4) return "…";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitize(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50))
      out[k] = SECRET_KEY.test(k) || PERSONAL_KEY.test(k) ? (v ? "[hidden]" : v) : sanitize(v, depth + 1);
    return out;
  }
  return String(value);
}

const toRow = (r: {
  id: string;
  actorUserId: string | null;
  actorLabel: string;
  action: string;
  targetType: string;
  targetId: string | null;
  meetingId: string | null;
  data: unknown;
  createdAt: Date;
}): AuditRow => ({ ...r, createdAt: r.createdAt.toISOString() });

async function record(db: Db, workspaceId: string, e: AuditInput): Promise<string | null> {
  const row = await db.auditLog.create({
    data: {
      workspaceId,
      actorUserId: e.actorUserId,
      actorLabel: e.actorLabel.slice(0, 300),
      action: e.action.slice(0, 80),
      targetType: (e.targetType ?? "").slice(0, 40),
      targetId: e.targetId ?? null,
      meetingId: e.meetingId ?? null,
      data: (sanitize(e.data ?? {}) ?? {}) as object,
    },
    select: { id: true },
  });
  return row.id;
}

async function list(db: Db, q: AuditQuery): Promise<{ rows: AuditRow[]; next: string | null }> {
  const limit = Math.min(Math.max(q.limit ?? 50, 1), 1000);
  const rows = await db.auditLog.findMany({
    where: {
      ...(q.action ? { action: { startsWith: q.action } } : {}),
      ...(q.actor ? { actorLabel: { contains: q.actor, mode: "insensitive" as const } } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    },
    // uuid v7 ids grow with time: newest first, and a stable cursor
    orderBy: { id: "desc" },
    take: limit + 1,
    ...(q.after ? { cursor: { id: q.after }, skip: 1 } : {}),
  });
  const page = rows.slice(0, limit).map(toRow);
  return { rows: page, next: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null };
}

/** A CSV cell: quoted, and never read as a formula by a spreadsheet */
const cell = (v: unknown) => {
  const s = typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

function toCsv(rows: AuditRow[]): string {
  const head = ["date", "actor", "action", "target_type", "target_id", "meeting_id", "details"];
  const lines = rows.map((r) => [r.createdAt, r.actorLabel, r.action, r.targetType, r.targetId, r.meetingId, r.data].map(cell).join(","));
  return `${[head.join(","), ...lines].join("\r\n")}\r\n`;
}

async function stream(row: AuditRow, target: { url: string; secret: string; workspace: string }, fetcher: typeof fetch = fetch) {
  if (!isSafeUrl(target.url)) throw new Error("unsafe audit stream address");
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ id: row.id, event: "audit", occurredAt: row.createdAt, workspace: target.workspace, entry: row });
  const res = await fetcher(target.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Ronde-Event": "audit",
      "X-Ronde-Delivery": row.id,
      "X-Ronde-Timestamp": timestamp,
      "X-Ronde-Signature": `sha256=${signWebhook(target.secret, timestamp, body)}`,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`audit stream answered ${res.status}`);
}

export const audit: EnterpriseEdition["audit"] = { record, list, toCsv, stream };
