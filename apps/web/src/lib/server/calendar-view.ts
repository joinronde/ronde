import "server-only";
import { occurrences } from "@ronde/core/schedule";
import type { WorkspaceContext } from "./authz";
import { loadSchedule, timeZoneOf } from "./meeting/schedule";

// The workspace calendar: every session of the meetings the person can see, planned or held, between two dates

export interface CalendarEvent {
  meetingId: string;
  meeting: string;
  /** Index of the meeting, for its colour */
  color: number;
  date: string;
  time: string;
  durationMin: number;
  status: "planned" | "live" | "held" | "cancelled";
  /** The person's answer to "will you be there?" */
  attendance: "yes" | "no" | null;
  /** Their role in the meeting (null: they see it as an administrator) */
  role: string | null;
  /** Skipped for this public holiday */
  holiday?: string | null;
}

export async function calendarEvents(ctx: WorkspaceContext, from: string, to: string): Promise<CalendarEvent[]> {
  const seesAll = ctx.can("meeting.read");
  const meetings = await ctx.db.meeting.findMany({
    where: { archivedAt: null, ...(seesAll ? {} : { participants: { some: { personId: ctx.member.personId } } }) },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      timezone: true,
      participants: { where: { personId: ctx.member.personId }, select: { role: true } },
      sessions: {
        where: { date: { gte: from, lte: to } },
        select: { date: true, time: true, durationMin: true, status: true, startedAt: true, endedAt: true },
      },
    },
  });
  const answers = await ctx.db.attendance.findMany({
    where: { personId: ctx.member.personId, meetingId: { in: meetings.map((m) => m.id) } },
    select: { meetingId: true, occurrenceKey: true, status: true },
  });
  const events: CalendarEvent[] = [];
  for (const [color, m] of meetings.entries()) {
    const base = { meetingId: m.id, meeting: m.name, color, role: m.participants[0]?.role ?? null };
    // Held or running sessions, as they happened
    const byDate = new Map(m.sessions.map((s) => [s.date, s]));
    for (const s of m.sessions)
      if (s.status === "archived" || s.startedAt)
        events.push({
          ...base,
          date: s.date,
          time: s.time,
          durationMin: s.durationMin,
          status: s.status === "archived" ? "held" : s.endedAt ? "held" : "live",
          attendance: null,
        });
    // Planned ones, from the schedule
    const { rules, exceptions } = await loadSchedule(ctx.db, m.id);
    for (const o of occurrences(rules, exceptions, timeZoneOf(m, ctx.workspace), { from, to, withCancelled: true })) {
      const held = byDate.get(o.date);
      if (held && (held.status === "archived" || held.startedAt)) continue;
      const answer = answers.find((a) => a.meetingId === m.id && a.occurrenceKey === o.key)?.status ?? null;
      events.push({
        ...base,
        date: o.date,
        time: o.time,
        durationMin: o.durationMin,
        status: o.cancelled ? "cancelled" : "planned",
        attendance: answer,
        ...(o.cancelled && o.holiday ? { holiday: o.holiday } : {}),
      });
    }
  }
  return events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}
