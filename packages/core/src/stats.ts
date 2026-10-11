// Stats of a meeting. The server computes them (SQL over the archived sessions and their check-in items)
// and sends this summary; the projects and the fuzzy parts (recurring blockers) are the pure functions below.

import { sameItem } from "./record";
import type { ActionStatus, ProjectHealth } from "./types";
import { plainItem, similarity } from "./util";

/** One archived session */
export interface SessionStats {
  date: string;
  durationMs: number;
  present: number;
  absent: number;
  absentNames: string[];
  /** Items planned at the previous session by the people presented, and those reported done */
  planned: number;
  done: number;
  blockers: number;
  questions: number;
  hands: number;
  kudos: number;
  answers: number;
  /** Average mood (1 to 5) and number of answers */
  mood: number | null;
  moodVotes: number;
  /** Average usefulness (1 to 5) rated at the wrap-up, and number of ratings */
  rating: number | null;
  ratingVotes: number;
}

export interface StatsDTO {
  /** Oldest first */
  sessions: SessionStats[];
  /** Average speaking time per person, longest first */
  speaking: { id: string; name: string; avgMs: number; turns: number }[];
  /** Turns within the target speaking time; average overrun of the others */
  onTime: { ok: number; total: number; overMs: number };
  actions: {
    open: number;
    resolved: number;
    /** Median days from creation to done */
    medianDays: number | null;
    /** Open for more than 3 weeks, oldest first */
    stale: {
      id: string;
      text: string;
      ownerId: string;
      ownerName: string;
      status: ActionStatus;
      originDate: string | null;
      days: number;
    }[];
  };
  /** Per project: its "done" items and its health at each session */
  projects: { id: string; name: string; total: number; perSession: number[]; health: (ProjectHealth | null)[]; last: string }[];
  /** Blockers raised again at several sessions */
  recurring: { personId: string; name: string; text: string; dates: string[]; withAction: boolean }[];
}

export const median = (v: number[]): number | null => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Per project and per session: the "done" items written about it, and its health (newest name wins) */
export function projectProgress(
  dates: string[],
  entries: { date: string; projectId: string; name: string; done: number; health: ProjectHealth | null }[],
): StatsDTO["projects"] {
  const index = new Map(dates.map((d, i) => [d, i]));
  const projs = new Map<string, { name: string; w: number[]; h: (ProjectHealth | null)[]; last: string }>();
  for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    const w = index.get(e.date);
    if (w === undefined) continue;
    let x = projs.get(e.projectId);
    if (!x)
      projs.set(e.projectId, (x = { name: e.name, w: new Array(dates.length).fill(0), h: new Array(dates.length).fill(null), last: "" }));
    x.name = e.name;
    x.w[w]! += e.done;
    if (e.health) x.h[w] = e.health;
    if (e.date > x.last) x.last = e.date;
  }
  return [...projs.entries()]
    .map(([id, d]) => ({ id, name: d.name, total: d.w.reduce((a, b) => a + b, 0), perSession: d.w, health: d.h, last: d.last }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/** Blockers a person raised at several sessions (same words), and whether an open action follows them */
export function recurringBlockers(
  blockers: { personId: string; name: string; text: string; date: string }[],
  openActions: { ownerId: string; text: string; originText: string | null }[],
): StatsDTO["recurring"] {
  const groups: { personId: string; items: typeof blockers }[] = [];
  for (const b of blockers) {
    const text = plainItem(b.text);
    const g = groups.find((g) => g.personId === b.personId && similarity(plainItem(g.items[0]!.text), text) >= 0.5);
    if (g) g.items.push(b);
    else groups.push({ personId: b.personId, items: [b] });
  }
  return groups
    .map((g) => ({ g, dates: [...new Set(g.items.map((i) => i.date))].sort() }))
    .filter((x) => x.dates.length >= 2)
    .sort((a, b) => b.dates.length - a.dates.length)
    .map(({ g, dates }) => ({
      personId: g.personId,
      name: g.items[0]!.name,
      text: plainItem(g.items[g.items.length - 1]!.text),
      dates,
      withAction: openActions.some((a) => a.ownerId === g.personId && g.items.some((i) => sameItem(i.text, a.originText ?? a.text))),
    }));
}
