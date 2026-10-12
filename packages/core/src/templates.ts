// Meeting templates: everything that shapes a meeting (sections, format, modules, schedule pattern) without
// its people, its history or any secret. Built-in templates ship with Ronde; a workspace saves its own.

import { type Locale, translator } from "@ronde/i18n";
import { z } from "zod";
import { type AgendaBlock, agendaSchema } from "./agenda";
import type { SectionDef } from "./types";

const sectionDef = z.object({
  key: z.string().regex(/^[a-z0-9]{1,30}$/),
  label: z.string().max(60),
  role: z.enum(["achievement", "plan", "blocker", "note", "custom"]),
  input: z.enum(["list", "checklist", "text"]),
  carryPlans: z.boolean().optional(),
});

/** Recurrence pattern of a template: a schedule rule without its dates */
const rulePattern = z.object({
  freq: z.enum(["daily", "weekly", "monthly"]),
  interval: z.number().int().min(1).max(99),
  byDay: z.array(z.number().int().min(1).max(7)).max(7),
  setPos: z.number().int().min(-1).max(4).nullable(),
  /** 1 to 31, or -1 for the last day of the month */
  monthDay: z
    .number()
    .int()
    .min(-1)
    .max(31)
    .refine((d) => d !== 0)
    .nullable(),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  durationMin: z.number().int().min(5).max(480),
});
export type RulePattern = z.infer<typeof rulePattern>;

export const templateData = z.object({
  v: z.literal(1),
  settings: z.object({
    targetMin: z.number().int().min(5).max(480),
    speakSec: z.number().int().min(15).max(1800),
    autoStart: z.boolean(),
    hostLabel: z.string().max(50),
    announcements: z.array(z.string().max(500)).max(50),
    reminderEnabled: z.boolean(),
    reminderWhen: z.enum(["dayBefore", "sameDay"]),
    reminderTime: z.string().regex(/^\d{2}:\d{2}$/),
  }),
  sections: z.array(sectionDef).min(1).max(12),
  /** Modules turned on or off, with their settings (never their secrets) */
  modules: z.record(z.string(), z.object({ enabled: z.boolean(), config: z.unknown().optional() })),
  schedule: z.array(rulePattern).min(1).max(8),
  /** Blocks of the agenda; the default one when absent */
  agenda: agendaSchema.optional(),
});
export type TemplateData = z.infer<typeof templateData>;

export const BUILTIN_TEMPLATES = [
  "weekly",
  "standup",
  "retro",
  "oneOnOne",
  "onboarding",
  "sprintReview",
  "steering",
  "portfolio",
  "okrReview",
  "teamProjects",
  "allHands",
  "leadership",
  "salesPipeline",
  "hiringReview",
  "editorial",
  "incidentReview",
  "supportReview",
  "classCouncil",
  "teachingTeam",
  "researchLab",
  "studentProjects",
  "board",
  "boardOfDirectors",
  "volunteers",
  "siteMeeting",
  "serviceBriefing",
  "shiftHandover",
  "caseReview",
] as const;
export type BuiltinTemplateId = (typeof BUILTIN_TEMPLATES)[number];
export const isBuiltinTemplate = (v: unknown): v is BuiltinTemplateId =>
  typeof v === "string" && (BUILTIN_TEMPLATES as readonly string[]).includes(v);

export const TEMPLATE_ICONS: Record<BuiltinTemplateId, string> = {
  weekly: "🔁",
  standup: "☀️",
  retro: "🔍",
  oneOnOne: "🤝",
  sprintReview: "🚀",
  steering: "🧭",
  portfolio: "🗂️",
  teamProjects: "🧩",
  allHands: "📣",
  leadership: "🏛️",
  salesPipeline: "📈",
  editorial: "📰",
  classCouncil: "🎓",
  teachingTeam: "📚",
  board: "🧑‍🤝‍🧑",
  volunteers: "🙌",
  siteMeeting: "🦺",
  shiftHandover: "🩺",
  okrReview: "🎯",
  incidentReview: "🧯",
  researchLab: "🔬",
  studentProjects: "🎒",
  caseReview: "🏥",
  serviceBriefing: "🍽️",
  onboarding: "👋",
  hiringReview: "🧑‍💼",
  boardOfDirectors: "🗳️",
  supportReview: "🛟",
};

