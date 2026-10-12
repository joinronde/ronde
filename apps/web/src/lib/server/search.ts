import "server-only";
import type { Locale } from "@ronde/i18n";
import type { WorkspaceContext } from "./authz";
import { decisionLog } from "./meeting/decisions";

// Search across a workspace, for the ⌘K palette: only what the person can see

export type SearchKind = "meeting" | "person" | "action" | "topic" | "decision";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  /** Second line: the meeting, the email, the date… */
  detail: string;
  href: string;
  /** Colour index of the meeting or the person */
  color: number;
}

/** Hits per kind */
const PER_KIND = 5;

export async function searchWorkspace(ctx: WorkspaceContext, raw: string, locale: Locale): Promise<SearchHit[]> {
  const q = raw.trim().slice(0, 100);
  if (q.length < 2) return [];
  const base = `/w/${ctx.workspace.slug}`;
  const contains = { contains: q, mode: "insensitive" as const };
  const seesAll = ctx.can("meeting.read");
  const meetings = await ctx.db.meeting.findMany({
    where: { archivedAt: null, ...(seesAll ? {} : { participants: { some: { personId: ctx.member.personId } } }) },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  const color = new Map(meetings.map((m, i) => [m.id, i]));
  const name = new Map(meetings.map((m) => [m.id, m.name]));
  const ids = meetings.map((m) => m.id);
  const words = q.split(/\s+/).filter(Boolean);

  const [people, actions, topics] = await Promise.all([
    // The directory, for the people who read it (a workspace guest only finds their meetings' things)
    ctx.db.person.findMany({
      where: {
        deprovisionedAt: null,
        ...(ctx.can("people.read") ? {} : { id: { in: [] } }),
        AND: words.map((w) => ({
          OR: [
            { firstName: { contains: w, mode: "insensitive" as const } },
            { lastName: { contains: w, mode: "insensitive" as const } },
            { email: { contains: w, mode: "insensitive" as const } },
          ],
        })),
      },
      orderBy: [{ firstName: "asc" }],
      take: PER_KIND,
      select: { id: true, firstName: true, lastName: true, email: true, color: true },
    }),
    ctx.db.action.findMany({
      where: { meetingId: { in: ids }, text: contains },
      orderBy: { createdAt: "desc" },
      take: PER_KIND,
      select: { id: true, text: true, status: true, meetingId: true, owner: { select: { firstName: true, lastName: true } } },
    }),
    ctx.db.topic.findMany({
      where: { meetingId: { in: ids }, text: contains },
      orderBy: { createdAt: "desc" },
      take: PER_KIND,
      select: { id: true, text: true, meetingId: true },
    }),
  ]);

  const decisions: SearchHit[] = [];
  for (const m of meetings) {
    if (decisions.length >= PER_KIND) break;
    for (const d of await decisionLog(ctx.db, m.id, locale, q)) {
      if (decisions.length >= PER_KIND) break;
      decisions.push({
        kind: "decision",
        id: `${m.id}:${d.date}:${decisions.length}`,
        title: d.text,
        detail: `${m.name} · ${d.date}`,
        href: `${base}/m/${m.id}/decisions`,
        color: color.get(m.id) ?? 0,
      });
    }
  }

  const lower = q.toLowerCase();
  return [
    ...meetings
      .filter((m) => m.name.toLowerCase().includes(lower))
      .slice(0, PER_KIND)
      .map((m) => ({ kind: "meeting" as const, id: m.id, title: m.name, detail: "", href: `${base}/m/${m.id}`, color: color.get(m.id)! })),
    ...people.map((p) => ({
      kind: "person" as const,
      id: p.id,
      title: [p.firstName, p.lastName].filter(Boolean).join(" ") || p.email,
      detail: p.email,
      href: `${base}/people/${p.id}`,
      color: p.color,
    })),
    ...actions.map((a) => ({
      kind: "action" as const,
      id: a.id,
      title: a.text,
      detail: `${name.get(a.meetingId)} · ${[a.owner.firstName, a.owner.lastName].filter(Boolean).join(" ")}`,
      href: `${base}/actions`,
      color: color.get(a.meetingId) ?? 0,
    })),
    ...topics.map((t) => ({
      kind: "topic" as const,
      id: t.id,
      title: t.text,
      detail: name.get(t.meetingId) ?? "",
      href: `${base}/m/${t.meetingId}`,
      color: color.get(t.meetingId) ?? 0,
    })),
    ...decisions,
  ];
}
