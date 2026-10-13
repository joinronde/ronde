import { limitOf, type Step, spentOf } from "@ronde/core/meeting";
import type { MeetingDTO } from "@ronde/core/types";
import { first } from "@ronde/core/util";

// Where the meeting stands as seen by a participant, from the meeting's state and the clock. Pure, so the
// server-free tests check it too

/** The status bar shows this long before the planned start (a quarter of an hour) */
export const LIVE_SOON_MS = 15 * 60_000;

export type LiveInput = {
  m: MeetingDTO | null;
  agenda: Step[];
  /** Index of the current step in the agenda */
  cur: number;
  now: number;
  /** The clock is the browser's (before hydration it is the server's, frozen) */
  hydrated: boolean;
  /** The viewer's member id, if they take part */
  me: string | null | undefined;
  speakSec: number;
  t: (k: "yourTurnTitle" | "youreNext") => string;
};

export type LiveStatus =
  | { state: "none"; title: string }
  | { state: "ended"; title: string }
  | {
      state: "live" | "waiting";
      label: string;
      /** Time left to the current speaker (ms, negative when over), null when nobody speaks */
      rem: number | null;
      turn: "mine" | "next" | "soon" | null;
      /** People still speaking before the viewer, the current speaker included */
      before: number;
      title: string;
      current: string | null;
    };

/** The planned start of a meeting not started: its instant, or its local date and time */
export function plannedStartOf(m: Pick<MeetingDTO, "date" | "time" | "plannedAt">): number {
  const [h, min] = m.time.split(":").map(Number);
  return m.plannedAt ?? new Date(m.date + "T00:00:00").setHours(h ?? 14, min ?? 0, 0, 0);
}

/** Where the meeting stands, as seen by the viewer: current step, timer, and when their turn comes */
export function liveStatus({ m, agenda, cur, now, hydrated, me, speakSec, t }: LiveInput): LiveStatus {
  const started = !!m?.startedAt;
  const step = m ? agenda[cur] : undefined;
  const speaking = started && step?.type === "speaker";
  if (!m || !step) return { state: "none", title: "" };
  if (step.type === "end") return { state: "ended", title: "" };
  // Before the start, the bar only shows close to the planned time
  if (!started && (!hydrated || plannedStartOf(m) - now > LIVE_SOON_MS)) return { state: "none", title: "" };
  const sp = agenda.filter((x) => x.type === "speaker");
  const myPos = me ? agenda.findIndex((x) => x.key === me) : -1;
  // People still speaking before me (the current speaker included)
  const before = myPos > cur ? agenda.slice(speaking ? cur : cur + 1, myPos).filter((x) => x.type === "speaker").length : 0;
  // "next": nobody left before me once the current step is over (the speaker, or the intro, the questions…)
  const ahead = speaking ? before - 1 : before;
  const turn: "mine" | "next" | "soon" | null =
    !started || myPos < 0 ? null : myPos === cur ? "mine" : myPos > cur ? (ahead === 0 ? "next" : ahead <= 2 ? "soon" : null) : null;
  const rem = speaking ? limitOf(m, step.key, speakSec, step) - spentOf(m, step.key, now) : null;
  const label = step.type === "speaker" ? `${first(step.label)} · ${sp.findIndex((x) => x.key === step.key) + 1}/${sp.length}` : step.label;
  const title =
    !started || !hydrated
      ? ""
      : turn === "mine"
        ? `👉 ${t("yourTurnTitle")} — Ronde`
        : `🔴 ${label}${turn === "next" ? ` · ${t("youreNext")}` : ""} — Ronde`;
  return {
    state: started ? "live" : "waiting",
    label,
    rem,
    turn,
    before,
    title,
    current: speaking ? first(step.label) : null,
  };
}
