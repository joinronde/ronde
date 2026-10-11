import { type Locale, translator } from "@ronde/i18n";
import type { ActionStatus, RecordCheckIn, Section, SectionDef, SectionKey, SectionRole, SectionType } from "./types";

export const SECTION_KEYS: SectionKey[] = ["done", "next", "blockers", "other"];

export const SECTION_TYPES: SectionType[] = ["list", "checklist", "text"];

/** Name shown for the person running the meeting, or the translated default ("Host") */
export function hostName(settings: { hostLabel?: string } | null | undefined, locale: Locale): string {
  return settings?.hostLabel?.trim() || translator(locale, "common")("host");
}

export const SECTION_ROLES: SectionRole[] = ["achievement", "plan", "blocker", "note", "custom"];

/** Field of a check-in each role fills; custom sections go to `extra` */
export const ROLE_KIND: Record<Exclude<SectionRole, "custom">, SectionKey> = {
  achievement: "done",
  plan: "next",
  blocker: "blockers",
  note: "other",
};

/** Sections of a new meeting: the weekly sync (done, next, blockers, other) */
export const DEFAULT_SECTIONS: SectionDef[] = [
  { key: "done", label: "", role: "achievement", input: "list" },
  { key: "next", label: "", role: "plan", input: "list" },
  { key: "blockers", label: "", role: "blocker", input: "list" },
  { key: "other", label: "", role: "note", input: "list" },
];

/** Effective role of each section: a role other than "custom" is held by the first section having it */
function effectiveRoles(sections: SectionDef[]): SectionRole[] {
  const taken = new Set<SectionRole>();
  return sections.map((d) => {
    const role = d.role !== "custom" && taken.has(d.role) ? "custom" : d.role;
    taken.add(role);
    return role;
  });
}

/** Sections with their effective role (a duplicated role becomes "custom") */
export const withEffectiveRoles = (sections: SectionDef[]): SectionDef[] => {
  const roles = effectiveRoles(sections);
  return sections.map((d, i) => ({ ...d, role: roles[i]! }));
};

/** Key of the section behind a check-in field ("done", "x:<key>"), null when no section fills it */
export function sectionKeyOf(sections: SectionDef[], k: string): string | null {
  if (k.startsWith("x:")) return sections.some((s) => s.key === k.slice(2)) ? k.slice(2) : null;
  const def = withEffectiveRoles(sections).find((d) => d.role !== "custom" && ROLE_KIND[d.role] === k);
  return def?.key ?? null;
}

/** Check-in field a section fills: "done"… for a role, "x:<key>" for a custom section */
export function fieldOf(sections: SectionDef[], key: string): string | null {
  const def = withEffectiveRoles(sections).find((d) => d.key === key);
  if (!def) return null;
  return def.role === "custom" ? `x:${key}` : ROLE_KIND[def.role];
}

/** Options of a section as stored (`Section.behavior`): only the ones its role and type allow */
export function sectionBehavior(d: Pick<SectionDef, "role" | "input" | "carryPlans">): { carryPlans?: true } {
  return d.carryPlans && d.role === "achievement" && d.input === "checklist" ? { carryPlans: true } : {};
}

/**
 * Sections shown in check-ins. A role other than "custom" is held by one section at most: it fills the
 * matching check-in field (done, next, blockers, other); custom sections fill `extra`, by key.
 */
export function resolveSections(st: { sections: SectionDef[] }, locale: Locale): Section[] {
  const t = translator(locale, "sections");
  const roles = effectiveRoles(st.sections);
  return st.sections.map((d, i) => {
    const role = roles[i]!;
    if (role === "custom") return { k: "x:" + d.key, label: d.label.trim() || d.key, kind: "extra", type: d.input };
    const kind = ROLE_KIND[role];
    const carryPlans = sectionBehavior({ ...d, role }).carryPlans;
    return { k: kind, label: d.label.trim() || t(`defaults.${kind}`), kind, type: d.input, ...(carryPlans ? { carryPlans } : {}) };
  });
}

type CheckInFields = Omit<RecordCheckIn, "byProject">;

/** Check-in fields from items stored per section key; a section keeps its items when its role changes */
export function checkInFromItems(items: Record<string, string[]>, sections: SectionDef[]): Required<CheckInFields> {
  const out: Required<CheckInFields> = { done: [], next: [], blockers: [], other: [], extra: {} };
  const roles = effectiveRoles(sections);
  sections.forEach((d, i) => {
    const list = items[d.key] ?? [];
    const role = roles[i]!;
    if (role === "custom") out.extra[d.key] = list;
    else out[ROLE_KIND[role]] = list;
  });
  return out;
}

