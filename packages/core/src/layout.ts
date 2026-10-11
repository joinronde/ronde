// Block layout of a page, picked by each person and kept in their preferences

/** Block columns: ids, in display order */
export type Layout = string[][];

export const layoutKey = (page: string) => "layout:" + page;

/** Maximum number of columns */
export const MAX_COLUMNS = 3;

/**
 * Saved layout reconciled with the default one: a block gone from the page is dropped, a new block
 * takes its default place (in its column, or the last one if there are fewer, after the neighbour
 * that precedes it). The chosen number of columns (1 to 3) is kept.
 */
export function mergeLayout(defaults: Layout, saved: unknown): Layout {
  const known = new Set(defaults.flat());
  if (!Array.isArray(saved) || saved.length < 1 || saved.length > MAX_COLUMNS) return defaults.map((c) => [...c]);
  const seen = new Set<string>();
  const out: Layout = saved.map((col) =>
    (Array.isArray(col) ? col : []).filter(
      (id): id is string => typeof id === "string" && known.has(id) && !seen.has(id) && !!seen.add(id),
    ),
  );
  defaults.forEach((col, c) =>
    col.forEach((id, i) => {
      if (seen.has(id)) return;
      seen.add(id);
      const target = out[Math.min(c, out.length - 1)]!;
      const before = col
        .slice(0, i)
        .reverse()
        .find((x) => target.includes(x));
      target.splice(before ? target.indexOf(before) + 1 : target.length, 0, id);
    }),
  );
  return out;
}

/** Move a block to column `col`, at position `index` (counted without the moved block) */
export function moveBlock(layout: Layout, id: string, col: number, index: number): Layout {
  const out = layout.map((c) => c.filter((x) => x !== id));
  const target = out[col];
  if (!target) return layout;
  target.splice(Math.max(0, Math.min(index, target.length)), 0, id);
  return out;
}

/** Change the number of columns: blocks of removed columns go to the end of the last kept one */
export function setColumnCount(layout: Layout, n: number): Layout {
  const count = Math.max(1, Math.min(MAX_COLUMNS, n));
  const out = layout.slice(0, count).map((c) => [...c]);
  for (const extra of layout.slice(count)) out[count - 1]!.push(...extra);
  while (out.length < count) out.push([]);
  return out;
}

export const sameLayout = (a: Layout, b: Layout) => JSON.stringify(a) === JSON.stringify(b);
