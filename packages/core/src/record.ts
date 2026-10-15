// Record of an archived session: everything the minutes, the history and the stats need, frozen when the
// host archives. Versioned: `parseRecord` reads every format ever written and returns the current one.

import { z } from "zod";
import type { RecordCheckIn, Section, SectionDef, SectionKey } from "./types";
import { checkInFromItems, plainItem, resolveSections, similarity } from "./util";

/** Team inputs the host can leave out of the minutes; their own notes and the follow-up actions always stay */
export const MINUTES_PARTS = [
  "checkIns",
  "comments",
  "questions",
  "topics",
  "icebreaker",
  "mood",
  "rating",
  "kudos",
  "retro",
  "polls",
] as const;
export type MinutesPart = (typeof MINUTES_PARTS)[number];
export const isMinutesPart = (k: string): k is MinutesPart => (MINUTES_PARTS as readonly string[]).includes(k);

const sectionDef = z.object({
  key: z.string(),
  label: z.string(),
  role: z.enum(["achievement", "plan", "blocker", "note", "custom"]),
  input: z.enum(["list", "checklist", "text"]),
});

const recordItem = z.object({
  id: z.string(),
  /** Key of the section, in `sections` */
  section: z.string(),
  /** Markdown; a checklist item starts with "[ ] " or "[x] " */
  text: z.string(),
  /** Planned item of the previous session this one reports on */
  sourceItemId: z.string().nullable().default(null),
  /** Project it is about (written in the project's tab); null: the person's own */
  projectId: z.string().nullable().default(null),
  /** People who took part in it besides its author */
  with: z.array(z.string()).default([]),
});

const recordProject = z.object({
  id: z.string(),
  name: z.string(),
  /** Name of its theme; empty: none */
  theme: z.string().default(""),
  status: z.string(),
  health: z.enum(["onTrack", "atRisk", "offTrack"]).nullable(),
  /** Message of the day, from its sheet (Markdown) */
  headline: z.string().default(""),
  /** Members present at its step, in speaking order */
  speakers: z.array(z.string()).default([]),
  /** It had its step in the project round (otherwise its items were presented with each person) */
  presented: z.boolean(),
});

export const recordV1 = z.object({
  v: z.literal(1),
  date: z.string(),
  teamName: z.string(),
  /** Name shown for the person running the meeting, at the time of the meeting */
  hostLabel: z.string().default(""),
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  durationMs: z.number(),
  /** Time spent per step, in ms */
  spent: z.record(z.string(), z.number()),
  /** People presented, in speaking order */
  participants: z.array(z.object({ id: z.string(), name: z.string(), jobCategory: z.string() })),
  absent: z.array(z.object({ id: z.string(), name: z.string() })),
  /** Sections of the meeting, with their effective role; an empty label is the translated default */
  sections: z.array(sectionDef),
  checkIns: z.record(z.string(), z.object({ items: z.array(recordItem) })),
  /** Projects the meeting followed and that had something to say, in the order of the project round */
  projects: z.array(recordProject).default([]),
  /** Host notes per step key */
  notes: z.record(z.string(), z.string()),
  interactions: z.array(
    z.object({
      type: z.enum(["hand", "question"]),
      byId: z.string(),
      targetId: z.string().nullable(),
      text: z.string(),
      stepKey: z.string(),
      resolved: z.boolean(),
    }),
  ),
  topics: z.array(z.object({ text: z.string(), byId: z.string().nullable(), done: z.boolean(), votes: z.number().default(0) })),
  actions: z.array(
    z.object({
      text: z.string(),
      ownerId: z.string(),
      status: z.enum(["open", "doing", "done"]),
      /** Where it stood at the end of the session, in its owner's words */
      progress: z.string().nullable().default(null),
    }),
  ),
  /** Names of everyone mentioned, participants or not */
  names: z.record(z.string(), z.string()),
  icebreaker: z
    .object({ question: z.string(), answers: z.array(z.object({ byId: z.string(), text: z.string() })) })
    .nullable()
    .default(null),
  kudos: z.array(z.object({ fromId: z.string(), toId: z.string(), text: z.string() })).default([]),
  mood: z
    .object({ counts: z.array(z.number()), avg: z.number().nullable() })
    .nullable()
    .default(null),
  /** How useful the meeting was, rated from 1 to 5 at its wrap-up */
  rating: z
    .object({ counts: z.array(z.number()), avg: z.number().nullable() })
    .nullable()
    .default(null),
  /** Comments on check-in items; an empty text is a 👍 */
  comments: z.array(z.object({ itemId: z.string(), byId: z.string(), text: z.string() })).default([]),
  /** Planned date of the following session */
  nextDate: z.string().nullable().default(null),
  /** Team inputs left out of the minutes */
  omit: z.array(z.enum(MINUTES_PARTS)).default([]),
  /** Blocks of the agenda that were run (timeboxes keep their title) */
  agenda: z.array(z.object({ id: z.string(), type: z.string(), title: z.string().optional() })).default([]),
  /** Retrospective: columns and groups, with the text of their notes but never their authors */
  retro: z
    .object({
      blockId: z.string(),
      columns: z.array(z.object({ key: z.string(), label: z.string() })),
      groups: z.array(z.object({ id: z.string(), column: z.string(), title: z.string(), votes: z.number(), cards: z.array(z.string()) })),
    })
    .nullable()
    .default(null),
  /** Planning poker: the items and the estimate agreed */
  poker: z.array(z.object({ title: z.string(), final: z.string().nullable(), votes: z.array(z.string()) })).default([]),
  /** Parking lot: subjects set aside during the session, carried over to the next one */
  parking: z.array(z.object({ text: z.string(), byId: z.string().nullable() })).default([]),
  /** Polls and their totals */
  polls: z
    .array(
      z.object({
        question: z.string(),
        kind: z.string(),
        answers: z.number(),
        results: z.array(z.object({ value: z.string(), count: z.number() })),
      }),
    )
    .default([]),
});

