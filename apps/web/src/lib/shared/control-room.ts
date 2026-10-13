import type { Step } from "@ronde/core/meeting";
import { decisionsOf, MINUTES_PARTS, type MinutesPart } from "@ronde/core/minutes";
import type { ActionDTO, Section, Snapshot } from "@ronde/core/types";
import { first, isCheckInReady, plainItem, similarity } from "@ronde/core/util";

// What the control room computes from the meeting's state and its agenda. Pure, so the server-free tests check
// them too; the component keeps the storage, the clock and the translations, and passes them in

/** Today on this device, YYYY-MM-DD: the local calendar day, not the UTC one */
export const localToday = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** What the Start button sends: a session prepared for another day is first dated today (the schedule keeps its occurrence) */
export const startOp = (meetingDate: string, today = localToday()) => (meetingDate !== today ? "session.now" : "meeting.togglePlay");

/** Member a step is about: the person speaking, or the one whose questions are handled */
export const memberOfStep = (key: string) => (key.startsWith("qa:") ? key.slice(3) : key);

/** Speakers of the round whose check-in is ready for this meeting (filled in since the last one) */
export const filledCount = (agenda: Step[], s: Pick<Snapshot, "checkIns" | "lastArchivedAt">) =>
  agenda.filter((x) => x.type === "speaker").filter((x) => isCheckInReady(s.checkIns[x.id!], s.lastArchivedAt)).length;

type TitleKey = "qaTitle" | `stepTitles.${"intro" | "misc" | "end"}`;

/** Title of the current step: the person, block or project by name, the others by their kind */
export const stepTitle = (step: Step, t: (k: TitleKey) => string) =>
  step.type === "speaker" || step.type === "block" || step.type === "project"
    ? step.label
    : step.type === "qa"
      ? t("qaTitle")
      : t(`stepTitles.${step.type}`);

/** Label of the Next button: questions by their count, a speaker by first name, any other step by its label */
export const nextLabel = (next: Step | undefined, questions: (count: number) => string) =>
  next ? (next.type === "qa" ? questions(next.pending || next.total || 0) : next.type === "speaker" ? first(next.label) : next.label) : "";

export type Blocker = { id: string; b: string; projectId: string | null };

/** Items of a section in the tabs of a project, each with its author (the stage's `projectEntries`) */
export type EntriesOf = (
  checkIns: Snapshot["checkIns"],
  order: string[],
  projectId: string,
  sec: Section,
) => { ownerId: string; text: string }[];

/**
 * Blockers to turn into actions: those of each turn (with the projects that have no step of their own), then those
 * of each project's step. A project with its own step is left out of the turns so nothing is listed twice; blank
 * lines are left out
 */
export function blockersOf(
  s: Pick<Snapshot, "checkIns">,
  agenda: Step[],
  sections: Section[],
  withTurn: Set<string>,
  entriesOf: EntriesOf,
): Blocker[] {
  const blockSec = sections.find((x) => x.kind === "blockers");
  return [
    ...agenda
      .filter((x) => x.type === "speaker")
      .flatMap((x) => {
        const f = s.checkIns[x.id!];
        return [
          ...(f?.blockers ?? []).map((b) => ({ id: x.id!, b: plainItem(b), projectId: null })),
          ...Object.entries(f?.byProject ?? {})
            .filter(([projectId]) => !withTurn.has(projectId))
            .flatMap(([projectId, tab]) => tab.blockers.map((b) => ({ id: x.id!, b: plainItem(b), projectId }))),
        ];
      }),
    ...(blockSec
      ? agenda
          .filter((x) => x.type === "project")
          .flatMap((x) =>
            entriesOf(s.checkIns, x.speakers ?? [], x.projectId!, blockSec).map((e) => ({
              id: e.ownerId,
              b: plainItem(e.text),
              projectId: x.projectId!,
            })),
          )
      : []),
    // A line left blank in a check-in has nothing to follow up: no empty row offering to make it an action (nor an
    // emptied box saved as "[ ] [ ]" before that was fixed)
  ].filter((x) => x.b.trim() && !/^\[[ xX]\]$/.test(x.b.trim()));
}

