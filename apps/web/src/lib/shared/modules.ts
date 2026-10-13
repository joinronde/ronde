import type { PokerDTO, RetroDTO } from "@ronde/core/types";

// What the meeting modules (planning poker, retrospective, random draws) compute for their screens. Pure, so the
// server-free tests check them too

type PokerItem = PokerDTO["items"][number];

/** The item being estimated: the first one without an estimate */
export const currentItem = (p: PokerDTO): PokerItem | undefined => p.items.find((i) => i.final === null) ?? p.items[p.items.length - 1];

/** Average of the numeric cards, null without any */
export function average(votes: { value: string }[]): number | null {
  // "?", "☕" and the t-shirt sizes are not numbers: they do not weigh on the average
  const n = votes.map((v) => Number(v.value)).filter((x) => Number.isFinite(x));
  return n.length ? n.reduce((a, b) => a + b, 0) / n.length : null;
}

type RetroCard = RetroDTO["cards"][number];
type RetroGroup = RetroDTO["groups"][number];

/** A group is named after its first note until the host gives it a title */
export const titleOf = (g: RetroGroup, cards: RetroCard[]) => g.title || cards.find((c) => c.groupId === g.id)?.text || "";

/** Most voted groups first, then in the host's order */
export const byVotes = (a: RetroGroup, b: RetroGroup) => b.votes - a.votes || a.position - b.position;

/** Sector path of a wheel of radius 100 centred on 0,0, around `angle` (degrees, clockwise from the top) */
export function sector(angle: number, size: number): string {
  const pt = (a: number) => {
    const r = ((a - 90) * Math.PI) / 180;
    return `${(100 * Math.cos(r)).toFixed(2)} ${(100 * Math.sin(r)).toFixed(2)}`;
  };
  return `M0 0 L${pt(angle - size / 2)} A100 100 0 ${size > 180 ? 1 : 0} 1 ${pt(angle + size / 2)} Z`;
}