export type RecordV1 = z.infer<typeof recordV1>;
export type RecordInput = z.input<typeof recordV1>;
export type RecordItem = RecordV1["checkIns"][string]["items"][number];
export type RecordProject = RecordV1["projects"][number];

// ---------- First format (before versions): one field per kind of section, comments by item text ----------

interface RecordV0 {
  date: string;
  teamName: string;
  hostLabel?: string;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number;
  spent?: Record<string, number>;
  participants?: { id: string; name: string; jobCategory: string }[];
  absent?: string[];
  updates?: Record<string, Partial<RecordCheckIn>>;
  notes?: Record<string, string>;
  interactions?: RecordV1["interactions"];
  topics?: { text: string; byId: string | null; done: boolean; votes?: number }[];
  actions?: RecordV1["actions"];
  names?: Record<string, string>;
  icebreaker?: RecordV1["icebreaker"];
  kudos?: RecordV1["kudos"];
  sections?: Section[];
  mood?: RecordV1["mood"];
  comments?: { ownerId: string; section: string; itemText: string; byId: string; text: string }[];
  nextDate?: string;
}

const KIND_ROLE: Record<SectionKey, SectionDef["role"]> = { done: "achievement", next: "plan", blockers: "blocker", other: "note" };
const V0_SECTIONS: Section[] = (["done", "next", "blockers", "other"] as const).map((k) => ({ k, label: "", kind: k }));

