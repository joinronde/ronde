import "server-only";
import { awayUntil } from "@ronde/core/absences";
import type { MeetingRole, WorkspaceRole } from "@ronde/core/permissions";
import { type AbsenceDTO, personAbsences, workspaceToday } from "./absences";
import type { WorkspaceContext } from "./authz";
import { type ActionRow, listActions, ticketOf } from "./my-actions";

// A person of the directory: who they are, their meetings, what they have to do, how present they are

export interface Profile {
  id: string;
  name: string;
  email: string;
  color: number;
  avatar: number | null;
  /** "MM-DD" */
  birthday: string | null;
  jobCategory: string | null;
  /** Role in the workspace; null when the person has no account here yet */
  role: WorkspaceRole | null;
  isMe: boolean;
  /** The viewer may edit this card */
  canEdit: boolean;
  removed: boolean;
  meetings: { id: string; name: string; icon: string; image: number | null; color: number; role: MeetingRole }[];
  actions: ActionRow[];
  /** Archived sessions of their meetings in the last 90 days, and how many they attended */
  attendance: { held: number; attended: number };
  kudos: { id: string; from: string; fromColor: number; text: string; date: string; meeting: string }[];
  /** Absences current and to come; the last day of the current one */
  absences: AbsenceDTO[];
  awayUntil: string | null;
  /** People who may stand in as host, for the viewer who edits the absences */
  delegates: { id: string; name: string }[];
}

const DAY = 86_400_000;
const fullName = (p: { firstName: string; lastName: string; email: string }) =>
  [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email;

export async function personProfile(ctx: WorkspaceContext, personId: string): Promise<Profile | null> {
  const person = await ctx.db.person.findFirst({
    where: { id: personId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      color: true,
      birthday: true,
      deprovisionedAt: true,
      jobCategory: { select: { name: true } },
      member: { select: { role: true } },
      avatar: { select: { updatedAt: true } },
    },
  });
  if (!person) return null;
  // Meetings the viewer sees, in the order that gives their colours
  const seesAll = ctx.can("meeting.read");
  const visible = await ctx.db.meeting.findMany({
    where: { archivedAt: null, ...(seesAll ? {} : { participants: { some: { personId: ctx.member.personId } } }) },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      icon: true,
      image: { select: { updatedAt: true } },
      participants: { where: { personId }, select: { role: true } },
    },
  });
  const color = new Map(visible.map((m, i) => [m.id, i]));
  const theirs = visible.filter((m) => m.participants.length);
  const ids = theirs.map((m) => m.id);
  const since = new Date(Date.now() - 90 * DAY).toISOString().slice(0, 10);

  const [sessions, kudos, actions] = await Promise.all([
    ctx.db.session.findMany({
      where: { meetingId: { in: ids }, status: "archived", date: { gte: since } },
      select: { absent: true },
    }),
    ctx.db.kudo.findMany({
      where: { toId: personId, session: { meetingId: { in: visible.map((m) => m.id) } } },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, fromId: true, text: true, session: { select: { date: true, meetingId: true } } },
    }),
    // The viewer's actions page lists their own; here, this person's actions in the meetings the viewer sees
    personId === ctx.member.personId ? listActions(ctx, "mine") : othersActions(ctx, personId, color, visible),
  ]);
  const givers = await ctx.db.person.findMany({
    where: { id: { in: [...new Set(kudos.map((k) => k.fromId))] } },
    select: { id: true, firstName: true, lastName: true, email: true, color: true },
  });
  const giver = new Map(givers.map((g) => [g.id, g]));
  const meetingName = new Map(visible.map((m) => [m.id, m.name]));
  const isMe = personId === ctx.member.personId;
  const absences = await personAbsences(ctx, personId);
  const today = workspaceToday(ctx.workspace);
  const canEdit = isMe || ctx.can("people.manage");
  const delegates = canEdit
    ? await ctx.db.person.findMany({
        where: { id: { not: personId }, active: true, member: { isNot: null } },
        orderBy: { firstName: "asc" },
        select: { id: true, firstName: true, lastName: true, email: true },
      })
    : [];
  return {
    id: person.id,
    name: fullName(person),
    email: person.email,
    color: person.color,
    avatar: person.avatar ? person.avatar.updatedAt.getTime() : null,
    birthday: person.birthday,
    jobCategory: person.jobCategory?.name ?? null,
    role: person.member?.role ?? null,
    isMe,
    canEdit,
    absences,
    awayUntil: awayUntil(absences, personId, today),
    delegates: delegates.map((d) => ({ id: d.id, name: fullName(d) })),
    removed: !!person.deprovisionedAt,
    meetings: theirs.map((m) => ({
      id: m.id,
      name: m.name,
      icon: m.icon,
      image: m.image ? m.image.updatedAt.getTime() : null,
      color: color.get(m.id)!,
      role: m.participants[0]!.role,
    })),
    actions: actions.filter((a) => a.status !== "done"),
    attendance: { held: sessions.length, attended: sessions.filter((s) => !s.absent.includes(personId)).length },
    kudos: kudos.map((k) => {
      const g = giver.get(k.fromId);
      return {
        id: k.id,
        from: g ? fullName(g) : "?",
        fromColor: g?.color ?? 0,
        text: k.text,
        date: k.session.date,
        meeting: meetingName.get(k.session.meetingId) ?? "",
      };
    }),
  };
}

async function othersActions(
  ctx: WorkspaceContext,
  personId: string,
  color: Map<string, number>,
  visible: { id: string; name: string }[],
): Promise<ActionRow[]> {
  const rows = await ctx.db.action.findMany({
    where: { ownerId: personId, status: { not: "done" }, meetingId: { in: visible.map((m) => m.id) } },
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
  const name = new Map(visible.map((m) => [m.id, m.name]));
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    status: r.status,
    meetingId: r.meetingId,
    meeting: name.get(r.meetingId) ?? "",
    color: color.get(r.meetingId) ?? 0,
    originDate: r.originDate,
    doneAt: null,
    owner: { id: r.owner.id, name: fullName(r.owner), color: r.owner.color, avatar: r.owner.avatar?.updatedAt.getTime() ?? null },
    carried: 0,
    ticket: ticketOf(r.externalRef),
  }));
}
