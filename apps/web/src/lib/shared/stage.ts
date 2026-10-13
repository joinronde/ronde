import type { Step } from "@ronde/core/meeting";
import type { CheckInFields, Section, Snapshot } from "@ronde/core/types";
import { itemsOf, plainItem } from "@ronde/core/util";

// What the stage computes from the meeting's state: who joined an item, the items about a project, when the
// meeting starts and how the waiting pill words it. Pure, so the server-free tests check them too

/** Projects that have their own step in the agenda: their items are presented there, not in each turn */
export const projectsWithTurn = (agenda: Step[]) => new Set(agenda.filter((x) => x.type === "project").map((x) => x.projectId!));

/** People who joined an item someone else wrote, in the order they did */
export const joinedOf = (
  s: Pick<Snapshot, "contributors">,
  item: { ownerId: string; projectId: string | null; section: string; text: string },
) =>
  s.contributors
    .filter((c) => c.ownerId === item.ownerId && c.projectId === item.projectId && c.section === item.section && c.itemText === item.text)
    .map((c) => c.personId);

/** Items written about a project, by everyone, for one section */
export function projectEntries(
  checkIns: Record<string, { byProject: Record<string, CheckInFields> }>,
  order: string[],
  projectId: string,
  sec: Section,
): { ownerId: string; text: string }[] {
  // The speaking order first, then anyone else who wrote: each person once
  const people = [...new Set([...order, ...Object.keys(checkIns)])];
  return people.flatMap((ownerId) => itemsOf(checkIns[ownerId]?.byProject[projectId], sec).map((text) => ({ ownerId, text })));
}

/** Is the highlighted text an item of this check-in? */
export const sectionsHave = (f: Parameters<typeof itemsOf>[0], sections: Section[], text: string) =>
  sections.some((sec) => itemsOf(f, sec).some((i) => plainItem(i) === text));

/** The meeting's date and time ("YYYY-MM-DD", "HH:MM") as an instant in the browser's time zone */
export function startTarget(date: string, time: string) {
  const [h, m] = time.split(":").map(Number);
  // Without a zone the date-time form is read as local time (the date-only form would be UTC)
  const d = new Date(date + "T00:00:00");
  d.setHours(h ?? 14, m ?? 0, 0, 0);
  return d.getTime();
}

/** Planned start: the instant set by the schedule (meeting time zone), otherwise the date and time locally */
export const plannedStart = (m: { date: string; time: string; plannedAt: number | null }) => m.plannedAt ?? startTarget(m.date, m.time);

const MINUTE = 60_000;
const HOUR = 3_600_000;

type WaitKey = "waitingForStart" | "startingNow" | "startsInSeconds" | "startsInMinutes" | "startsAt";

/** What the pre-meeting pill says, `ms` before the planned start (negative once it has passed) */
export function waitLabel(
  ms: number,
  meeting: { date: string; time: string },
  locale: string,
  t: (key: WaitKey, values?: Record<string, string | number>) => string,
): string {
  // Time long gone (meeting not started, or date to update): nothing imminent is announced any more
  if (ms <= -30 * MINUTE) return t("waitingForStart");
  if (ms <= 0) return t("startingNow");
  if (ms <= MINUTE) return t("startsInSeconds", { s: Math.ceil(ms / 1000) });
  if (ms <= HOUR) return t("startsInMinutes", { m: Math.ceil(ms / MINUTE) });
  if (ms <= 12 * HOUR) return t("startsAt", { time: meeting.time });
  // Read locally at noon: the meeting's own day, clear of the zones whose clocks change at midnight
  const day = new Date(meeting.date + "T12:00:00").toLocaleDateString(locale, { weekday: "long" });
  return `${day.charAt(0).toUpperCase() + day.slice(1)} · ${meeting.time}`;
}

/** Class of the pre-meeting pill: late once the start has come, soon in the last five minutes */
export const waitTone = (ms: number) => (ms <= -30 * MINUTE ? "" : ms <= 0 ? " late" : ms <= 5 * MINUTE ? " soon" : "");
