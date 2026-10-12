import "server-only";
import { type AbsencePeriod, awayOn, validPeriod } from "@ronde/core/absences";
import { localDate } from "@ronde/core/schedule";
import type { ScopedClient, ScopedTx } from "@ronde/db";
import type { WorkspaceContext } from "./authz";
import { AccessError, OpError } from "./errors";
import { deliver } from "./inbox";

// Absences: a person away for some days is absent from the sessions of those days, gets no reminders, and
// the person they name runs the meetings they host, meanwhile.

type Db = ScopedClient | ScopedTx;

export interface AbsenceDTO {
  id: string;
  personId: string;
  from: string;
  to: string;
  note: string;
  delegateId: string | null;
  delegateName: string | null;
}

const fullName = (p: { firstName: string; lastName: string; email: string }) =>
  [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email;

/** Today in the workspace's time zone */
export const workspaceToday = (ws: { timezone: string }) => localDate(Date.now(), ws.timezone);

/** Absences of people, current and to come */
export async function upcomingAbsences(db: Db, today: string, personIds?: string[]): Promise<AbsencePeriod[]> {
  return db.absence.findMany({
    where: { to: { gte: today }, ...(personIds ? { personId: { in: personIds } } : {}) },
    select: { personId: true, from: true, to: true, delegateId: true },
    orderBy: { from: "asc" },
  });
}

/** People away on a day, among those given */
export async function awayPeople(db: Db, date: string, personIds: string[]): Promise<string[]> {
  if (!personIds.length) return [];
  const rows = await db.absence.findMany({
    where: { personId: { in: personIds }, from: { lte: date }, to: { gte: date } },
    select: { personId: true, from: true, to: true },
  });
  return [...awayOn(rows, date)];
}

/** Whether a person runs a meeting today in place of an absent host who named them */
export async function standsInAsHost(db: Db, meetingId: string, personId: string, today: string): Promise<boolean> {
  const absences = await db.absence.findMany({
    where: { delegateId: personId, from: { lte: today }, to: { gte: today } },
    select: { personId: true },
  });
  if (!absences.length) return false;
  return !!(await db.meetingParticipant.findFirst({
    where: { meetingId, personId: { in: absences.map((a) => a.personId) }, role: { in: ["host", "cohost"] } },
    select: { id: true },
  }));
}

/** A person's absences, for their profile */
export async function personAbsences(ctx: WorkspaceContext, personId: string): Promise<AbsenceDTO[]> {
  const rows = await ctx.db.absence.findMany({
    where: { personId, to: { gte: workspaceToday(ctx.workspace) } },
    orderBy: { from: "asc" },
  });
  const delegates = await ctx.db.person.findMany({
    where: { id: { in: rows.flatMap((r) => (r.delegateId ? [r.delegateId] : [])) } },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  const name = new Map(delegates.map((d) => [d.id, fullName(d)]));
  return rows.map((r) => ({
    id: r.id,
    personId: r.personId,
    from: r.from,
    to: r.to,
    note: r.note,
    delegateId: r.delegateId,
    delegateName: r.delegateId ? (name.get(r.delegateId) ?? null) : null,
  }));
}

/** Who may set a person's absences: the person themselves, and those who manage the directory */
function mayEdit(ctx: WorkspaceContext, personId: string) {
  if (personId !== ctx.member.personId && !ctx.can("people.manage")) throw new AccessError(403, "accessDenied");
}

export interface AbsenceInput {
  personId: string;
  from: string;
  to: string;
  note?: string;
  delegateId?: string | null;
}

export async function addAbsence(ctx: WorkspaceContext, input: AbsenceInput): Promise<string> {
  mayEdit(ctx, input.personId);
  if (!validPeriod(input.from, input.to)) throw new OpError("absencePeriod");
  if (input.delegateId === input.personId) throw new OpError("pickSomeoneElse");
  // Naming oneself to stand in for someone else would make anyone managing people the host of their meetings
  if (input.delegateId && input.delegateId === ctx.member.personId) throw new AccessError(403, "accessDenied");
  const people = await ctx.db.person.findMany({
    where: { id: { in: [input.personId, ...(input.delegateId ? [input.delegateId] : [])] } },
    select: { id: true },
  });
  if (people.length !== (input.delegateId ? 2 : 1)) throw new OpError("unknownMember");
  // A stand-in is a member of the workspace, not one of its guests
  if (
    input.delegateId &&
    !(await ctx.db.workspaceMember.findFirst({
      where: { personId: input.delegateId, status: "active", role: { not: "guest" } },
      select: { id: true },
    }))
  )
    throw new OpError("unknownMember");
  const row = await ctx.db.absence.create({
    data: {
      workspaceId: ctx.workspace.id,
      personId: input.personId,
      from: input.from,
      to: input.to,
      note: (input.note ?? "").trim().slice(0, 200),
      delegateId: input.delegateId || null,
    },
  });
  // The current sessions of their meetings in that period count them absent at once
  await markAbsentInSessions(ctx.db, input.personId, input.from, input.to);
  if (input.delegateId)
    await deliver(ctx.db, ctx.workspace.id, {
      to: [input.delegateId],
      kind: "absence.delegated",
      actorId: input.personId,
      href: `/people/${input.personId}`,
      data: { text: `${input.from} → ${input.to}` },
    });
  return row.id;
}

export async function removeAbsence(ctx: WorkspaceContext, id: string) {
  const row = await ctx.db.absence.findFirst({ where: { id }, select: { personId: true } });
  if (!row) throw new OpError("notFound");
  mayEdit(ctx, row.personId);
  await ctx.db.absence.delete({ where: { id } });
}

/** Current sessions (not started) on days of the period: the person is marked absent there */
async function markAbsentInSessions(db: Db, personId: string, from: string, to: string) {
  const sessions = await db.session.findMany({
    where: { status: "current", startedAt: null, date: { gte: from, lte: to }, meeting: { participants: { some: { personId } } } },
    select: { id: true, absent: true },
  });
  for (const s of sessions)
    if (!s.absent.includes(personId)) await db.session.update({ where: { id: s.id }, data: { absent: [...s.absent, personId] } });
}