/** Who each built-in template is for, to browse the gallery */
export const TEMPLATE_CATEGORIES = ["team", "product", "leadership", "education", "nonprofit", "field", "health"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];
export const TEMPLATE_CATEGORY: Record<BuiltinTemplateId, TemplateCategory> = {
  weekly: "team",
  standup: "team",
  retro: "team",
  oneOnOne: "team",
  allHands: "team",
  sprintReview: "product",
  teamProjects: "product",
  portfolio: "leadership",
  editorial: "product",
  salesPipeline: "leadership",
  steering: "leadership",
  leadership: "leadership",
  classCouncil: "education",
  teachingTeam: "education",
  board: "nonprofit",
  volunteers: "nonprofit",
  siteMeeting: "field",
  shiftHandover: "health",
  okrReview: "leadership",
  incidentReview: "product",
  researchLab: "education",
  studentProjects: "education",
  caseReview: "health",
  serviceBriefing: "field",
  onboarding: "team",
  hiringReview: "leadership",
  boardOfDirectors: "nonprofit",
  supportReview: "product",
};

interface Spec {
  settings: Partial<TemplateData["settings"]>;
  /** Sections; `named` takes its label from the template messages, otherwise the role default */
  sections: (Omit<SectionDef, "label"> & { named?: boolean })[];
  modules: Record<string, boolean>;
  schedule: RulePattern[];
  agenda?: AgendaBlock[];
}

const weekly = (day: number, time: string, durationMin: number, interval = 1): RulePattern => ({
  freq: "weekly",
  interval,
  byDay: [day],
  setPos: null,
  monthDay: null,
  time,
  durationMin,
});

