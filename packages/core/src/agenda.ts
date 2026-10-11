// Agenda of a meeting, as a list of blocks: the core ones (intro, round table, project round, open topics) and
// the ones of modules (retrospective, timebox, planning poker). Each block expands into one or more steps.

import { z } from "zod";

export const BLOCK_TYPES = ["intro", "round", "projects", "topics", "retro", "timebox", "poker"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];
/** Blocks a meeting may hold once at most */
export const SINGLE_BLOCKS: readonly BlockType[] = ["intro", "round", "projects", "topics", "retro"];
/** Module behind a block (core blocks have none) */
export const BLOCK_MODULE: Partial<Record<BlockType, string>> = { retro: "retro", timebox: "timebox", poker: "poker" };

/** Order of the project round: the meeting's, by theme, or the projects in trouble first */
export const PROJECT_ROUND_ORDERS = ["manual", "theme", "health"] as const;
export type ProjectRoundOrder = (typeof PROJECT_ROUND_ORDERS)[number];

export const agendaBlock = z.discriminatedUnion("type", [
  z.object({ id: z.string().regex(/^[a-z0-9]{1,20}$/), type: z.enum(["intro", "round", "topics", "retro", "poker"]) }),
  z.object({
    id: z.string().regex(/^[a-z0-9]{1,20}$/),
    type: z.literal("projects"),
    order: z.enum(PROJECT_ROUND_ORDERS).default("manual"),
    /** Time per project; none: the speaking time of each member present */
    perProjectSec: z.number().int().min(30).max(3600).optional(),
  }),
  z.object({
    id: z.string().regex(/^[a-z0-9]{1,20}$/),
    type: z.literal("timebox"),
    title: z.string().trim().min(1).max(80),
    minutes: z.number().int().min(1).max(120),
  }),
]);
export type AgendaBlock = z.infer<typeof agendaBlock>;

export const agendaSchema = z
  .array(agendaBlock)
  .min(1)
  .max(20)
  .refine((blocks) => new Set(blocks.map((b) => b.id)).size === blocks.length, "Block ids must be unique")
  .refine((blocks) => SINGLE_BLOCKS.every((t) => blocks.filter((b) => b.type === t).length <= 1), "Some blocks may appear once only");

/** The agenda of a meeting that never changed it: intro, round table, open topics */
export const DEFAULT_AGENDA: AgendaBlock[] = [
  { id: "intro", type: "intro" },
  { id: "round", type: "round" },
  { id: "topics", type: "topics" },
];

/** The saved agenda, or the default one when it cannot be read */
export function agendaOf(raw: unknown): AgendaBlock[] {
  const parsed = agendaSchema.safeParse(raw);
  return parsed.success ? parsed.data : DEFAULT_AGENDA;
}

export const RETRO_PHASES = ["reflect", "group", "vote", "discuss", "done"] as const;
export type RetroPhase = (typeof RETRO_PHASES)[number];

/** What the expansion of module blocks depends on, the same on the server and in the browser */
export interface BlockData {
  /** Projects the meeting follows, for its project round */
  projects?: {
    speakSec: number;
    list: {
      id: string;
      name: string;
      health: "onTrack" | "atRisk" | "offTrack" | null;
      /** Position of its theme in the portfolio; null: no theme */
      themePosition: number | null;
      /** Position in the meeting */
      position: number;
      memberIds: string[];
      /** People who wrote items about it, or joined them */
      authorIds: string[];
      /** Its sheet or some items are written */
      filled: boolean;
    }[];
  };
  retro?: {
    reflectMin: number;
    voteMin: number;
    discussMin: number;
    /** Groups with at least one vote are discussed, most voted first */
    groups: { id: string; title: string; votes: number; position: number }[];
  };
}

/** Steps of a retro: reflect, group, vote, one discussion per voted group (most voted first), recap */
export function retroSteps(
  blockId: string,
  data: NonNullable<BlockData["retro"]>,
  labels: Record<"reflect" | "group" | "vote" | "done", string> & { discuss: (title: string) => string },
) {
  const min = (m: number) => m * 60_000;
  const voted = data.groups.filter((g) => g.votes > 0).sort((a, b) => b.votes - a.votes || a.position - b.position);
  return [
    { sub: "reflect", key: `${blockId}:reflect`, label: labels.reflect, limitMs: min(data.reflectMin) },
    { sub: "group", key: `${blockId}:group`, label: labels.group },
    { sub: "vote", key: `${blockId}:vote`, label: labels.vote, limitMs: min(data.voteMin) },
    ...voted.map((g) => ({
      sub: `discuss:${g.id}`,
      key: `${blockId}:discuss:${g.id}`,
      label: labels.discuss(g.title),
      limitMs: min(data.discussMin),
    })),
    { sub: "done", key: `${blockId}:done`, label: labels.done },
  ];
}

/** Phase of a retro step ("discuss:<groupId>" → "discuss") */
export const retroPhaseOf = (sub: string | undefined): RetroPhase | null => {
  const p = sub?.split(":")[0];
  return (RETRO_PHASES as readonly string[]).includes(p ?? "") ? (p as RetroPhase) : null;
};

/** An agenda with both a round table and a project round: which one comes first ("team" or "projects"), or null */
export function roundsOrder(blocks: readonly AgendaBlock[] | undefined): "team" | "projects" | null {
  const round = blocks?.findIndex((b) => b.type === "round") ?? -1;
  const projects = blocks?.findIndex((b) => b.type === "projects") ?? -1;
  if (round < 0 || projects < 0) return null;
  return round < projects ? "team" : "projects";
}

/** The same agenda, the round table and the project round in the order asked */
export function withRoundsOrder(blocks: AgendaBlock[], first: "team" | "projects"): AgendaBlock[] {
  if (roundsOrder(blocks) === first || roundsOrder(blocks) === null) return blocks;
  const round = blocks.findIndex((b) => b.type === "round");
  const projects = blocks.findIndex((b) => b.type === "projects");
  const out = [...blocks];
  [out[round], out[projects]] = [out[projects]!, out[round]!];
  return out;
}

/**
 * Whether the agenda gives people a turn (a round table or a project round): only then are check-ins presented.
 * Without one (a retrospective on its board alone…), nobody is asked to fill one in.
 */
export const hasTurns = (blocks: readonly AgendaBlock[] | undefined) => !!blocks?.some((b) => b.type === "round" || b.type === "projects");
