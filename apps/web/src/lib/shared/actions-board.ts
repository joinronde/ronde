import { fold } from "./search";

// The actions page, as a list or as a board: what it shows for a filter and a search, grouped by status, the
// oldest worries first. Pure, so the server-free tests check them

export const ACTION_COLUMNS = ["open", "doing", "done"] as const;
export type ActionColumn = (typeof ACTION_COLUMNS)[number];

export interface BoardAction {
  id: string;
  text: string;
  status: ActionColumn;
  meetingId: string;
  meeting: string;
  owner: { id: string; name: string };
  originDate: string | null;
  doneAt: string | null;
  carried: number;
}

/** The actions of a meeting (or all), whose text, meeting or owner holds the search (case and accents aside) */
export function filterActions<A extends BoardAction>(rows: A[], meetingId: string | null, query: string): A[] {
  const q = fold(query.trim());
  return rows.filter(
    (a) => (!meetingId || a.meetingId === meetingId) && (!q || fold(`${a.text} ${a.meeting} ${a.owner.name}`).includes(q)),
  );
}

/**
 * Each status with its actions: what waits longest first (the sessions it was carried over, then its date), the
 * done ones the most recent first
 */
export function columnsOf<A extends BoardAction>(rows: A[]): { status: ActionColumn; items: A[] }[] {
  return ACTION_COLUMNS.map((status) => ({
    status,
    items: rows
      .filter((a) => a.status === status)
      .sort((a, b) =>
        status === "done"
          ? (b.doneAt ?? "").localeCompare(a.doneAt ?? "")
          : b.carried - a.carried || (a.originDate ?? "").localeCompare(b.originDate ?? ""),
      ),
  }));
}

/** Waiting too long: carried over two sessions or more without being done */
export const isStuck = (a: Pick<BoardAction, "status" | "carried">) => a.status !== "done" && a.carried >= 2;

/** The status an action moves to from the keyboard: the next column, or the previous one */
export function nextColumn(status: ActionColumn, dir: 1 | -1): ActionColumn {
  const i = ACTION_COLUMNS.indexOf(status) + dir;
  return ACTION_COLUMNS[Math.max(0, Math.min(ACTION_COLUMNS.length - 1, i))]!;
}