/** Items per section key, from check-in fields (the reverse of checkInFromItems) */
export function itemsFromCheckIn(f: CheckInFields, sections: SectionDef[]): Record<string, string[]> {
  const roles = effectiveRoles(sections);
  const out: Record<string, string[]> = {};
  sections.forEach((d, i) => {
    const role = roles[i]!;
    const list = role === "custom" ? f.extra?.[d.key] : f[ROLE_KIND[role]];
    if (list?.length) out[d.key] = list;
  });
  return out;
}

/** Every item of a check-in in one set of fields: the person's own, then those of each project tab */
export function allTabs(f: Partial<RecordCheckIn> | null | undefined): Omit<RecordCheckIn, "byProject"> {
  const tabs = [f ?? {}, ...Object.values(f?.byProject ?? {})];
  const extra: Record<string, string[]> = {};
  for (const tab of tabs) for (const [k, v] of Object.entries(tab.extra ?? {})) extra[k] = [...(extra[k] ?? []), ...v];
  const all = (k: SectionKey) => tabs.flatMap((tab) => tab[k] ?? []);
  return { done: all("done"), next: all("next"), blockers: all("blockers"), other: all("other"), extra };
}

/**
 * The repository a link points at, as the forges name it: "https://gitlab.com/group/sub/repo/-/issues" gives
 * "group/sub/repo", "https://github.com/owner/repo/pulls" gives "owner/repo"; null when it is not one
 */
export function repoPath(kind: "gitlab" | "github", url: string): string | null {
  let parts: string[];
  try {
    parts = new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return null;
  }
  const dash = parts.indexOf("-");
  if (dash >= 0) parts = parts.slice(0, dash);
  if (kind === "github") parts = parts.slice(0, 2);
  const path = parts.join("/").replace(/\.git$/, "");
  return parts.length >= 2 ? path.toLowerCase() : null;
}

/** Checklist item: stored as Markdown, "[x] done" or "[ ] to do" */
const TASK = /^\[( |x|X)\]\s+/;
export function taskOf(item: string): { done: boolean | null; text: string } {
  const m = TASK.exec(item);
  return m ? { done: m[1] !== " ", text: item.slice(m[0].length) } : { done: null, text: item };
}
export const taskItem = (text: string, done: boolean) => `[${done ? "x" : " "}] ${text}`;
/** Item text without its checkbox */
export const plainItem = (item: string) => taskOf(item).text;

/** Items of a section in a check-in */
export function itemsOf(f: Partial<RecordCheckIn> | null | undefined, sec: Section | string): string[] {
  const k = typeof sec === "string" ? sec : sec.k;
  if (!f) return [];
  if (k.startsWith("x:")) return f.extra?.[k.slice(2)] ?? [];
  return (f as Record<string, string[] | undefined>)[k] ?? [];
}

/** The check-in has at least one item (custom sections and the tabs of projects included) */
export function isCheckInFilled(f: Partial<RecordCheckIn> | null | undefined): boolean {
  if (!f) return false;
  return (
    SECTION_KEYS.some((k) => (f[k]?.length ?? 0) > 0) ||
    Object.values(f.extra ?? {}).some((v) => v.length > 0) ||
    Object.values(f.byProject ?? {}).some((p) => isCheckInFilled(p))
  );
}

/**
 * A list being written, rebased onto a version saved meanwhile elsewhere (the host fixing the check-in,
 * another tab): what was added here stays, what was removed here goes, the rest follows the saved version.
 * An item changed here counts as one removed and one added.
 */
export function rebaseList(base: readonly string[], mine: readonly string[], theirs: readonly string[]): string[] {
  const removed = base.filter((x) => !mine.includes(x));
  const added = mine.filter((x) => !base.includes(x));
  const out = theirs.filter((x) => !removed.includes(x));
  for (const x of added) if (!out.includes(x)) out.push(x);
  return out;
}

/** A free text rebased the same way: the side that changed it wins; changed on both sides, the one written here */
export function rebaseText(base: string, mine: string, theirs: string): string {
  return mine === base ? theirs : mine;
}

