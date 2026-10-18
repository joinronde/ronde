import type { AgendaBlock } from "@ronde/core/agenda";
import type { ActionDTO, SlideItemDTO } from "@ronde/core/types";

// Slides of the agenda, the same on the shared screen, on "My screen" and in the control room

export type SlideBlock = Extract<AgendaBlock, { type: "slide" }>;

/** The slide of an agenda by its id, or null */
export const slideOf = (agenda: readonly AgendaBlock[], blockId: string | undefined): SlideBlock | null =>
  agenda.find((b): b is SlideBlock => b.type === "slide" && b.id === blockId) ?? null;

/** Slides that take what people post (irritants), in agenda order */
export const postableSlides = (agenda: readonly AgendaBlock[]): SlideBlock[] =>
  agenda.filter((b): b is SlideBlock => b.type === "slide" && b.kind === "irritants");

/** What was posted on a slide: the items not yet turned into an action first, each group oldest first */
export const itemsOf = (items: readonly SlideItemDTO[], blockId: string): SlideItemDTO[] =>
  items.filter((i) => i.blockId === blockId).sort((a, b) => Number(!!a.actionId) - Number(!!b.actionId));

/** The open actions to review: the oldest first (they waited longest), those under way after those not started */
export function actionsToReview(actions: readonly ActionDTO[]): ActionDTO[] {
  const rank = { open: 0, doing: 1, done: 2 } as const;
  return actions
    .filter((a) => a.status !== "done")
    .sort(
      (a, b) => (a.originDate ?? "9").localeCompare(b.originDate ?? "9") || rank[a.status] - rank[b.status] || a.createdAt - b.createdAt,
    );
}

/** Actions decided while a step was on, at the session of `date` */
export const decidedAt = (actions: readonly ActionDTO[], stepKey: string, date: string): ActionDTO[] =>
  actions.filter((a) => a.originStep === stepKey && a.originDate === date);
