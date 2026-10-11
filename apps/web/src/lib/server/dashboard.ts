import "server-only";
import { agendaOf, hasTurns } from "@ronde/core/agenda";
import type { WorkspaceContext } from "./authz";
import { type CalendarEvent, calendarEvents } from "./calendar-view";
import { sheetWritten } from "./meeting/projects";
import { type ActionRow, listActions } from "./my-actions";

// The home page of a workspace: the next session first, then the week, what is left to do and the team

export interface DashboardPerson {
  id: string;
  name: string;
  color: number;
  /** Version of the photo, null when the person has none */
  avatar: number | null;
}

export interface NextSession {
  meetingId: string;
  meeting: string;
  color: number;
  date: string;
  time: string;
  durationMin: number;
  live: boolean;
  role: string | null;
  /** Hosts and admins open the control room */
  runs: boolean;
  people: DashboardPerson[];
  /** The people (ids) whose check-in is ready for this session */
  ready: string[];
  /** The agenda gives people a turn: check-ins are asked for (a retrospective on its board asks for none) */
  turns: boolean;
  /** Items of the person's check-in for this session; null when they do not fill one (observer, admin) */
  checkIn: number | null;
  attendance: "yes" | "no" | null;
  /** Sheets of the projects the person works on that the meeting follows: written for this session or not */
  sheets: { name: string; written: boolean }[];
}

