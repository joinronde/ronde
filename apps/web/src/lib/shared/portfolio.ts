import type { ProjectHealth } from "@ronde/core/types";

// The portfolio from five projects to two hundred: how dense it is shown, in what order, how many at first. Pure,
// so the server-free tests check them

export const PORTFOLIO_DENSITIES = ["cards", "list", "table"] as const;
export type PortfolioDensity = (typeof PORTFOLIO_DENSITIES)[number];
export const PORTFOLIO_SORTS = ["health", "name", "due", "updated"] as const;
export type PortfolioSort = (typeof PORTFOLIO_SORTS)[number];

/** Cards while they fit on a screen or two, a compact list beyond, a table for a large portfolio */
export const defaultDensity = (count: number): PortfolioDensity => (count <= 12 ? "cards" : count <= 60 ? "list" : "table");

/** Projects of a group shown at first, the rest one click away */
export const PAGE_SIZE: Record<PortfolioDensity, number> = { cards: 12, list: 30, table: 100 };

interface Sortable {
  name: string;
  health: ProjectHealth | null;
  targetDate: string | null;
  last: { date: string } | null;
}

/** Worst first: off track, at risk, not said, on track */
const HEALTH_RANK: Record<string, number> = { offTrack: 0, atRisk: 1, none: 2, onTrack: 3 };

/** The projects in the order asked: the ones in trouble first, by name, by due date (none last), or latest news first */
export function sortProjects<P extends Sortable>(list: P[], sort: PortfolioSort, locale = "en"): P[] {
  const byName = (a: P, b: P) => a.name.localeCompare(b.name, locale, { sensitivity: "base" });
  return [...list].sort((a, b) => {
    if (sort === "name") return byName(a, b);
    if (sort === "due") return (a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999") || byName(a, b);
    if (sort === "updated") return (b.last?.date ?? "").localeCompare(a.last?.date ?? "") || byName(a, b);
    return HEALTH_RANK[a.health ?? "none"]! - HEALTH_RANK[b.health ?? "none"]! || byName(a, b);
  });
}