function fromV0(old: RecordV0): RecordInput {
  // A section of the first format is known by its kind ("done"…) or "x:<key>" for a custom one
  const v0Sections = old.sections?.length ? old.sections : V0_SECTIONS;
  const sections: SectionDef[] = v0Sections.map((s) => ({
    key: s.kind === "extra" ? s.k.slice(2) : s.kind,
    label: s.label,
    role: s.kind === "extra" ? "custom" : KIND_ROLE[s.kind],
    input: s.type ?? "list",
  }));
  const checkIns: RecordInput["checkIns"] = {};
  const idOf = new Map<string, string>();
  for (const [pid, u] of Object.entries(old.updates ?? {})) {
    const items: RecordItem[] = [];
    v0Sections.forEach((s, i) => {
      const list = s.kind === "extra" ? (u.extra?.[s.k.slice(2)] ?? []) : (u[s.kind] ?? []);
      list.forEach((text, n) => {
        const id = `${pid}:${sections[i]!.key}:${n}`;
        items.push({ id, section: sections[i]!.key, text, sourceItemId: null, projectId: null, with: [] });
        idOf.set(`${pid}\u0000${s.k}\u0000${text}`, id);
      });
    });
    checkIns[pid] = { items };
  }
  const names = old.names ?? {};
  return {
    v: 1,
    date: old.date,
    teamName: old.teamName,
    hostLabel: old.hostLabel ?? "",
    startedAt: old.startedAt ?? null,
    endedAt: old.endedAt ?? null,
    durationMs: old.durationMs ?? 0,
    spent: old.spent ?? {},
    participants: old.participants ?? [],
    // Absent people were kept by name only
    absent: (old.absent ?? []).map((name) => ({ id: Object.keys(names).find((id) => names[id] === name) ?? "", name })),
    sections,
    checkIns,
    notes: old.notes ?? {},
    interactions: old.interactions ?? [],
    topics: old.topics ?? [],
    actions: old.actions ?? [],
    names,
    icebreaker: old.icebreaker ?? null,
    kudos: old.kudos ?? [],
    mood: old.mood ?? null,
    rating: null,
    comments: (old.comments ?? []).flatMap((c) => {
      const itemId = idOf.get(`${c.ownerId}\u0000${c.section}\u0000${c.itemText}`);
      return itemId ? [{ itemId, byId: c.byId, text: c.text }] : [];
    }),
    nextDate: old.nextDate ?? null,
    omit: [],
    agenda: [],
    retro: null,
    poker: [],
    parking: [],
    polls: [],
    projects: [],
  };
}

/** The current format of a stored record, whatever its version; null when it cannot be read */
export function parseRecord(raw: unknown): RecordV1 | null {
  if (!raw || typeof raw !== "object") return null;
  const input = (raw as { v?: unknown }).v === undefined ? fromV0(raw as RecordV0) : raw;
  const parsed = recordV1.safeParse(input);
  return parsed.success ? parsed.data : null;
}

// ---------- Reading a record ----------

/** Sections of a record as check-in screens show them, labels in a language */
export const recordSections = (r: RecordV1, locale: Parameters<typeof resolveSections>[1]): Section[] =>
  resolveSections({ sections: r.sections }, locale);

/** Items of a person, per section key: their own ones, or those of one project */
export function itemsBySection(r: RecordV1, personId: string, projectId: string | null = null): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const item of r.checkIns[personId]?.items ?? []) if (item.projectId === projectId) (out[item.section] ??= []).push(item.text);
  return out;
}

/** A person's check-in in the fields check-in screens use (done, next, blockers, other, extra), project tabs included */
export function recordCheckIn(r: RecordV1, personId: string): RecordCheckIn | null {
  const c = r.checkIns[personId];
  if (!c) return null;
  const projects = [...new Set(c.items.map((i) => i.projectId).filter((p): p is string => !!p))];
  return {
    ...checkInFromItems(itemsBySection(r, personId), r.sections),
    ...(projects.length
      ? { byProject: Object.fromEntries(projects.map((p) => [p, checkInFromItems(itemsBySection(r, personId, p), r.sections)])) }
      : {}),
  };
}

/** Items about a project, per person who wrote them (people in the order of the record) */
export function projectItems(r: RecordV1, projectId: string): { personId: string; items: RecordItem[] }[] {
  return Object.entries(r.checkIns)
    .map(([personId, c]) => ({ personId, items: c.items.filter((i) => i.projectId === projectId) }))
    .filter((x) => x.items.length);
}

/** Items of a person in the sections having a role */
export function itemsWithRole(r: RecordV1, personId: string, role: SectionDef["role"]): RecordItem[] {
  const keys = new Set(r.sections.filter((s) => s.role === role).map((s) => s.key));
  return (r.checkIns[personId]?.items ?? []).filter((i) => keys.has(i.section));
}

/** Whether two items say the same thing: same text, or mostly the same words */
export function sameItem(a: string, b: string): boolean {
  const x = plainItem(a).trim().toLowerCase();
  const y = plainItem(b).trim().toLowerCase();
  return x === y || similarity(x, y) >= 0.5;
}
