import type { CheckInDTO, ProjectDTO, Section, Snapshot } from "@ronde/core/types";
import { itemsOf, plainItem, rebaseList, rebaseText, taskItem, taskOf } from "@ronde/core/util";

// The check-in being written: how it is loaded, brought back plans, merged with a version saved elsewhere and
// sent. Pure, so the server-free tests check them too

/** Items of each section of a tab ("done", "next"… or "x:<key>") */
export type TabItems = Record<string, string[]>;
/** Check-in draft: the person's own tab, and one tab per project; the tab being edited ("" for their own) */
export type Draft = { items: TabItems; byProject: Record<string, TabItems>; tab: string };

/** An item of a checklist: one written before the section became a checklist gets an empty box */
export const asTask = (x: string) => (taskOf(x).done === null ? taskItem(x, false) : x);

/** Same item whatever its box, its case or its surrounding spaces */
const sameItem = (a: string, b: string) => plainItem(a).trim().toLowerCase() === b.trim().toLowerCase();

/**
 * An item with text: an emptied checklist box ("[ ] ") is blank. Checked before trimming, since a trimmed "[ ]"
 * is no longer read as a box and would be saved as an item of its own
 */
const filled = (i: string) => !!plainItem(i.trimStart()).trim();

/** A tab of the draft from saved fields, section by section */
export function tabOf(fields: Parameters<typeof itemsOf>[0], sections: Section[]): TabItems {
  return Object.fromEntries(
    sections.map((sec) => {
      const list = itemsOf(fields, sec);
      // Free text: a single block (an older list is merged, one line per item)
      // Checklist: an item entered before the type change gets an empty checkbox
      return [sec.k, sec.type === "text" ? [list.join("\n")] : sec.type === "checklist" ? list.map(asTask) : list];
    }),
  );
}

/** The draft of a saved check-in: the person's own tab and one per project of the meeting */
export function draftOf(f: CheckInDTO | null | undefined, projects: Pick<ProjectDTO, "id">[], sections: Section[], tab = ""): Draft {
  return {
    items: tabOf(f, sections),
    byProject: Object.fromEntries(projects.map((p) => [p.id, tabOf(f?.byProject[p.id], sections)])),
    tab,
  };
}

export type CarryContext = {
  sections: Section[];
  /** What the person planned last time */
  lastWeek: Snapshot["lastWeek"][string] | undefined;
  /** The viewer writes their own check-in (the host fixing someone else's brings nothing back) */
  own: boolean;
  /** When the check-in was last saved, and when the last meeting was archived */
  updatedAt: number | null | undefined;
  lastArchivedAt: number | null;
  projects: Pick<ProjectDTO, "id">[];
};

/**
 * The section that brings back last time's plans (an option of the meeting): they come back in it as boxes to
 * tick, in the tab they were written in, until the person saves their check-in after that meeting. Their own
 * check-in only: the host fixing it adds nothing. Null when nothing was brought back.
 */
export function carryPlans(x: Draft, c: CarryContext): Draft | null {
  const sec = c.sections.find((y) => y.carryPlans && y.type === "checklist");
  const lw = c.lastWeek;
  if (!sec || !lw?.next.length || !c.own) return null;
  if ((c.updatedAt ?? 0) >= (c.lastArchivedAt ?? 0)) return null;
  const own = [...lw.next];
  const tabs: [string, string[]][] = [];
  for (const [id, list] of Object.entries(lw.byProject ?? {})) {
    // A project no longer followed: its items come back in the person's own tab
    if (!c.projects.some((p) => p.id === id)) continue;
    for (const item of list) {
      const at = own.indexOf(item);
      if (at >= 0) own.splice(at, 1);
    }
    tabs.push([id, list]);
  }
  let added = 0;
  const fill = (items: TabItems, list: string[]): TabItems => {
    const cur = items[sec.k] ?? [];
    const fresh = list.filter((n) => !cur.some((i) => sameItem(i, n)));
    added += fresh.length;
    return fresh.length
      ? { ...items, [sec.k]: [...cur.filter((i) => plainItem(i).trim()), ...fresh.map((n) => taskItem(n, false))] }
      : items;
  };
  const out: Draft = {
    ...x,
    items: fill(x.items, own),
    byProject: { ...x.byProject, ...Object.fromEntries(tabs.map(([id, list]) => [id, fill(x.byProject[id] ?? {}, list)])) },
  };
  return added ? out : null;
}

/** A draft as the server stores it: items trimmed, blank ones out, checklists with their box */
export function normDraft(x: Draft, sections: Section[]): Draft {
  const tab = (t: TabItems): TabItems =>
    Object.fromEntries(
      sections.map((sec) => {
        const list = t[sec.k] ?? [];
        if (sec.type === "text")
          return [
            sec.k,
            [
              (list[0] ?? "")
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean)
                .join("\n"),
            ],
          ];
        const kept = list.filter(filled).map((i) => i.trim());
        return [sec.k, sec.type === "checklist" ? kept.map(asTask) : kept];
      }),
    );
  return {
    tab: "",
    items: tab(x.items),
    byProject: Object.fromEntries(Object.entries(x.byProject).map(([id, t]) => [id, tab(t)])),
  };
}

