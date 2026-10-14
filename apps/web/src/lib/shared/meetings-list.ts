// The meetings of a workspace in a list: the ones live right now always on top, the others in the order chosen.
// Pure, for the server-free tests

export const MEETING_SORTS = ["next", "name", "recent", "actions"] as const;
export type MeetingSort = (typeof MEETING_SORTS)[number];

/** Live meetings first, the rest in the order they came (a stable sort) */
export function liveFirst<M>(list: readonly M[], isLive: (m: M) => boolean): M[] {
  return [...list.filter(isLive), ...list.filter((m) => !isLive(m))];
}

interface Sortable {
  name: string;
  next: { date: string; time: string; live: boolean } | null;
  lastHeld: string | null;
  openActions: number;
}

/**
 * The order asked, live meetings on top whatever it is: the next session soonest first (none last), by name,
 * the most recently held first, or the most open actions first
 */
export function sortMeetings<M extends Sortable>(list: readonly M[], sort: MeetingSort, locale = "en"): M[] {
  const byName = (a: M, b: M) => a.name.localeCompare(b.name, locale, { sensitivity: "base" });
  const when = (m: M) => (m.next ? `${m.next.date} ${m.next.time}` : "9999");
  const sorted = [...list].sort((a, b) => {
    if (sort === "name") return byName(a, b);
    if (sort === "recent") return (b.lastHeld ?? "").localeCompare(a.lastHeld ?? "") || byName(a, b);
    if (sort === "actions") return b.openActions - a.openActions || byName(a, b);
    return when(a).localeCompare(when(b)) || byName(a, b);
  });
  return liveFirst(sorted, (m) => !!m.next?.live);
}