// The usefulness vote stays off where it does not belong: short daily meetings (asked every day, it wears
// people out), meetings of two (the average would give the other's rating away) and formal bodies whose minutes
// are an official record (steering, boards, class council, site meeting, case review, incident review).
const SPECS: Record<BuiltinTemplateId, Spec> = {
  // The weekly sync: done, next, blockers and other, with every facilitation module
  weekly: {
    settings: {},
    sections: [
      { key: "done", role: "achievement", input: "list" },
      { key: "next", role: "plan", input: "list" },
      { key: "blockers", role: "blocker", input: "list" },
      { key: "other", role: "note", input: "list" },
    ],
    modules: {},
    schedule: [weekly(1, "10:00", 30)],
  },
  standup: {
    settings: { targetMin: 15, speakSec: 90 },
    sections: [
      { key: "yesterday", role: "achievement", input: "list", named: true },
      { key: "today", role: "plan", input: "list", named: true },
      { key: "blockers", role: "blocker", input: "list" },
    ],
    modules: { icebreaker: false, mood: false, kudos: false, birthdays: false, ambience: false, rating: false },
    schedule: [{ freq: "daily", interval: 1, byDay: [1, 2, 3, 4, 5], setPos: null, monthDay: null, time: "09:30", durationMin: 15 }],
  },
  retro: {
    settings: { targetMin: 60, speakSec: 180 },
    sections: [
      { key: "well", role: "achievement", input: "list", named: true },
      { key: "improve", role: "blocker", input: "list", named: true },
      { key: "ideas", role: "plan", input: "list", named: true },
    ],
    modules: { mood: true, kudos: true, retro: true },
    schedule: [{ freq: "monthly", interval: 1, byDay: [5], setPos: -1, monthDay: null, time: "14:00", durationMin: 60 }],
    // The round table gives way to the retro board
    agenda: [
      { id: "intro", type: "intro" },
      { id: "retro", type: "retro" },
      { id: "topics", type: "topics" },
    ],
  },
  oneOnOne: {
    settings: { targetMin: 30, speakSec: 600, autoStart: false },
    sections: [
      { key: "wins", role: "achievement", input: "list", named: true },
      { key: "priorities", role: "plan", input: "checklist", named: true },
      { key: "challenges", role: "blocker", input: "list", named: true },
      { key: "feedback", role: "custom", input: "text", named: true },
    ],
    modules: { icebreaker: false, kudos: false, reactions: false, hands: false, birthdays: false, ambience: false, rating: false },
    schedule: [weekly(4, "11:00", 30)],
  },
  sprintReview: {
    settings: { targetMin: 45, speakSec: 300 },
    sections: [
      // What the last review planned for this sprint comes back here, ticked as it is delivered
      { key: "delivered", role: "achievement", input: "checklist", named: true, carryPlans: true },
      { key: "demo", role: "custom", input: "list", named: true },
      { key: "next", role: "plan", input: "list", named: true },
      { key: "risks", role: "blocker", input: "list", named: true },
    ],
    modules: { kudos: true },
    schedule: [weekly(5, "15:00", 45, 2)],
  },
  steering: {
    settings: { targetMin: 60, speakSec: 300, autoStart: false },
    sections: [
      { key: "progress", role: "achievement", input: "list", named: true },
      { key: "decisions", role: "custom", input: "list", named: true },
      { key: "risks", role: "blocker", input: "list", named: true },
      { key: "next", role: "plan", input: "list", named: true },
    ],
    modules: {
      icebreaker: false,
      mood: false,
      kudos: false,
      reactions: false,
      birthdays: false,
      ambience: false,
      sounds: false,
      rating: false,
    },
    schedule: [{ freq: "monthly", interval: 1, byDay: [2], setPos: 1, monthDay: null, time: "10:00", durationMin: 60 }],
  },
  // Projects first: one step per project of the portfolio, where its people speak together, the ones in trouble first
  portfolio: {
    settings: { targetMin: 60, speakSec: 120, autoStart: false },
    sections: [
      { key: "progress", role: "achievement", input: "list", named: true },
      { key: "milestones", role: "plan", input: "list", named: true },
      { key: "risks", role: "blocker", input: "list", named: true },
      { key: "decisions", role: "custom", input: "list", named: true },
    ],
    modules: { icebreaker: false, mood: false, birthdays: false, ambience: false, sounds: false },
    schedule: [weekly(2, "14:00", 60, 2)],
    agenda: [
      { id: "intro", type: "intro" },
      { id: "projects", type: "projects", order: "health" },
      { id: "topics", type: "topics" },
    ],
  },
  // A short turn each, then the projects the team shares
  teamProjects: {
    settings: { targetMin: 45, speakSec: 60 },
    sections: [
      { key: "done", role: "achievement", input: "list" },
      { key: "next", role: "plan", input: "list" },
      { key: "blockers", role: "blocker", input: "list" },
    ],
    modules: {},
    schedule: [weekly(1, "10:00", 45)],
    agenda: [
      { id: "intro", type: "intro" },
      { id: "round", type: "round" },
      { id: "projects", type: "projects", order: "manual" },
      { id: "topics", type: "topics" },
    ],
  },
  allHands: {
    settings: { targetMin: 60, speakSec: 300 },
    sections: [
      { key: "highlights", role: "achievement", input: "list", named: true },
      { key: "news", role: "note", input: "list", named: true },
      { key: "asks", role: "blocker", input: "list", named: true },
    ],
    modules: { kudos: true, reactions: true, hands: true },
    // The first Thursday of the month: a fixed day of the month could fall on a weekend
    schedule: [{ freq: "monthly", interval: 1, byDay: [4], setPos: 1, monthDay: null, time: "16:00", durationMin: 60 }],
  },
  // The leadership team's weekly: figures first, then what needs the leaders
  leadership: {
    settings: { targetMin: 60, speakSec: 300, autoStart: false },
    sections: [
      { key: "figures", role: "note", input: "list", named: true },
      { key: "wins", role: "achievement", input: "list", named: true },
      { key: "priorities", role: "plan", input: "list", named: true },
      { key: "escalations", role: "blocker", input: "list", named: true },
    ],
    modules: { icebreaker: false, ambience: false, sounds: false, birthdays: false },
    schedule: [weekly(1, "09:00", 60)],
  },
  salesPipeline: {
    settings: { targetMin: 45, speakSec: 180 },
    sections: [
      // Deals won are not next steps carried out: no achievement role, so a done step is not filed as a deal
      { key: "won", role: "custom", input: "list", named: true },
      { key: "pipeline", role: "note", input: "list", named: true },
      { key: "next", role: "plan", input: "list", named: true },
      { key: "atrisk", role: "blocker", input: "list", named: true },
    ],
    modules: { kudos: true, ambience: false },
    schedule: [weekly(1, "11:00", 45)],
  },
  editorial: {
    settings: { targetMin: 40, speakSec: 150 },
    sections: [
      { key: "published", role: "achievement", input: "list", named: true },
      { key: "inprogress", role: "plan", input: "checklist", named: true },
      { key: "ideas", role: "custom", input: "list", named: true },
      { key: "help", role: "blocker", input: "list", named: true },
    ],
    modules: { polls: true },
    schedule: [weekly(2, "10:00", 40)],
  },
  // School: the class council, once a term, and the weekly meeting of a teaching team
  classCouncil: {
    settings: { targetMin: 90, speakSec: 240, autoStart: false },
    sections: [
      { key: "progress", role: "achievement", input: "list", named: true },
      { key: "support", role: "blocker", input: "list", named: true },
      { key: "agreed", role: "plan", input: "checklist", named: true },
      { key: "notes", role: "note", input: "text", named: true },
    ],
    modules: {
      icebreaker: false,
      mood: false,
      kudos: false,
      reactions: false,
      birthdays: false,
      ambience: false,
      sounds: false,
      rating: false,
    },
    schedule: [{ freq: "monthly", interval: 3, byDay: [2], setPos: 1, monthDay: null, time: "17:00", durationMin: 90 }],
  },
  teachingTeam: {
    settings: { targetMin: 45, speakSec: 180 },
    sections: [
      { key: "lastweek", role: "achievement", input: "list", named: true },
      { key: "coming", role: "plan", input: "list", named: true },
      { key: "students", role: "blocker", input: "list", named: true },
      { key: "resources", role: "custom", input: "list", named: true },
    ],
    modules: { ambience: false },
    schedule: [weekly(4, "12:30", 45)],
  },
  // Non-profits: the board, and the volunteers who run the activities
  board: {
    settings: { targetMin: 90, speakSec: 300, autoStart: false },
    sections: [
      { key: "news", role: "achievement", input: "list", named: true },
      { key: "votes", role: "custom", input: "list", named: true },
      { key: "treasury", role: "note", input: "text", named: true },
      { key: "events", role: "plan", input: "list", named: true },
    ],
    modules: { icebreaker: false, ambience: false, polls: true, rating: false },
    schedule: [{ freq: "monthly", interval: 1, byDay: [3], setPos: 1, monthDay: null, time: "19:00", durationMin: 90 }],
  },
  volunteers: {
    settings: { targetMin: 30, speakSec: 120 },
    sections: [
      { key: "done", role: "achievement", input: "list", named: true },
      { key: "missions", role: "plan", input: "checklist", named: true },
      { key: "needs", role: "blocker", input: "list", named: true },
    ],
    modules: { kudos: true, birthdays: true },
    schedule: [weekly(6, "10:00", 30)],
  },
  // Field work: the site meeting of a construction project
  siteMeeting: {
    settings: { targetMin: 45, speakSec: 240, autoStart: false },
    sections: [
      { key: "done", role: "achievement", input: "list", named: true },
      { key: "planned", role: "plan", input: "checklist", named: true },
      { key: "safety", role: "blocker", input: "list", named: true },
      { key: "punch", role: "custom", input: "checklist", named: true },
    ],
    modules: {
      icebreaker: false,
      mood: false,
      kudos: false,
      reactions: false,
      birthdays: false,
      ambience: false,
      sounds: false,
      rating: false,
    },
    schedule: [weekly(2, "08:00", 45)],
  },
  // Care teams: the handover between two shifts, every day
  shiftHandover: {
    settings: { targetMin: 15, speakSec: 120 },
    sections: [
      { key: "events", role: "achievement", input: "list", named: true },
      { key: "watch", role: "blocker", input: "list", named: true },
      { key: "todo", role: "plan", input: "checklist", named: true },
    ],
    modules: {
      icebreaker: false,
      mood: false,
      kudos: false,
      reactions: false,
      birthdays: false,
      ambience: false,
      sounds: false,
      rating: false,
    },
    // Every morning at the change of shift (a meeting holds one session a day: a second shift's handover is a
    // meeting of its own, made from the same template)
    schedule: [{ freq: "daily", interval: 1, byDay: [1, 2, 3, 4, 5, 6, 7], setPos: null, monthDay: null, time: "07:00", durationMin: 15 }],
  },
  // Objectives once a month: how each key result moves, and what needs a decision
  okrReview: {
    settings: { targetMin: 60, speakSec: 240, autoStart: false },
    sections: [
      { key: "progress", role: "achievement", input: "list", named: true },
      { key: "results", role: "note", input: "list", named: true },
      { key: "risks", role: "blocker", input: "list", named: true },
      { key: "asks", role: "custom", input: "list", named: true },
    ],
    modules: { icebreaker: false, ambience: false, sounds: false, birthdays: false },
    schedule: [{ freq: "monthly", interval: 1, byDay: [1], setPos: 1, monthDay: null, time: "10:00", durationMin: 60 }],
  },
  // The week's incidents, reviewed without blame: what happened, the impact, the causes, what changes
  incidentReview: {
    settings: { targetMin: 45, speakSec: 300, autoStart: false },
    sections: [
      { key: "timeline", role: "custom", input: "list", named: true },
      { key: "impact", role: "note", input: "list", named: true },
      { key: "causes", role: "blocker", input: "list", named: true },
      { key: "actions", role: "plan", input: "checklist", named: true },
    ],
    modules: {
      icebreaker: false,
      mood: false,
      kudos: false,
      reactions: false,
      birthdays: false,
      ambience: false,
      sounds: false,
      rating: false,
    },
    schedule: [weekly(5, "14:00", 45)],
  },
  // Research: the weekly meeting of a lab or a doctoral group
  researchLab: {
    settings: { targetMin: 60, speakSec: 300 },
    sections: [
      { key: "results", role: "achievement", input: "list", named: true },
      { key: "next", role: "plan", input: "list", named: true },
      { key: "stuck", role: "blocker", input: "list", named: true },
      { key: "reading", role: "custom", input: "list", named: true },
    ],
    modules: { ambience: false },
    schedule: [weekly(2, "14:00", 60)],
  },
  // Student projects followed every other week by their tutor
  studentProjects: {
    settings: { targetMin: 60, speakSec: 300, autoStart: false },
    sections: [
      { key: "progress", role: "achievement", input: "list", named: true },
      { key: "deliverables", role: "plan", input: "checklist", named: true },
      { key: "difficulties", role: "blocker", input: "list", named: true },
      { key: "questions", role: "custom", input: "list", named: true },
    ],
    modules: { ambience: false, birthdays: false },
    schedule: [weekly(3, "14:00", 60, 2)],
  },
  // Care: the multidisciplinary case review, cases presented and the care plan agreed
  caseReview: {
    settings: { targetMin: 60, speakSec: 300, autoStart: false },
    sections: [
      { key: "cases", role: "note", input: "list", named: true },
      { key: "opinions", role: "custom", input: "list", named: true },
      { key: "plan", role: "plan", input: "checklist", named: true },
      { key: "tests", role: "blocker", input: "list", named: true },
    ],
    modules: {
      icebreaker: false,
      mood: false,
      kudos: false,
      reactions: false,
      birthdays: false,
      ambience: false,
      sounds: false,
      rating: false,
    },
    schedule: [weekly(4, "13:00", 60)],
  },
  // Restaurants, hotels, shops: ten minutes before opening, every day
  serviceBriefing: {
    settings: { targetMin: 10, speakSec: 60 },
    sections: [
      { key: "bookings", role: "note", input: "list", named: true },
      { key: "specials", role: "custom", input: "list", named: true },
      { key: "instructions", role: "plan", input: "list", named: true },
      { key: "watch", role: "blocker", input: "list", named: true },
    ],
    modules: { icebreaker: false, mood: false, ambience: false, sounds: false, kudos: true, birthdays: true, rating: false },
    schedule: [{ freq: "daily", interval: 1, byDay: [1, 2, 3, 4, 5, 6, 7], setPos: null, monthDay: null, time: "11:00", durationMin: 10 }],
  },
  // A newcomer's first months: a weekly half hour with their manager or buddy
  onboarding: {
    settings: { targetMin: 30, speakSec: 600, autoStart: false },
    sections: [
      { key: "learned", role: "achievement", input: "list", named: true },
      { key: "goals", role: "plan", input: "checklist", named: true },
      { key: "needs", role: "blocker", input: "list", named: true },
      { key: "questions", role: "custom", input: "list", named: true },
    ],
    modules: { icebreaker: false, kudos: false, reactions: false, hands: false, birthdays: false, ambience: false, rating: false },
    schedule: [weekly(1, "16:00", 30)],
  },
  // Hiring: the week's candidates, interviews and decisions
  hiringReview: {
    settings: { targetMin: 45, speakSec: 180, autoStart: false },
    sections: [
      { key: "interviews", role: "achievement", input: "list", named: true },
      { key: "candidates", role: "note", input: "list", named: true },
      { key: "decisions", role: "custom", input: "list", named: true },
      { key: "openings", role: "custom", input: "list", named: true },
    ],
    modules: { icebreaker: false, mood: false, kudos: false, birthdays: false, ambience: false, sounds: false },
    schedule: [weekly(3, "11:00", 45)],
  },
  // The board of directors of a non-profit, a foundation or a company, once a term
  boardOfDirectors: {
    settings: { targetMin: 120, speakSec: 600, autoStart: false },
    sections: [
      { key: "report", role: "achievement", input: "list", named: true },
      { key: "finances", role: "note", input: "text", named: true },
      { key: "resolutions", role: "custom", input: "checklist", named: true },
      { key: "risks", role: "blocker", input: "list", named: true },
    ],
    modules: {
      ...{ icebreaker: false, mood: false, kudos: false, reactions: false, birthdays: false, ambience: false, sounds: false },
      polls: true,
      rating: false,
    },
    schedule: [{ freq: "monthly", interval: 3, byDay: [4], setPos: 2, monthDay: null, time: "18:00", durationMin: 120 }],
  },
  // Support and customer success: the week seen from the customers' side
  supportReview: {
    settings: { targetMin: 45, speakSec: 180 },
    sections: [
      { key: "highlights", role: "achievement", input: "list", named: true },
      { key: "escalations", role: "blocker", input: "list", named: true },
      { key: "feedback", role: "custom", input: "list", named: true },
      { key: "satisfaction", role: "note", input: "list", named: true },
    ],
    modules: { kudos: true, ambience: false },
    schedule: [weekly(2, "10:00", 45)],
  },
};