/** Two drafts the server would store the same way */
export const sameDraft = (a: Draft, b: Draft, sections: Section[]) =>
  JSON.stringify(normDraft(a, sections)) === JSON.stringify(normDraft(b, sections));

/**
 * A section's items with a line added (GitLab import, "+ Done", past check-in), or null when it is already
 * there: a free text gets a new line, a checklist a box (ticked in "done")
 */
export function appendLine(cur: string[], sec: Section, line: string): string[] | null {
  // A free text holds every line in one block: each line counts
  if (cur.some((i) => i.split("\n").some((l) => sameItem(l, line)))) return null;
  return sec.type === "text"
    ? [(cur[0] ?? "").trim() ? cur[0]!.trimEnd() + "\n" + line : line]
    : [...cur, sec.type === "checklist" ? taskItem(line, sec.k === "done") : line];
}

/** A tab as the save operation takes it: the four sections, then the custom ones under their own key */
export function fieldsOf(tab: TabItems, sections: Section[]) {
  const clean = (k: string) => {
    // A free text is kept as typed (only a blank one goes), as the draft compares it once saved
    const type = sections.find((x) => x.k === k)?.type;
    const list = (tab[k] ?? []).filter(type === "text" ? (x) => !!x.trim() : filled).map((x) => x.trim());
    return type === "checklist" ? list.map(asTask) : list;
  };
  return {
    done: clean("done"),
    next: clean("next"),
    blockers: clean("blockers"),
    other: clean("other"),
    extra: Object.fromEntries(sections.filter((x) => x.kind === "extra").map((x) => [x.k.slice(2), clean(x.k)])),
  };
}

/**
 * A draft rebased onto a version saved elsewhere meanwhile, tab by tab and section by section: lists merge item
 * by item, a free text (`texts`: keys of the text sections) goes to the side that changed it
 */
export function rebaseDraft(base: Draft, mine: Draft, theirs: Draft, texts: Set<string>): Draft {
  const tab = (b: TabItems = {}, m: TabItems = {}, t: TabItems = {}): TabItems =>
    Object.fromEntries(
      [...new Set([...Object.keys(m), ...Object.keys(t)])].map((k) => [
        k,
        texts.has(k) ? [rebaseText(b[k]?.[0] ?? "", m[k]?.[0] ?? "", t[k]?.[0] ?? "")] : rebaseList(b[k] ?? [], m[k] ?? [], t[k] ?? []),
      ]),
    );
  return {
    tab: mine.tab,
    items: tab(base.items, mine.items, theirs.items),
    byProject: Object.fromEntries(
      [...new Set([...Object.keys(mine.byProject), ...Object.keys(theirs.byProject)])].map((id) => [
        id,
        tab(base.byProject[id], mine.byProject[id], theirs.byProject[id]),
      ]),
    ),
  };
}

/** Who holds a project's sheet right now (their reservation not lapsed), or null */
export const sheetHolder = (p: Pick<ProjectDTO, "sheet">, now: number) =>
  p.sheet?.editingById && (p.sheet.editingUntil ?? 0) > now ? p.sheet.editingById : null;

/** How an item planned last time was handled; "here": brought back as a box not ticked yet in "done" */
export type PlanStatus = "done" | "here" | "next" | "skip" | null;

/**
 * Sorting what was planned last time: an item is handled when it shows up in "Done" or "Planned" of the draft,
 * in any tab, or when the person dismissed it (`skipped`: dismissed items, folded as `planKey` does)
 */
export function planStatus(d: Pick<Draft, "items" | "byProject">, skipped: string[], n: string): PlanStatus {
  // Looked for in every tab (an item planned in a project's tab is sorted there), line by line (a free text holds
  // them in one block)
  const find = (k: string) =>
    [d.items, ...Object.values(d.byProject)]
      .flatMap((tab) => (tab[k] ?? []).flatMap((i) => i.split("\n")))
      .find((i) => planKey(i) === planKey(n));
  const done = find("done");
  if (done !== undefined) return taskOf(done).done === false ? "here" : "done";
  return find("next") !== undefined ? "next" : skipped.includes(planKey(n)) ? "skip" : null;
}

/** How a planned item is compared and remembered once dismissed: without its box, its case or its spaces */
export const planKey = (x: string) => plainItem(x).trim().toLowerCase();

/** Last time's plans still to sort */
export const pendingPlans = (next: string[], d: Pick<Draft, "items" | "byProject">, skipped: string[]) =>
  next.filter((n) => !planStatus(d, skipped, n));
