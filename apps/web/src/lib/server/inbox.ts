import "server-only";
import type { ScopedClient, ScopedTx } from "@ronde/db";
import type { WorkspaceContext } from "./authz";

// The bell: what happened for a person in their meetings. Written along the change it reports, read by the top bar.

export type InboxKind =
  | "action.assigned"
  | "line.assigned"
  | "session.started"
  | "minutes.published"
  | "minutes.draft"
  | "kudo.received"
  | "meeting.joined"
  | "absence.delegated";

export interface Delivery {
  /** Recipients (people); the person who did it is left out */
  to: string[];
  kind: InboxKind;
  actorId?: string | null;
  meetingId?: string | null;
  data?: { text?: string };
  /** Inside the workspace: "/m/<id>/me" */
  href: string;
}

export interface InboxView {
  id: string;
  kind: InboxKind;
  actor: { id: string; name: string; color: number; avatar: number | null } | null;
  meeting: string | null;
  text: string | null;
  href: string;
  createdAt: string;
  read: boolean;
}

/** Items kept for each person: the bell is a recent history, not an archive */
const KEEP = 100;

export async function deliver(db: ScopedClient | ScopedTx, workspaceId: string, d: Delivery): Promise<void> {
  const to = [...new Set(d.to)].filter((id) => id && id !== d.actorId);
  if (!to.length) return;
  await db.inboxItem.createMany({
    data: to.map((personId) => ({
      workspaceId,
      personId,
      kind: d.kind,
      actorId: d.actorId ?? null,
      meetingId: d.meetingId ?? null,
      data: d.data ?? {},
      href: d.href,
    })),
  });
}

/** Everyone taking part in a meeting (observers included) */
export async function meetingPeople(db: ScopedClient | ScopedTx, meetingId: string): Promise<string[]> {
  // Not someone who left the workspace or was removed by its directory
  const rows = await db.meetingParticipant.findMany({
    where: { meetingId, person: { active: true, deprovisionedAt: null } },
    select: { personId: true },
  });
  return rows.map((r) => r.personId);
}

export async function listInbox(ctx: WorkspaceContext, limit = 30): Promise<{ unread: number; items: InboxView[] }> {
  const where = { personId: ctx.member.personId };
  const [rows, unread] = await Promise.all([
    ctx.db.inboxItem.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
    ctx.db.inboxItem.count({ where: { ...where, readAt: null } }),
  ]);
  const [actors, meetings] = await Promise.all([
    ctx.db.person.findMany({
      where: { id: { in: [...new Set(rows.flatMap((r) => (r.actorId ? [r.actorId] : [])))] } },
      select: { id: true, firstName: true, lastName: true, email: true, color: true, avatar: { select: { updatedAt: true } } },
    }),
    ctx.db.meeting.findMany({
      where: { id: { in: [...new Set(rows.flatMap((r) => (r.meetingId ? [r.meetingId] : [])))] } },
      select: { id: true, name: true },
    }),
  ]);
  const actor = new Map(
    actors.map((a) => [
      a.id,
      {
        id: a.id,
        name: [a.firstName, a.lastName].filter(Boolean).join(" ") || a.email,
        color: a.color,
        avatar: a.avatar?.updatedAt.getTime() ?? null,
      },
    ]),
  );
  const meeting = new Map(meetings.map((m) => [m.id, m.name]));
  return {
    unread,
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind as InboxKind,
      actor: r.actorId ? (actor.get(r.actorId) ?? null) : null,
      meeting: r.meetingId ? (meeting.get(r.meetingId) ?? null) : null,
      text: (r.data as { text?: string } | null)?.text ?? null,
      href: `/w/${ctx.workspace.slug}${r.href}`,
      createdAt: r.createdAt.toISOString(),
      read: !!r.readAt,
    })),
  };
}

/** Marks one item, or all of them, as read; old items beyond the history are dropped */
export async function markRead(ctx: WorkspaceContext, id?: string): Promise<void> {
  await ctx.db.inboxItem.updateMany({
    where: { personId: ctx.member.personId, readAt: null, ...(id ? { id } : {}) },
    data: { readAt: new Date() },
  });
  const old = await ctx.db.inboxItem.findMany({
    where: { personId: ctx.member.personId },
    orderBy: { createdAt: "desc" },
    skip: KEEP,
    select: { id: true },
  });
  if (old.length) await ctx.db.inboxItem.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}
