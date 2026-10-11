import type { TourStep } from "@ronde/ui/tour";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

export type ControlPane = "run" | "live" | "actions" | "topics" | "polls" | "random" | "minutes";

/** A step of the control-room tour, with the right-hand pane to open */
export type ControlTourStep = TourStep & { pane?: ControlPane };

/** Tour version: bumping it replays the tour once for every host */
export const CONTROL_TOUR_KEY = "ronde.tour.control.v1";

/** Steps in order: id (messages), chapter, highlighted element, pane, and the module the step presents */
const STEPS: { id: string; chapter: string; target?: string; fallback?: string; pane?: ControlPane; module?: string }[] = [
  { id: "welcome", chapter: "welcome" },
  { id: "runOrder", chapter: "prepare", target: "run-list", pane: "run" },
  { id: "controls", chapter: "run", target: "controls" },
  { id: "notes", chapter: "run", target: "notes" },
  { id: "minutes", chapter: "conclude", target: "pane", pane: "minutes" },
  { id: "finish", chapter: "conclude", target: "tour-btn" },
];

/** The control-room tour, in the viewer's language; steps of modules turned off are left out */
export function useControlTour(modules: Record<string, boolean>): ControlTourStep[] {
  const t = useTranslations("controlTour");
  // Stable while the same modules are on: the tour is not rebuilt at every render
  const on = Object.keys(modules)
    .filter((id) => modules[id])
    .join(",");
  return useMemo(
    () =>
      STEPS.filter((s) => !s.module || on.split(",").includes(s.module)).map((s) => ({
        chapter: t(`chapters.${s.chapter}` as "chapters.welcome"),
        title: t(`steps.${s.id}.title` as "steps.welcome.title"),
        target: s.target,
        fallback: s.fallback,
        pane: s.pane,
        body: t.rich(`steps.${s.id}.body` as "steps.welcome.body", {
          p: (chunks) => <p>{chunks}</p>,
          tip: (chunks) => <p className="tip">{chunks}</p>,
          ul: (chunks) => <ul>{chunks}</ul>,
          li: (chunks) => <li>{chunks}</li>,
          strong: (chunks) => <strong>{chunks}</strong>,
          em: (chunks) => <em>{chunks}</em>,
          kbd: (chunks) => <kbd>{chunks}</kbd>,
        }),
      })),
    [t, on],
  );
}