/**
 * Check-in filled in but not touched since the last meeting: the person was absent, their check-in
 * was kept and will be presented as is unless they update it.
 */
export function isCheckInStale(
  f: (Partial<RecordCheckIn> & { updatedAt?: number | null }) | null | undefined,
  lastArchivedAt: number | null,
): boolean {
  return isCheckInFilled(f) && lastArchivedAt !== null && (f?.updatedAt ?? 0) < lastArchivedAt;
}

/** Check-in ready for the meeting: filled in since the last meeting */
export const isCheckInReady = (f: Parameters<typeof isCheckInStale>[0], lastArchivedAt: number | null) =>
  isCheckInFilled(f) && !isCheckInStale(f, lastArchivedAt);

/** Team mood, from 1 (stormy) to 5 (sunny); labels live in the "moods" messages */
export const MOODS = [
  { v: 1, e: "⛈️", key: "stormy" },
  { v: 2, e: "🌧️", key: "rainy" },
  { v: 3, e: "⛅", key: "mixed" },
  { v: 4, e: "🌤️", key: "fair" },
  { v: 5, e: "☀️", key: "sunny" },
] as const;

/** Average mood (1 to 5) from the number of answers per mood */
export function moodAverage(counts: number[]): number | null {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return null;
  return counts.reduce((a, n, i) => a + n * (i + 1), 0) / total;
}

/**
 * Usefulness votes needed before their average shows (screens, minutes, stats): with fewer, the people who
 * voted could work out each other's rating
 */
export const RATING_MIN_VOTES = 3;

export const moodEmoji = (avg: number | null) => (avg === null ? "–" : MOODS[Math.min(4, Math.max(0, Math.round(avg) - 1))]!.e);

/** Icon of each action status; labels live in the "actionStatus" messages */
export const STATUS_ICON: Record<ActionStatus, string> = { open: "○", doing: "◐", done: "✓" };
export const ACTION_STATUSES: ActionStatus[] = ["open", "doing", "done"];

export const EMOJIS = ["👍", "👏", "🎉", "🤔"] as const;

/**
 * Signals: reactions that tell the speaker something, shown with their message and each animated
 * in its own way (`anim`, see the .fx-* styles). Sent by several people at once, they trigger a big
 * combo on the screen. Labels and combo texts live in the "signals" messages.
 */
export const SIGNALS = [
  { e: "🥱", key: "sleepy", anim: "zzz" },
  { e: "💯", key: "hundred", anim: "stamp" },
  { e: "🍿", key: "popcorn", anim: "pop" },
  { e: "🤯", key: "mindBlown", anim: "boom" },
  { e: "🔥", key: "fire", anim: "flame" },
  { e: "☕", key: "coffee", anim: "steam" },
] as const;
export type SignalKey = (typeof SIGNALS)[number]["key"];
export const signalOf = (emoji: string) => SIGNALS.find((x) => x.e === emoji);

/** Combo text of a signal; `name` is the speaker's first name, empty outside the round */
export function signalCombo(key: SignalKey, name: string, locale: Locale): string {
  const t = translator(locale, "signals");
  return name ? t(`${key}.comboNamed`, { name }) : t(`${key}.combo`);
}

/** On-screen animation of each reaction (.fx-* styles), raised hands and questions included */
const ANIMS: Record<string, string> = { "👍": "thumb", "👏": "clap", "🎉": "party", "🤔": "think", "✋": "wave", "❓": "swing" };
export const animOf = (emoji: string): string | undefined => signalOf(emoji)?.anim ?? ANIMS[emoji];

/** Every reaction accepted by the server */
export const REACTION_EMOJIS: string[] = [...EMOJIS, ...SIGNALS.map((x) => x.e)];

/** Window during which identical signals add up into a combo */
export const COMBO_WINDOW_MS = 20_000;

/** Distinct people needed for a combo: a third of the team, between 2 and 3 */
export const comboThreshold = (teamSize: number) => Math.max(2, Math.min(3, Math.ceil(teamSize / 3)));

/**
 * Number of distinct people who sent this signal within the combo window, or 0 below the threshold.
 * Someone who insists only counts once.
 */
export function comboCount(
  hits: { emoji: string; byId: string | null; at: number }[],
  emoji: string,
  now: number,
  threshold: number,
): number {
  const who = new Set(hits.filter((h) => h.emoji === emoji && now - h.at <= COMBO_WINDOW_MS).map((h) => h.byId ?? "?"));
  return who.size >= threshold ? who.size : 0;
}

