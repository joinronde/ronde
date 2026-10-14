// Long lists (a project's timeline, the decisions, the kudos, the history) read a month at a time and grow on
// demand: the first items, then "Show more". Neither pages to click through nor an endless scroll, so the
// end of the page stays in reach. Pure, for the server-free tests

/** Items shown at first, then added at each "Show more" */
export const MORE_STEP = 25;

/** The items, newest first, by month ("2026-10") */
export function byMonth<T>(items: readonly T[], dateOf: (item: T) => string): { key: string; items: T[] }[] {
  const months: { key: string; items: T[] }[] = [];
  for (const item of items) {
    const key = dateOf(item).slice(0, 7);
    const last = months[months.length - 1];
    if (last?.key === key) last.items.push(item);
    else months.push({ key, items: [item] });
  }
  return months;
}

/** The groups cut after `limit` items in all, and how many items are left out */
export function limitGroups<G extends { items: unknown[] }>(groups: readonly G[], limit: number): { groups: G[]; hidden: number } {
  const out: G[] = [];
  let left = limit;
  let hidden = 0;
  for (const g of groups) {
    if (left <= 0) {
      hidden += g.items.length;
      continue;
    }
    const kept = g.items.slice(0, left);
    hidden += g.items.length - kept.length;
    left -= kept.length;
    out.push({ ...g, items: kept });
  }
  return { groups: out, hidden };
}
