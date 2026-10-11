import "server-only";
import { sameItem } from "@ronde/core/record";
import type { CheckInDTO, RecordCheckIn, SectionDef } from "@ronde/core/types";
import { checkInFromItems, itemsFromCheckIn, plainItem, similarity, taskOf, withEffectiveRoles } from "@ronde/core/util";
import type { CheckInItem, ScopedClient, ScopedTx } from "@ronde/db";
import { ms } from "./dto";

// Check-ins: one row per item. An item belongs to the person's current check-in (no session) until it is
// presented; archiving the session moves it there, and the check-in starts empty again. An item written in the
// tab of a project carries the project: it is presented at the project's step of the project round.

type Db = ScopedClient | ScopedTx;

const byPosition = (a: CheckInItem, b: CheckInItem) => a.position - b.position;

/** Items per section key */
function grouped(items: CheckInItem[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const item of [...items].sort(byPosition)) (out[item.sectionKey] ??= []).push(item.text);
  return out;
}

/** Current check-ins of a meeting, per person */
export async function loadCheckIns(db: Db, meetingId: string, sections: SectionDef[]): Promise<Record<string, CheckInDTO>> {
  const [heads, items] = await Promise.all([
    db.checkIn.findMany({ where: { meetingId } }),
    db.checkInItem.findMany({ where: { meetingId, sessionId: null } }),
  ]);
  const itemsOf = new Map<string, CheckInItem[]>();
  for (const item of items) itemsOf.set(item.personId, [...(itemsOf.get(item.personId) ?? []), item]);
  const out: Record<string, CheckInDTO> = {};
  for (const h of heads) {
    const mine = itemsOf.get(h.personId) ?? [];
    const projects = [...new Set(mine.map((i) => i.projectId).filter((p): p is string => !!p))];
    out[h.personId] = {
      ...checkInFromItems(grouped(mine.filter((i) => !i.projectId)), sections),
      byProject: Object.fromEntries(projects.map((p) => [p, checkInFromItems(grouped(mine.filter((i) => i.projectId === p)), sections)])),
      updatedAt: ms(h.updatedAt),
    };
  }
  return out;
}

/**
 * Plan items of the last session each person was presented at (what they said they would do next).
 * Looks at the last few archived sessions only.
 */
export async function lastPlans(db: Db, meetingId: string): Promise<Record<string, { date: string; items: CheckInItem[] }>> {
  const sessions = await db.session.findMany({
    where: { meetingId, status: "archived" },
    orderBy: { date: "desc" },
    take: 4,
    select: { id: true, date: true },
  });
  if (!sessions.length) return {};
  const items = await db.checkInItem.findMany({ where: { sessionId: { in: sessions.map((s) => s.id) }, role: "plan" } });
  const out: Record<string, { date: string; items: CheckInItem[] }> = {};
  // Most recent session first: a person's latest plan wins
  for (const s of sessions)
    for (const item of items.filter((i) => i.sessionId === s.id).sort(byPosition)) {
      const mine = out[item.personId];
      if (!mine) out[item.personId] = { date: s.date, items: [item] };
      else if (mine.date === s.date) mine.items.push(item);
    }
  return out;
}

/**
 * Saves a check-in. Items keep their id when their text stays in the same section (comments stay on them);
 * an achievement written like an item planned last time is linked to it (planned → done). The tabs of projects
 * given in `byProject` are saved as well (projects left out keep their items).
 */
