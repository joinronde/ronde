import "server-only";
import { parseRecord } from "@ronde/core/record";
import { projectProgress, recurringBlockers, type SessionStats, type StatsDTO } from "@ronde/core/stats";
import { Prisma, prisma } from "@ronde/db";
import type { MeetingCtx } from "./context";
import { personName } from "./dto";

// Stats of a meeting, computed by the database over its archived sessions: their record (frozen at
// archive time) and their check-in items (planned → done through `sourceItemId`). Raw SQL runs on the
// unconfined client, so every query names the workspace and the meeting itself.

const DAY = 86_400_000;
const STALE_DAYS = 21;

/** A JSON array of the record, or an empty one (missing, null) */
const arr = (path: Prisma.Sql) => Prisma.sql`CASE WHEN jsonb_typeof(${path}) = 'array' THEN ${path} ELSE '[]'::jsonb END`;

export async function meetingStats(ctx: MeetingCtx): Promise<StatsDTO> {
  const ws = ctx.ws.workspace.id;
  const m = ctx.meeting.id;
  const archived = Prisma.sql`s."workspaceId" = ${ws} AND s."meetingId" = ${m} AND s."status" = 'archived' AND s."record" IS NOT NULL`;
  const participants = arr(Prisma.sql`s."record" -> 'participants'`);
  const limitMs = ctx.meeting.speakSec * 1000;

  const [sessions, speaking, onTime, actionRows] = await Promise.all([
    prisma.$queryRaw<SessionStats[]>`
      WITH s AS (
        SELECT s."id", s."date", s."record", LAG(s."id") OVER (ORDER BY s."date") AS prev
        FROM "Session" s WHERE ${archived}
      )
      SELECT s."date",
        COALESCE((s."record" ->> 'durationMs')::float8, 0) AS "durationMs",
        jsonb_array_length(${participants})::int AS present,
        jsonb_array_length(${arr(Prisma.sql`s."record" -> 'absent'`)})::int AS absent,
        COALESCE((SELECT array_agg(COALESCE(a ->> 'name', a #>> '{}')) FROM jsonb_array_elements(${arr(Prisma.sql`s."record" -> 'absent'`)}) a), '{}') AS "absentNames",
        (SELECT count(*)::int FROM "CheckInItem" p
          WHERE p."sessionId" = s.prev AND p."role" = 'plan'
            AND p."personId" IN (SELECT x ->> 'id' FROM jsonb_array_elements(${participants}) x)) AS planned,
        (SELECT count(*)::int FROM "CheckInItem" d JOIN "CheckInItem" p ON p."id" = d."sourceItemId"
          WHERE d."sessionId" = s."id" AND d."role" = 'achievement' AND p."sessionId" = s.prev) AS done,
        (SELECT count(*)::int FROM "CheckInItem" b WHERE b."sessionId" = s."id" AND b."role" = 'blocker') AS blockers,
        (SELECT count(*)::int FROM jsonb_array_elements(${arr(Prisma.sql`s."record" -> 'interactions'`)}) i WHERE i ->> 'type' = 'question') AS questions,
        (SELECT count(*)::int FROM jsonb_array_elements(${arr(Prisma.sql`s."record" -> 'interactions'`)}) i WHERE i ->> 'type' = 'hand') AS hands,
        jsonb_array_length(${arr(Prisma.sql`s."record" -> 'kudos'`)})::int AS kudos,
        jsonb_array_length(${arr(Prisma.sql`s."record" -> 'icebreaker' -> 'answers'`)})::int AS answers,
        (s."record" -> 'mood' ->> 'avg')::float8 AS mood,
        COALESCE((SELECT sum(c::int)::int FROM jsonb_array_elements_text(${arr(Prisma.sql`s."record" -> 'mood' -> 'counts'`)}) c), 0) AS "moodVotes",
        (s."record" -> 'rating' ->> 'avg')::float8 AS rating,
        COALESCE((SELECT sum(c::int)::int FROM jsonb_array_elements_text(${arr(Prisma.sql`s."record" -> 'rating' -> 'counts'`)}) c), 0) AS "ratingVotes"
      FROM s ORDER BY s."date"`,
    prisma.$queryRaw<StatsDTO["speaking"]>`
      SELECT pt ->> 'id' AS id, (array_agg(pt ->> 'name' ORDER BY s."date" DESC))[1] AS name,
        avg(COALESCE((s."record" -> 'spent' ->> (pt ->> 'id'))::float8, 0))::float8 AS "avgMs", count(*)::int AS turns
      FROM "Session" s CROSS JOIN LATERAL jsonb_array_elements(${participants}) pt
      WHERE ${archived}
      GROUP BY pt ->> 'id' ORDER BY "avgMs" DESC`,
    prisma.$queryRaw<StatsDTO["onTime"][]>`
      SELECT count(*) FILTER (WHERE v > 0)::int AS total, count(*) FILTER (WHERE v > 0 AND v <= ${limitMs}::float8)::int AS ok,
        COALESCE(avg(v - ${limitMs}::float8) FILTER (WHERE v > ${limitMs}::float8), 0)::float8 AS "overMs"
      FROM (
        SELECT COALESCE((s."record" -> 'spent' ->> (pt ->> 'id'))::float8, 0) AS v
        FROM "Session" s CROSS JOIN LATERAL jsonb_array_elements(${participants}) pt
        WHERE ${archived}
      ) turns`,
    prisma.$queryRaw<{ open: number; resolved: number; medianDays: number | null }[]>`
      SELECT count(*) FILTER (WHERE "status" <> 'done')::int AS open, count(*) FILTER (WHERE "status" = 'done')::int AS resolved,
        (percentile_cont(0.5) WITHIN GROUP (ORDER BY GREATEST(0, EXTRACT(EPOCH FROM ("doneAt" - "createdAt"))) / 86400)
          FILTER (WHERE "status" = 'done' AND "doneAt" IS NOT NULL))::float8 AS "medianDays"
      FROM "Action" WHERE "workspaceId" = ${ws} AND "meetingId" = ${m}`,
  ]);

  // Fuzzy parts, from the records and the items: projects, recurring blockers, lingering actions
  const { db } = ctx.ws;
  const [records, blockerItems, current, open] = await Promise.all([
    db.session.findMany({ where: { meetingId: m, status: "archived" }, orderBy: { date: "asc" }, select: { date: true, record: true } }),
    db.checkInItem.findMany({
      where: { meetingId: m, role: "blocker" },
      include: { session: { select: { date: true } }, person: { select: { firstName: true, lastName: true } } },
    }),
    db.session.findFirst({ where: { meetingId: m, status: "current" }, select: { date: true } }),
    db.action.findMany({
      where: { meetingId: m, status: { not: "done" } },
      orderBy: { createdAt: "asc" },
      include: { owner: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  const entries = records.flatMap((r) => {
    const rec = parseRecord(r.record);
    if (!rec) return [];
    const doneKeys = new Set(rec.sections.filter((s) => s.role === "achievement").map((s) => s.key));
    const items = Object.values(rec.checkIns).flatMap((c) => c.items);
    return rec.projects.map((p) => ({
      date: r.date,
      projectId: p.id,
      name: p.name,
      health: p.health,
      done: items.filter((i) => i.projectId === p.id && doneKeys.has(i.section)).length,
    }));
  });
  const now = Date.now();
  return {
    sessions: sessions.map((s) => ({ ...s, absentNames: s.absentNames ?? [] })),
    speaking,
    onTime: onTime[0] ?? { ok: 0, total: 0, overMs: 0 },
    actions: {
      open: actionRows[0]?.open ?? 0,
      resolved: actionRows[0]?.resolved ?? 0,
      medianDays: actionRows[0]?.medianDays ?? null,
      stale: open
        .filter((a) => now - a.createdAt.getTime() > STALE_DAYS * DAY)
        .map((a) => ({
          id: a.id,
          text: a.text,
          ownerId: a.ownerId,
          ownerName: personName(a.owner),
          status: a.status,
          originDate: a.originDate,
          days: Math.floor((now - a.createdAt.getTime()) / DAY),
        })),
    },
    projects: projectProgress(
      records.map((r) => r.date),
      entries,
    ),
    // Blockers of the current check-ins count too: raised again for the coming session
    recurring: recurringBlockers(
      blockerItems
        .filter((b) => b.session || current)
        .map((b) => ({ personId: b.personId, name: personName(b.person), text: b.text, date: b.session?.date ?? current!.date })),
      open,
    ),
  };
}