export const DEFAULT_TEMPLATE_SETTINGS: TemplateData["settings"] = {
  targetMin: 25,
  speakSec: 120,
  autoStart: true,
  hostLabel: "",
  announcements: [],
  reminderEnabled: false,
  reminderWhen: "dayBefore",
  reminderTime: "15:00",
};

/** A built-in template, its section labels in a language */
export function builtinTemplate(id: BuiltinTemplateId, locale: Locale): TemplateData {
  const t = translator(locale, "templates");
  const spec = SPECS[id];
  return {
    v: 1,
    settings: { ...DEFAULT_TEMPLATE_SETTINGS, ...spec.settings },
    sections: spec.sections.map(({ named, ...s }) => ({
      ...s,
      label: named ? t(`${id}.sections.${s.key}` as "weekly.name") : "",
    })),
    modules: Object.fromEntries(Object.entries(spec.modules).map(([mod, enabled]) => [mod, { enabled }])),
    schedule: spec.schedule,
    ...(spec.agenda ? { agenda: spec.agenda } : {}),
  };
}

/** A stored template, or null when it cannot be read */
export function parseTemplate(raw: unknown): TemplateData | null {
  const parsed = templateData.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * A template's rhythm in plain words, without a day, a time or a time zone: a template is a pattern the
 * team makes its own ("Every week · 30 min", "Once a quarter · 1 h 30")
 */
export function describeRhythm(schedule: RulePattern[], locale: Locale): string {
  const t = translator(locale, "templates");
  const minutes = schedule[0]?.durationMin ?? 0;
  const unit = (n: number, u: "hour" | "minute") =>
    new Intl.NumberFormat(locale, { style: "unit", unit: u, unitDisplay: "short" }).format(n);
  // "1 hr 30 min", "45 min"
  const duration = [minutes >= 60 ? unit(Math.floor(minutes / 60), "hour") : "", minutes % 60 ? unit(minutes % 60, "minute") : ""]
    .filter(Boolean)
    .join(" ");
  const withDuration = (rhythm: string) => (minutes ? `${rhythm} · ${duration}` : rhythm);
  // Several times every day (a handover at each change of shift): "Twice a day"
  const everyDay = (r: RulePattern) => r.freq === "daily" && r.interval === 1 && (r.byDay.length === 0 || r.byDay.length === 7);
  if (schedule.length > 1 && schedule.every(everyDay)) return withDuration(t("rhythm.timesDaily", { count: schedule.length }));
  const rhythms = schedule.map((r) => {
    if (r.freq === "daily")
      return r.byDay.length === 5 && [1, 2, 3, 4, 5].every((d) => r.byDay.includes(d))
        ? t("rhythm.weekdays")
        : t("rhythm.daily", { count: r.interval });
    if (r.freq === "weekly") return t("rhythm.weekly", { count: r.interval });
    return t("rhythm.monthly", { count: r.interval });
  });
  return withDuration(new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format([...new Set(rhythms)]));
}