export async function saveCheckIn(
  db: Db,
  ids: { workspaceId: string; meetingId: string; personId: string },
  fields: RecordCheckIn,
  sectionRows: SectionDef[],
): Promise<void> {
  const { workspaceId, meetingId, personId } = ids;
  const sections = withEffectiveRoles(sectionRows);
  // Items wanted, per tab: the person's own (null), then each project given
  const tabs: [string | null, Record<string, string[]>][] = [
    [null, itemsFromCheckIn(fields, sectionRows)],
    ...Object.entries(fields.byProject ?? {}).map(([p, f]): [string, Record<string, string[]>] => [p, itemsFromCheckIn(f, sectionRows)]),
  ];
  const touched = new Set(tabs.map(([p]) => p));
  const current = await db.checkInItem.findMany({ where: { meetingId, personId, sessionId: null } });
  const existing = current.filter((i) => touched.has(i.projectId));
  const free = new Set(existing.map((i) => i.id));
  const plans = (await lastPlans(db, meetingId))[personId]?.items ?? [];
  // Plan items already reported on by an item that stays
  const reported = new Set(current.map((i) => i.sourceItemId).filter((x): x is string => !!x));

  const keep: { item: CheckInItem; position: number; role: SectionDef["role"] }[] = [];
  const create: { sectionKey: string; text: string; position: number; role: SectionDef["role"]; projectId: string | null }[] = [];
  for (const [projectId, wanted] of tabs)
    for (const def of sections)
      (wanted[def.key] ?? []).forEach((text, position) => {
        const same = existing.find((i) => free.has(i.id) && i.projectId === projectId && i.sectionKey === def.key && i.text === text);
        if (same) {
          free.delete(same.id);
          keep.push({ item: same, position, role: def.role });
        } else create.push({ sectionKey: def.key, text, position, role: def.role, projectId });
      });
  // Removed items go, with their comments
  for (const id of free) {
    const gone = existing.find((i) => i.id === id);
    if (gone?.sourceItemId) reported.delete(gone.sourceItemId);
  }
  // People who joined an item: an item reworded (the new text in the same tab and section that looks most
  // like it) keeps them
  const joined = free.size
    ? await db.checkInItemContributor.findMany({ where: { itemId: { in: [...free] } }, select: { itemId: true, personId: true } })
    : [];
  const reworded = existing.filter((i) => free.has(i.id) && joined.some((j) => j.itemId === i.id));
  if (free.size) await db.checkInItem.deleteMany({ where: { id: { in: [...free] } } });

  // An achievement reports on a plan of the same tab (the person's own, or the same project); a box not ticked
  // yet (a plan carried over, still in progress) does not
  const link = (role: SectionDef["role"], text: string, projectId: string | null): string | null => {
    if (role !== "achievement" || taskOf(text).done === false) return null;
    const plan = plans.find((p) => !reported.has(p.id) && p.projectId === projectId && sameItem(p.text, text));
    if (!plan) return null;
    reported.add(plan.id);
    return plan.id;
  };
  for (const k of keep) {
    const sourceItemId = k.item.sourceItemId ?? link(k.role, k.item.text, k.item.projectId);
    if (k.item.position !== k.position || k.item.role !== k.role || k.item.sourceItemId !== sourceItemId)
      await db.checkInItem.update({ where: { id: k.item.id }, data: { position: k.position, role: k.role, sourceItemId } });
  }
  if (create.length) {
    const created = await db.checkInItem.createManyAndReturn({
      data: create.map((c) => ({ workspaceId, meetingId, personId, ...c, sourceItemId: link(c.role, c.text, c.projectId) })),
      select: { id: true, projectId: true, sectionKey: true, text: true },
    });
    const moved: { workspaceId: string; itemId: string; personId: string }[] = [];
    const taken = new Set<string>();
    for (const old of reworded) {
      const best = created
        .filter((c) => !taken.has(c.id) && c.projectId === old.projectId && c.sectionKey === old.sectionKey)
        .map((c) => ({ c, score: similarity(plainItem(old.text), plainItem(c.text)) }))
        .sort((a, b) => b.score - a.score)[0];
      if (!best || best.score < 0.5) continue;
      taken.add(best.c.id);
      for (const j of joined.filter((x) => x.itemId === old.id)) moved.push({ workspaceId, itemId: best.c.id, personId: j.personId });
    }
    if (moved.length) await db.checkInItemContributor.createMany({ data: moved, skipDuplicates: true });
  }
  await db.checkIn.upsert({
    where: { meetingId_personId: { meetingId, personId } },
    create: { workspaceId, meetingId, personId },
    update: { updatedAt: new Date() },
  });
}

/** Archiving a session: the items presented move to it, with the role their section has now */
export async function archiveCheckIns(db: Db, meetingId: string, sessionId: string, presented: string[], sectionRows: SectionDef[]) {
  await db.checkInItem.updateMany({ where: { meetingId, sessionId: null, id: { in: presented } }, data: { sessionId } });
  for (const def of withEffectiveRoles(sectionRows))
    await db.checkInItem.updateMany({ where: { sessionId, sectionKey: def.key, NOT: { role: def.role } }, data: { role: def.role } });
}