/** Actor id of the host when they are not a team member */
export const HOST_ID = "host";

/** Votes per person on open topics */
export const VOTES_PER_PERSON = 3;

/** "2:05", or "+0:12" when over time */
export function mmss(ms: number): string {
  const neg = ms < 0;
  let s = Math.floor(Math.abs(ms) / 1000);
  const m = Math.floor(s / 60);
  s %= 60;
  return (neg ? "+" : "") + m + ":" + String(s).padStart(2, "0");
}
export const mmssPlain = (ms: number) => mmss(Math.abs(ms)).replace("+", "");

const dayOf = (iso: string) => new Date(iso + "T12:00:00");

export const isoDay = (d: Date) =>
  d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

/** The Monday after a date (YYYY-MM-DD). Without a date: the coming Monday, or today on a Monday. */
export function nextMonday(fromIso?: string | null, today: Date = new Date()): string {
  const d = fromIso ? dayOf(fromIso) : new Date(today);
  if (!fromIso && d.getDay() === 1) return isoDay(d);
  do d.setDate(d.getDate() + 1);
  while (d.getDay() !== 1);
  return isoDay(d);
}

const addDays = (d: Date, n: number) => d.setDate(d.getDate() + n);

/**
 * Date of the next meeting, from the weekday and the frequency picked by the host.
 * After a meeting: the following usual weekday, shifted by the frequency. Without a meeting: the next
 * usual weekday (today included). Never in the past.
 */
export function nextMeetingDate(
  p: { meetingWeekday: number; meetingEveryWeeks: number },
  afterIso?: string | null,
  today: Date = new Date(),
): string {
  const todayIso = isoDay(today);
  const every = Math.max(1, p.meetingEveryWeeks);
  const d = dayOf(afterIso ?? todayIso);
  if (afterIso) addDays(d, 1);
  while (d.getDay() !== p.meetingWeekday) addDays(d, 1);
  if (afterIso) addDays(d, 7 * (every - 1));
  while (isoDay(d) < todayIso) addDays(d, 7 * every);
  return isoDay(d);
}

export type ReminderWhen = "dayBefore" | "sameDay";

/** Day the reminder is sent: the working day before the meeting, or the same day */
export function reminderDate(meetingIso: string, when: ReminderWhen): string {
  const d = dayOf(meetingIso);
  if (when === "dayBefore")
    do addDays(d, -1);
    while (d.getDay() === 0 || d.getDay() === 6);
  return isoDay(d);
}

export const lines = (t: string | null | undefined) =>
  String(t ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

export const first = (n: string | null | undefined) => String(n ?? "").split(" ")[0];

export const initials = (n: string | null | undefined) =>
  String(n || "?")
    .split(/[\s'-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

const normWords = (t: string) =>
  new Set(
    String(t)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3),
  );

/** Similarity of two texts (0 to 1): share of meaningful words in common */
export function similarity(a: string, b: string): number {
  const A = normWords(a);
  const B = normWords(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  A.forEach((w) => {
    if (B.has(w)) n++;
  });
  return n / Math.min(A.size, B.size);
}

/** Duration in minutes: "45 min", "1 h", "1 h 30 min" */
export function fmtMinutes(min: number, locale: Locale): string {
  const t = translator(locale, "common");
  if (min < 60) return t("duration.minutes", { m: min });
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? t("duration.hoursMinutes", { h, m: String(m).padStart(2, "0") }) : t("duration.hours", { h });
}

/** Age of a date ("yesterday", "3 weeks ago"…) */
export function ago(iso: string, now: number, locale: Locale): string {
  const days = Math.round((now - dayOf(iso).getTime()) / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (days <= 0) return rtf.format(0, "day");
  if (days < 14) return rtf.format(-days, "day");
  if (days < 60) return rtf.format(-Math.round(days / 7), "week");
  return rtf.format(-Math.round(days / 30), "month");
}

/** Whether a ticket is kept: full path, end of path, or parent group (empty filter: all) */
export function matchesProjects(fullRef: string | undefined, projectsFilter: string): boolean {
  const wanted = projectsFilter
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const path = ((fullRef ?? "").split(/[#!]/)[0] ?? "").toLowerCase();
  return !wanted.length || wanted.some((w) => path === w || path.endsWith("/" + w) || path.startsWith(w + "/"));
}
