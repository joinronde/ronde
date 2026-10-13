import "server-only";
import { type Prisma, prisma } from "@ronde/db";

// Seats: the people who took part in a meeting in the last 30 days. The cloud bills each workspace on them, and
// a self-hosted license counts them across the instance; one rule for both, the one the pricing page states.

/** How far back taking part in a meeting counts */
export const ACTIVE_DAYS = 30;

type SessionSeen = {
  startedAt: Date | null;
  order: string[];
  absent: string[];
  spent: unknown;
  record: unknown;
};

/**
 * Who took part in a session: in a live one, the people of its round who were there (not absent; when turns
 * were timed, the ones who had a turn or wrote something); in an async one, the people who wrote their check-in.
 * Observers are never in the round.
 */
export function tookPart(s: SessionSeen): string[] {
  const r = (s.record ?? null) as {
    participants?: { id: string }[];
    absent?: { id: string }[];
    spent?: Record<string, number>;
    checkIns?: Record<string, { items?: unknown[] }>;
  } | null;
  const wrote = new Set(
    Object.entries(r?.checkIns ?? {})
      .filter(([, c]) => (c.items?.length ?? 0) > 0)
      .map(([id]) => id),
  );
  if (!s.startedAt) return [...wrote];
  const round = r?.participants ? r.participants.map((p) => p.id) : s.order;
  const away = new Set(r?.absent ? r.absent.map((p) => p.id) : s.absent);
  const spent = (r?.spent ?? s.spent ?? {}) as Record<string, number>;
  const present = round.filter((id) => !away.has(id));
  const timed = present.some((id) => (spent[id] ?? 0) > 0);
  return timed ? present.filter((id) => (spent[id] ?? 0) > 0 || wrote.has(id)) : present;
}

/** The people (ids) who took part in one of the sessions matching `where`, of a meeting matching `meeting`, in the
 * last 30 days */
async function tookPartSince(where: Prisma.SessionWhereInput, now: number, meeting: Prisma.MeetingWhereInput = {}): Promise<Set<string>> {
  const since = new Date(now - ACTIVE_DAYS * 86_400_000);
  const sessions = await prisma.session.findMany({
    where: {
      ...where,
      // A session of the sample meeting costs nothing
      meeting: { ...meeting, sample: false },
      // Live sessions by when they started, async ones by when they were published
      OR: [
        { startedAt: { gte: since, lte: new Date(now) } },
        { startedAt: null, status: "archived", archivedAt: { gte: since, lte: new Date(now) } },
      ],
    },
    select: { startedAt: true, order: true, absent: true, spent: true, record: true },
  });
  return new Set(sessions.flatMap(tookPart));
}

/**
 * People who count as seats: the people of the workspace who took part in one of its sessions in the last 30
 * days (see tookPart), counted once. Someone invited who never came, or away for the month, costs nothing.
 */
export async function activeSeats(workspaceId: string, now = Date.now()): Promise<number> {
  const people = await tookPartSince({ workspaceId }, now);
  if (!people.size) return 0;
  return prisma.person.count({ where: { workspaceId, id: { in: [...people] } } });
}

/**
 * Seats of a self-hosted instance, against its license: the same people, across its workspaces (deleted ones
 * aside), each counted once even when they take part in several workspaces with the same account
 */
export async function instanceSeats(now = Date.now()): Promise<number> {
  const people = await tookPartSince({}, now, { workspace: { deletedAt: null } });
  if (!people.size) return 0;
  const rows = await prisma.person.findMany({ where: { id: { in: [...people] } }, select: { id: true, userId: true } });
  return new Set(rows.map((p) => p.userId ?? p.id)).size;
}