export interface DashboardData {
  next: NextSession | null;
  /** Monday to Sunday of the current week */
  week: { date: string; events: CalendarEvent[] }[];
  actions: ActionRow[];
  openActions: number;
  birthdays: (DashboardPerson & { date: string; inDays: number })[];
  /** The last 30 days in the meetings the person sees */
  pulse: { sessions: number; actionsDone: number; people: number };
}

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fullName = (p: { firstName: string; lastName: string; email: string }) =>
  [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email;

export async function dashboard(ctx: WorkspaceContext): Promise<DashboardData> {
  const now = new Date();
  const today = iso(now);
  const monday = new Date(Date.parse(`${today}T00:00:00Z`) - ((now.getUTCDay() + 6) % 7) * DAY);
  const horizon = iso(new Date(now.getTime() + 35 * DAY));
  const from = iso(monday) < today ? iso(monday) : today;
  const [events, actions, people] = await Promise.all([
    calendarEvents(ctx, from, horizon),
    listActions(ctx, "mine"),
    ctx.db.person.findMany({
      where: { deprovisionedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        color: true,
        birthday: true,
        sample: true,
        avatar: { select: { updatedAt: true } },
      },
    }),
  ]);
  const person = (p: (typeof people)[number]): DashboardPerson => ({
    id: p.id,
    name: fullName(p),
    color: p.color,
    avatar: p.avatar ? p.avatar.updatedAt.getTime() : null,
  });

  // The next session: one running now, otherwise the first planned one from today
  const coming = events.filter((e) => e.date >= today && (e.status === "live" || e.status === "planned"));
  const first = coming.find((e) => e.status === "live") ?? coming[0];
  let next: NextSession | null = null;
  if (first) {
    const [participants, items, followed, filled, lastArchived, meetingRow] = await Promise.all([
      ctx.db.meetingParticipant.findMany({
        where: { meetingId: first.meetingId, role: { not: "observer" } },
        orderBy: { position: "asc" },
        select: { personId: true, active: true },
      }),
      ctx.db.checkInItem.count({ where: { meetingId: first.meetingId, personId: ctx.member.personId, sessionId: null } }),
      ctx.db.meetingProject.findMany({
        where: {
          meetingId: first.meetingId,
          project: {
            archivedAt: null,
            status: "active",
            OR: [{ leadId: ctx.member.personId }, { members: { some: { personId: ctx.member.personId } } }],
          },
        },
        orderBy: { position: "asc" },
        select: {
          project: {
            select: {
              name: true,
              updates: { where: { meetingId: first.meetingId, sessionId: null }, select: { health: true, headline: true } },
            },
          },
        },
      }),
      // Check-ins ready: items written, saved since the last session was archived
      ctx.db.checkIn.findMany({
        where: { meetingId: first.meetingId, person: { checkInItems: { some: { meetingId: first.meetingId, sessionId: null } } } },
        select: { personId: true, updatedAt: true },
      }),
      ctx.db.session.findFirst({
        where: { meetingId: first.meetingId, status: "archived" },
        orderBy: { archivedAt: "desc" },
        select: { archivedAt: true },
      }),
      ctx.db.meeting.findUnique({ where: { id: first.meetingId }, select: { agenda: true } }),
    ]);
    const since = lastArchived?.archivedAt?.getTime() ?? 0;
    const readyIds = new Set(filled.filter((c) => c.updatedAt.getTime() >= since).map((c) => c.personId));
    const byId = new Map(people.map((p) => [p.id, p]));
    // Only the people who speak fill a check-in: a host who only runs the meeting has none to write
    // and a meeting without turns (a retrospective on its board) asks for none
    const fills =
      first.role !== null &&
      first.role !== "observer" &&
      participants.some((p) => p.personId === ctx.member.personId && p.active) &&
      hasTurns(agendaOf(meetingRow?.agenda));
    next = {
      meetingId: first.meetingId,
      meeting: first.meeting,
      color: first.color,
      date: first.date,
      time: first.time,
      durationMin: first.durationMin,
      live: first.status === "live",
      role: first.role,
      runs: first.role === "host" || first.role === "cohost" || ctx.can("meeting.configure"),
      people: participants.flatMap((p) => (byId.has(p.personId) ? [person(byId.get(p.personId)!)] : [])),
      ready: participants.filter((p) => readyIds.has(p.personId)).map((p) => p.personId),
      turns: hasTurns(agendaOf(meetingRow?.agenda)),
      checkIn: fills ? items : null,
      attendance: first.attendance,
      sheets: fills
        ? followed.map(({ project: p }) => ({
            name: p.name,
            written: p.updates.some(sheetWritten),
          }))
        : [],
    };
  }

  const week = Array.from({ length: 7 }, (_, i) => {
    const date = iso(new Date(monday.getTime() + i * DAY));
    return { date, events: events.filter((e) => e.date === date && e.status !== "cancelled") };
  });

  // Birthdays in the next 30 days, the year turning included
  const birthdays = people
    .filter((p) => p.birthday)
    .map((p) => {
      const [m, d] = p.birthday!.split("-").map(Number) as [number, number];
      let at = Date.UTC(now.getUTCFullYear(), m - 1, d);
      if (at < Date.parse(`${today}T00:00:00Z`)) at = Date.UTC(now.getUTCFullYear() + 1, m - 1, d);
      return { ...person(p), date: iso(new Date(at)), inDays: Math.round((at - Date.parse(`${today}T00:00:00Z`)) / DAY) };
    })
    .filter((b) => b.inDays <= 30)
    .sort((a, b) => a.inDays - b.inDays)
    .slice(0, 4);

  const since = new Date(now.getTime() - 30 * DAY);
  // The workspace's own numbers: the sample meeting and its fictitious team are make-believe
  const visible = { sample: false, ...(ctx.can("meeting.read") ? {} : { participants: { some: { personId: ctx.member.personId } } }) };
  const [sessions, actionsDone] = await Promise.all([
    ctx.db.session.count({ where: { status: "archived", date: { gte: iso(since) }, meeting: { archivedAt: null, ...visible } } }),
    ctx.db.action.count({ where: { status: "done", doneAt: { gte: since }, meeting: { archivedAt: null, ...visible } } }),
  ]);

  const open = actions.filter((a) => a.status !== "done");
  return {
    next,
    week,
    actions: [...open.filter((a) => a.status === "doing"), ...open.filter((a) => a.status === "open")].slice(0, 5),
    openActions: open.length,
    birthdays,
    pulse: { sessions, actionsDone, people: people.filter((p) => !p.sample).length },
  };
}
