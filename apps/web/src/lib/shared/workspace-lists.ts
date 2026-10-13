import { PROJECT_STATUSES, type ProjectHealth, type ProjectStatus } from "@ronde/core/types";
import { fold } from "./search";

// What the workspace pages compute from their lists: the directory search, the portfolio's filters and
// groups, programmes and their depth, the seats of the next session. Pure, so the server-free tests check them

type Named = { firstName: string; lastName: string };

/** First and last name, without a trailing space when one is missing */
export const fullName = (p: Named) => `${p.firstName} ${p.lastName}`.trim();

/** The directory as searched: the text typed anywhere in the name, the email or the job category (case aside) */
export function peopleMatching<P extends Named & { email: string; jobCategoryId: string | null }>(
  people: P[],
  query: string,
  category: Map<string, string>,
): P[] {
  // Accents left aside, as in every search of the app: "lea" finds Léa
  const q = fold(query.trim());
  if (!q) return people;
  return people.filter((p) => fold(`${fullName(p)} ${p.email} ${category.get(p.jobCategoryId ?? "") ?? ""}`).includes(q));
}

/** Programmes go this deep at most: a programme, its projects, their sub-projects */
export const MAX_DEPTH = 3;

type Tree = Map<string, { id: string; parentId: string | null }>;

/** The top programme a project belongs to (itself when it is in none); a broken or looping chain stops after 5 steps */
export function rootOf(byId: Tree, id: string): string {
  let at = byId.get(id);
  for (let i = 0; at?.parentId && byId.has(at.parentId) && i < 5; i++) at = byId.get(at.parentId);
  return at?.id ?? id;
}

/** How deep a project sits: 1 for a top one, 2 under a programme... counting one more than MAX_DEPTH at most */
export function depthIn(byId: Map<string, { parentId: string | null }>, id: string): number {
  let depth = 1;
  for (let at = byId.get(id)?.parentId; at && depth <= MAX_DEPTH; at = byId.get(at)?.parentId) depth++;
  return depth;
}

/** The statuses the portfolio shows by default */
export const OPEN_STATUSES: ProjectStatus[] = ["proposed", "active", "paused"];

export type StatusFilter = "open" | ProjectStatus | "all";
export type HealthFilter = ProjectHealth | "none" | "";

type Listed = { name: string; summary: string; status: ProjectStatus; archived: boolean; mine: boolean };

/** A project kept by the status, "mine" and text filters (the needle already trimmed and lowercased) */
export function projectMatches(p: Listed, f: { status: StatusFilter; mine: boolean; needle: string }): boolean {
  const { status, mine } = f;
  const needle = fold(f.needle);
  return (
    (status === "all" ? true : status === "open" ? OPEN_STATUSES.includes(p.status) && !p.archived : p.status === status && !p.archived) &&
    (!mine || p.mine) &&
    (!needle || fold(p.name).includes(needle) || fold(p.summary).includes(needle))
  );
}

/** A project of this health ("none": not given yet); a blank filter keeps them all */
export const hasHealth = (p: { health: ProjectHealth | null }, h: HealthFilter) => !h || (h === "none" ? !p.health : p.health === h);

export type PortfolioGroup<P> = { key: string; title: string; sub: string; color: number | null; items: P[] };

type Grouped = {
  id: string;
  name: string;
  summary: string;
  color: number;
  themeId: string | null;
  status: ProjectStatus;
  parentId: string | null;
};

/**
 * The portfolio's sections: one per theme then the projects in none; one per programme (with the projects it
 * holds at any level) then those in none; or one per status. Empty sections are left for the caller to hide.
 */
export function projectGroups<P extends Grouped>(
  group: "theme" | "status" | "programme",
  all: { themes: { id: string; name: string; description: string; color: number }[]; projects: P[] },
  shown: P[],
  t: (k: "noTheme" | "noProgramme" | `status.${ProjectStatus}`) => string,
): PortfolioGroup<P>[] {
  if (group === "theme")
    return [
      ...all.themes.map((th) => ({
        key: th.id,
        title: th.name,
        sub: th.description,
        color: th.color,
        items: shown.filter((p) => p.themeId === th.id),
      })),
      { key: "none", title: t("noTheme"), sub: "", color: null, items: shown.filter((p) => !p.themeId) },
    ];
  if (group === "programme") {
    const byId = new Map(all.projects.map((p) => [p.id, p]));
    // A programme is a top project that holds others. A project under a programme the viewer cannot see
    // (members only) counts as a top one: otherwise it would be in no section at all
    const top = (p: P) => !p.parentId || !byId.has(p.parentId);
    const holds = (p: P) => all.projects.some((c) => c.parentId === p.id);
    return [
      ...all.projects
        .filter((p) => top(p) && holds(p))
        .map((root) => ({
          key: root.id,
          title: root.name,
          sub: root.summary,
          color: root.color,
          items: shown.filter((p) => p.id === root.id || rootOf(byId, p.id) === root.id),
        })),
      { key: "none", title: t("noProgramme"), sub: "", color: null, items: shown.filter((p) => top(p) && !holds(p)) },
    ];
  }
  return PROJECT_STATUSES.map((s) => ({
    key: s,
    title: t(`status.${s}`),
    sub: "",
    color: null,
    items: shown.filter((p) => p.status === s),
  }));
}

/** Whole days from one date to another (YYYY-MM-DD), counted at noon UTC so no time zone or DST shifts them */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/**
 * The seats around the next session's table: the ready people first (in their order), at most `max`; how many
 * more are left out; and the share of the ring the "ready" arc covers, ending halfway to the first seat not ready
 */
export function heroSeats<P extends { id: string }>(people: P[], ready: Set<string>, max = 8) {
  const seats = [...people].sort((a, b) => Number(ready.has(b.id)) - Number(ready.has(a.id))).slice(0, max);
  const shownReady = seats.filter((p) => ready.has(p.id)).length;
  const share = shownReady === seats.length ? 1 : shownReady ? (shownReady - 0.5) / seats.length : 0;
  return { seats, more: people.length - seats.length, share };
}
