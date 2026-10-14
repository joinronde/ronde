// Reordering a list by dragging a row: where it lands, how the others make way. Pure, for the server-free tests

/** The list with the item at `from` moved to `to` */
export function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return [...list];
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

/**
 * Where the row taken from `from` would land with its middle at `y`, given the middles of the rows before the
 * drag began: from the middle of a neighbour on, it takes its place
 */
export function dropIndex(mids: readonly number[], from: number, y: number): number {
  let over = from;
  while (over > 0 && y <= mids[over - 1]!) over--;
  while (over < mids.length - 1 && y >= mids[over + 1]!) over++;
  return over;
}

/** How a row makes way while the one at `from` hovers at `over`: up (-1), down (1) or not at all */
export function rowShift(i: number, from: number, over: number): -1 | 0 | 1 {
  if (from < over && i > from && i <= over) return -1;
  if (from > over && i >= over && i < from) return 1;
  return 0;
}
