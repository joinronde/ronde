import type { Section, Snapshot } from "@ronde/core/types";
import { first, itemsOf, plainItem } from "@ronde/core/util";

// What the live views compute from the meeting's state: project sheets and who may own an action. Pure, so the
// server-free tests check them too

type Writing = Pick<Snapshot, "checkIns" | "contributors">;

/** A joined line that is still there: in a section of the meeting today, in its author's tab of that project */
const stillThere = (s: Writing, c: Writing["contributors"][number], sections: Section[]) => {
  const sec = sections.find((x) => x.k === c.section);
  return !!sec && !!c.projectId && itemsOf(s.checkIns[c.ownerId]?.byProject[c.projectId], sec).includes(c.itemText);
};

/** Lines a person wrote about a project (blank ones aside), and lines of others they joined */
export function linesAbout(s: Writing, personId: string, projectId: string, sections: Section[]): number {
  const tab = s.checkIns[personId]?.byProject[projectId];
  const own = sections.reduce((n, sec) => n + itemsOf(tab, sec).filter((x) => plainItem(x).trim()).length, 0);
  return own + s.contributors.filter((c) => c.personId === personId && c.projectId === projectId && stillThere(s, c, sections)).length;
}

/** People who wrote about a project or joined a line of it (every screen agrees on who did) */
export function writersOf(s: Writing, projectId: string, sections: Section[]): string[] {
  const out = new Set<string>();
  for (const [id, f] of Object.entries(s.checkIns))
    if (sections.some((sec) => itemsOf(f.byProject[projectId], sec).some((x) => plainItem(x).trim()))) out.add(id);
  for (const c of s.contributors) if (c.projectId === projectId && stillThere(s, c, sections)) out.add(c.personId);
  return [...out];
}

/**
 * The people an action can go to: the meeting's members in the round, its hosts even when they only run it (out of
 * the round), then its observers. Someone taken out of the round is not offered.
 */
export function actionOwners(s: Snapshot): { id: string; name: string }[] {
  const seen = new Set<string>();
  const runs = (x: Snapshot["members"][number]) => x.role === "host" || x.role === "cohost";
  return [...s.members.filter((x) => x.active || runs(x)), ...s.observers].filter((x) => !seen.has(x.id) && seen.add(x.id));
}

export type SheetRow = { p: Snapshot["projects"][number]; missing: string[]; lines: { id: string; n: number }[]; complete: boolean };

/** What each project sheet still needs: its health, its message of the day, a line from each of its people here */
export function sheetRows(
  s: Snapshot,
  sections: Section[],
  nameOf: (id: string) => string,
  t: (k: "sheets.health" | "sheets.headline") => string,
): SheetRow[] {
  // Only the people expected today: someone absent or who left the meeting does not hold a sheet back
  const absent = new Set(s.meeting?.absent ?? []);
  const inMeeting = new Set(s.members.filter((x) => x.active && !absent.has(x.id)).map((x) => x.id));
  return s.projects.map((p) => {
    const lines = p.memberIds.filter((id) => inMeeting.has(id)).map((id) => ({ id, n: linesAbout(s, id, p.id, sections) }));
    const missing = [
      ...(p.sheet?.health ? [] : [t("sheets.health")]),
      ...(p.sheet?.headline.trim() ? [] : [t("sheets.headline")]),
      ...lines.filter((x) => !x.n).map((x) => first(nameOf(x.id))),
    ];
    return { p, missing, lines, complete: !missing.length };
  });
}

export const sheetsToComplete = (s: Snapshot, sections: Section[]) =>
  sheetRows(
    s,
    sections,
    () => "",
    () => "",
  ).filter((r) => !r.complete).length;