/** A blocker already followed by an open action: the one made from it, or one of its author's that says much the same */
export const isTracked = (actions: ActionDTO[], id: string, b: string) =>
  actions.some((a) => a.status !== "done" && (a.originText === b || (a.ownerId === id && similarity(a.originText ?? a.text, b) >= 0.5)));

/** Actions in the order the host reviews them: the open ones first, each group oldest first */
export const sortActions = (actions: ActionDTO[]) =>
  [...actions].sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || a.createdAt - b.createdAt);

/** Summary before archiving: decisions noted, actions created since the start, speakers without any notes */
export function minutesCheck(s: Pick<Snapshot, "notes" | "actions">, startedAt: number | null, agenda: Step[]) {
  const decisions = Object.values(s.notes).reduce((n, v) => n + decisionsOf(v).length, 0);
  const created = s.actions.filter((a) => startedAt && a.createdAt >= startedAt).length;
  // Notes on the turn or on its questions both count
  const silent = agenda.filter((x) => x.type === "speaker" && !s.notes[x.key]?.trim() && !s.notes["qa:" + x.key]?.trim());
  return { decisions, created, silent };
}

/** Team inputs left out of the minutes, as stored: only known parts, each once, in their usual order */
export const parseOmit = (raw: string | null): MinutesPart[] => {
  try {
    const v = JSON.parse(raw ?? "[]") as unknown;
    return Array.isArray(v) ? MINUTES_PARTS.filter((k) => v.includes(k)) : [];
  } catch {
    return [];
  }
};

/** Team inputs left out of the minutes, to store */
export const serializeOmit = (omit: MinutesPart[]) => JSON.stringify(omit);

type OrderState = Pick<Snapshot, "blockData"> & { meeting: Pick<NonNullable<Snapshot["meeting"]>, "stepKey" | "projectsAdded"> | null };

/** The project round as the host can reorder it: its steps, those passed, those left out, those added by hand */
export function projectOrderOf(s: OrderState, agenda: Step[]) {
  const steps = agenda.filter((x) => x.type === "project");
  const ids = steps.map((x) => x.projectId!);
  // Steps up to the current one, included
  const done = new Set(agenda.slice(0, agenda.findIndex((x) => x.key === s.meeting?.stepKey) + 1).map((x) => x.key));
  const list = s.blockData.projects?.list ?? [];
  // Projects nobody wrote about have no step: say which, so nobody wonders where they went
  const skipped = list.filter((p) => !p.filled && !ids.includes(p.id));
  const added = new Set(s.meeting?.projectsAdded ?? []);
  const filled = new Set(list.filter((p) => p.filled).map((p) => p.id));
  const showOrder = steps.length > 1 || steps.some((x) => added.has(x.projectId!));
  return { steps, ids, done, skipped, added, filled, showOrder };
}

/** Whether a project can move up or down: never above the step running or already done, it would be skipped */
export const canMove = (steps: Step[], done: Set<string>, i: number, d: -1 | 1) =>
  d === -1 ? !(i === 0 || done.has(steps[i]!.key) || done.has(steps[i - 1]!.key)) : !(i === steps.length - 1 || done.has(steps[i]!.key));

/** The order with the project at `i` swapped with its neighbour (only called within bounds: the buttons say so) */
export const moveProject = (ids: string[], i: number, d: -1 | 1) => {
  const next = [...ids];
  [next[i], next[i + d]] = [next[i + d]!, next[i]!];
  return next;
};

/** The order drawn at random (Fisher-Yates), with the random source passed in for the tests */
export const shuffleProjects = (ids: string[], random: () => number = Math.random) => {
  const next = [...ids];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [next[i], next[j]] = [next[j]!, next[i]!];
  }
  return next;
};
