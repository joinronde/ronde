import "server-only";
import type { WorkspaceContext } from "./authz";

/** The ticket of an action, as the pages show it */
export const ticketOf = (raw: unknown): { key: string; url: string } | null =>
  raw && typeof raw === "object" && "key" in raw && "url" in raw ? { key: String(raw.key), url: String(raw.url) } : null;

// Follow-up actions across meetings: what the person has to do, and what the people of the meetings they run have to do

export type ActionScope = "mine" | "hosted";

export interface ActionRow {
  id: string;
  text: string;
  status: "open" | "doing" | "done";
  meetingId: string;
  meeting: string;
  /** Index of the meeting, for its colour (same as the calendar) */
  color: number;
  /** Date of the session it came from */
  originDate: string | null;
  doneAt: string | null;
  owner: { id: string; name: string; color: number; avatar: number | null };
  /** Sessions held since it was decided, while it stayed open */
  carried: number;
  /** Its ticket in an issue tracker (Team) */
  ticket: { key: string; url: string } | null;
}

/** Done actions stay listed this long, so a mistake can be undone */
const DONE_DAYS = 14;

const fullName = (p: { firstName: string; lastName: string; email: string }) =>
  [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email || "?";

/** Meetings the person can see, oldest first: their order gives each meeting its colour */
async function visibleMeetings(ctx: WorkspaceContext) {
  const seesAll = ctx.can("meeting.read");
  return ctx.db.meeting.findMany({
    where: { archivedAt: null, ...(seesAll ? {} : { participants: { some: { personId: ctx.member.personId } } }) },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, participants: { where: { personId: ctx.member.personId }, select: { role: true } } },
  });
}

/** The actions of the page (open ones, and those done these last two weeks); `all` adds every action done before */
export async function listActions(ctx: WorkspaceContext, scope: ActionScope, { all = false } = {}): Promise<ActionRow[]> {
  const meetings = await visibleMeetings(ctx);
  const ids =
    scope === "mine"
      ? meetings.map((m) => m.id)
      : meetings.filter((m) => m.participants.some((p) => p.role === "host" || p.role === "cohost")).map((m) => m.id);
  if (!ids.length) return [];
  const since = new Date(Date.now() - DONE_DAYS * 86_400_000);
  const rows = await ctx.db.action.findMany({
    where: {
      meetingId: { in: ids },
      ...(scope === "mine" ? { ownerId: ctx.member.personId } : {}),
      ...(all ? {} : { OR: [{ status: { not: "done" } }, { doneAt: { gte: since } }] }),
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      text: true,
      status: true,
      meetingId: true,
      originDate: true,
      doneAt: true,
      externalRef: true,
      owner: { select: { id: true, firstName: true, lastName: true, email: true, color: true, avatar: { select: { updatedAt: true } } } },
    },
  });
  const held = await ctx.db.session.findMany({
    where: { meetingId: { in: [...new Set(rows.map((r) => r.meetingId))] }, status: "archived" },
    select: { meetingId: true, date: true },
  });
  const index = new Map(meetings.map((m, i) => [m.id, i]));
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    status: r.status,
    meetingId: r.meetingId,
    meeting: meetings[index.get(r.meetingId)!]!.name,
    color: index.get(r.meetingId)!,
    originDate: r.originDate,
    doneAt: r.doneAt?.toISOString() ?? null,
    owner: { id: r.owner.id, name: fullName(r.owner), color: r.owner.color, avatar: r.owner.avatar?.updatedAt.getTime() ?? null },
    carried: r.status === "done" || !r.originDate ? 0 : held.filter((s) => s.meetingId === r.meetingId && s.date > r.originDate!).length,
    ticket: ticketOf(r.externalRef),
  }));
}

/** For the sidebar: what is left to do */
export async function openActionCount(ctx: WorkspaceContext): Promise<number> {
  return ctx.db.action.count({
    where: { ownerId: ctx.member.personId, status: { not: "done" }, meeting: { archivedAt: null } },
  });
}

/** Whether the person runs a meeting, so they follow its actions too */
export async function hostsMeetings(ctx: WorkspaceContext): Promise<boolean> {
  const n = await ctx.db.meetingParticipant.count({
    where: { personId: ctx.member.personId, role: { in: ["host", "cohost"] }, meeting: { archivedAt: null } },
  });
  return n > 0;
}
