import "server-only";
import type { Locale } from "@ronde/i18n";
import type { WorkspaceContext } from "./authz";
import type { DashboardPerson } from "./dashboard";
import { decisionLog } from "./meeting/decisions";
import { listMeetings } from "./meetings";

// Pages that look across meetings: every meeting at a glance, every decision taken

export interface MeetingOverview {
  id: string;
  name: string;
  icon: string;
  image: number | null;
  color: number;
  schedule: string;
  role: "host" | "cohost" | "participant" | "observer" | null;
  next: { date: string; time: string; live: boolean } | null;
  people: DashboardPerson[];
  peopleCount: number;
  openActions: number;
  held: number;
  lastHeld: string | null;
}

export async function meetingsOverview(ctx: WorkspaceContext, locale: Locale): Promise<MeetingOverview[]> {
  const meetings = await listMeetings(ctx, locale);
  const ids = meetings.map((m) => m.id);
  const [participants, actions, held, current] = await Promise.all([
    ctx.db.meetingParticipant.findMany({
      where: { meetingId: { in: ids }, role: { not: "observer" } },
      orderBy: { position: "asc" },
      select: {
        meetingId: true,
        person: {
          select: { id: true, firstName: true, lastName: true, email: true, color: true, avatar: { select: { updatedAt: true } } },
        },
      },
    }),
    ctx.db.action.groupBy({ by: ["meetingId"], where: { meetingId: { in: ids }, status: { not: "done" } }, _count: true }),
    ctx.db.session.groupBy({
      by: ["meetingId"],
      where: { meetingId: { in: ids }, status: "archived" },
      _count: true,
      _max: { date: true },
    }),
    ctx.db.session.findMany({ where: { meetingId: { in: ids }, status: "current" }, select: { meetingId: true, time: true } }),
  ]);
  return meetings.map((m, color) => {
    const people = participants.filter((p) => p.meetingId === m.id).map((p) => p.person);
    const stats = held.find((h) => h.meetingId === m.id);
    return {
      id: m.id,
      name: m.name,
      icon: m.icon,
      image: m.image,
      color,
      schedule: m.schedule,
      role: m.role,
      next: m.next ? { ...m.next, time: current.find((c) => c.meetingId === m.id)?.time ?? "" } : null,
      people: people.slice(0, 6).map((p) => ({
        id: p.id,
        name: [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email,
        color: p.color,
        avatar: p.avatar ? p.avatar.updatedAt.getTime() : null,
      })),
      peopleCount: people.length,
      openActions: actions.find((a) => a.meetingId === m.id)?._count ?? 0,
      held: stats?._count ?? 0,
      lastHeld: stats?._max.date ?? null,
    };
  });
}

export interface WorkspaceDecision {
  meetingId: string;
  meeting: string;
  color: number;
  date: string;
  text: string;
  context: string;
}

/** Most decisions listed at once on the page */
const MAX_DECISIONS = 400;

export async function workspaceDecisions(
  ctx: WorkspaceContext,
  locale: Locale,
  query = "",
  max = MAX_DECISIONS,
): Promise<WorkspaceDecision[]> {
  const seesAll = ctx.can("meeting.read");
  const meetings = await ctx.db.meeting.findMany({
    where: { archivedAt: null, ...(seesAll ? {} : { participants: { some: { personId: ctx.member.personId } } }) },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  const all: WorkspaceDecision[] = [];
  for (const [color, m] of meetings.entries())
    for (const d of await decisionLog(ctx.db, m.id, locale, query))
      all.push({ meetingId: m.id, meeting: m.name, color, date: d.date, text: d.text, context: d.context });
  return all.sort((a, b) => b.date.localeCompare(a.date)).slice(0, max);
}

export interface KudoCard {
  id: string;
  text: string;
  date: string;
  meeting: string;
  meetingId: string;
  from: DashboardPerson;
  to: DashboardPerson;
}

export interface KudosWall {
  kudos: KudoCard[];
  /** Thanks given in the last 30 days, and the number of people who received some */
  month: { given: number; people: number };
  /** Birthdays of the current month, "MM-DD" */
  birthdays: (DashboardPerson & { birthday: string })[];
}

/** The thanks of the whole workspace, newest first, and the birthdays of the month */
export async function kudosWall(ctx: WorkspaceContext): Promise<KudosWall> {
  const seesAll = ctx.can("meeting.read");
  const meetings = await ctx.db.meeting.findMany({
    where: { archivedAt: null, ...(seesAll ? {} : { participants: { some: { personId: ctx.member.personId } } }) },
    select: { id: true, name: true },
  });
  const name = new Map(meetings.map((m) => [m.id, m.name]));
  const rows = await ctx.db.kudo.findMany({
    where: { session: { meetingId: { in: meetings.map((m) => m.id) } } },
    orderBy: { createdAt: "desc" },
    take: 120,
    select: { id: true, text: true, fromId: true, toId: true, createdAt: true, session: { select: { date: true, meetingId: true } } },
  });
  const month = new Date().toISOString().slice(5, 7);
  const people = await ctx.db.person.findMany({
    where: { OR: [{ id: { in: [...new Set(rows.flatMap((r) => [r.fromId, r.toId]))] } }, { birthday: { startsWith: `${month}-` } }] },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      color: true,
      birthday: true,
      deprovisionedAt: true,
      avatar: { select: { updatedAt: true } },
    },
  });
  const person = (p: (typeof people)[number]): DashboardPerson => ({
    id: p.id,
    name: [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email,
    color: p.color,
    avatar: p.avatar ? p.avatar.updatedAt.getTime() : null,
  });
  const byId = new Map(people.map((p) => [p.id, person(p)]));
  const unknown: DashboardPerson = { id: "", name: "?", color: 0, avatar: null };
  const since = Date.now() - 30 * 86_400_000;
  const recent = rows.filter((r) => r.createdAt.getTime() >= since);
  return {
    kudos: rows.map((r) => ({
      id: r.id,
      text: r.text,
      date: r.session.date,
      meeting: name.get(r.session.meetingId) ?? "",
      meetingId: r.session.meetingId,
      from: byId.get(r.fromId) ?? unknown,
      to: byId.get(r.toId) ?? unknown,
    })),
    month: { given: recent.length, people: new Set(recent.map((r) => r.toId)).size },
    birthdays: people
      .filter((p) => p.birthday?.startsWith(`${month}-`) && !p.deprovisionedAt)
      .sort((a, b) => a.birthday!.localeCompare(b.birthday!))
      .map((p) => ({ ...person(p), birthday: p.birthday! })),
  };
}
