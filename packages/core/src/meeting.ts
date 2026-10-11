import { type Locale, translator } from "@ronde/i18n";
import { type AgendaBlock, type BlockData, type BlockType, DEFAULT_AGENDA, retroSteps } from "./agenda";
import type { InteractionDTO, MeetingDTO, MemberDTO } from "./types";

export type StepType = "intro" | "speaker" | "project" | "qa" | "misc" | "block" | "end";

export interface Step {
  type: StepType;
  key: string;
  label: string;
  /** Member who speaks ("speaker" step) */
  id?: string;
  /** Project presented ("project" step) and its members present, who speak together */
  projectId?: string;
  speakers?: string[];
  /** Step the questions belong to ("qa" step) */
  of?: string;
  pending?: number;
  total?: number;
  /** Module block ("block" step): its type, its id in the agenda and the step inside it ("vote", "discuss:<id>") */
  block?: BlockType;
  blockId?: string;
  sub?: string;
  /** Time planned for the step; speaking time otherwise */
  limitMs?: number;
}

export const qaKey = (k: string) => "qa:" + k;
/** Key of the step of a project in the project round */
export const projectKey = (projectId: string) => "p:" + projectId;
/** The project of a step key ("p:<id>" or its questions), or null */
export const projectOfKey = (k: string): string | null => {
  const base = k.startsWith("qa:") ? k.slice(3) : k;
  return base.startsWith("p:") ? base.slice(2) : null;
};

const HEALTH_RANK = { offTrack: 0, atRisk: 1, onTrack: 2 } as const;

/**
 * Steps of the project round: one per project followed that has something to say (its sheet or some items are
 * written; a project nobody wrote about is left out, even with its people present, unless the host adds it),
 * in the order chosen by the host this session, or the block's (the meeting's, by theme, or the
 * projects in trouble first). Its members present speak together; their time adds up.
 */
export function projectSteps(
  block: Extract<AgendaBlock, { type: "projects" }>,
  data: NonNullable<BlockData["projects"]>,
  present: string[],
  chosen: string[] = [],
  /** Step running: a project being presented keeps its step even if what was written about it is removed */
  current?: string,
  /** Projects the host presents this session although nothing is written about them */
  added: string[] = [],
): Step[] {
  const at = new Map(present.map((id, i) => [id, i]));
  const list = [...data.list].sort((a, b) => {
    if (block.order === "theme") {
      const d = (a.themePosition ?? Number.MAX_SAFE_INTEGER) - (b.themePosition ?? Number.MAX_SAFE_INTEGER);
      if (d) return d;
    }
    if (block.order === "health") {
      const d = (a.health ? HEALTH_RANK[a.health] : 3) - (b.health ? HEALTH_RANK[b.health] : 3);
      if (d) return d;
    }
    return a.position - b.position;
  });
  // The host's order of the day comes first; projects it does not name keep the block's order. A project
  // added on the fly (nothing written) goes last: the round may already be past its usual place.
  const rank = new Map(chosen.map((id, i) => [id, i]));
  const late = (p: (typeof list)[number]) => (!p.filled && added.includes(p.id) && !rank.has(p.id) ? 1 : 0);
  list.sort((a, b) => late(a) - late(b));
  if (rank.size) list.sort((a, b) => (rank.get(a.id) ?? rank.size) - (rank.get(b.id) ?? rank.size));
  const out: Step[] = [];
  for (const p of list) {
    const speakers = [...new Set([...p.memberIds, ...p.authorIds])].filter((id) => at.has(id)).sort((a, b) => at.get(a)! - at.get(b)!);
    if (!p.filled && !added.includes(p.id) && (!current || baseKeyOf(current) !== projectKey(p.id))) continue;
    const sec = block.perProjectSec ?? data.speakSec * Math.max(1, speakers.length);
    out.push({ type: "project", key: projectKey(p.id), projectId: p.id, speakers, label: p.name, limitMs: sec * 1000 });
  }
  return out;
}

/** "Base" step a raised hand or a reaction belongs to */
export function baseKeyOf(k: string): string {
  if (k.startsWith("qa:")) return k.slice(3);
  if (k === "end") return "misc";
  return k;
}

/**
 * Meeting agenda: its blocks expanded into steps (intro, one step per present person, one per project, open
 * topics, module blocks), then the wrap-up. A "Questions" step follows any step that received a raised hand or a question.
 */
export function buildAgenda(
  meeting: MeetingDTO | null,
  members: Record<string, MemberDTO>,
  interactions: InteractionDTO[],
  locale: Locale,
  blocks: AgendaBlock[] = DEFAULT_AGENDA,
  data: BlockData = {},
): Step[] {
  if (!meeting) return [];
  const t = translator(locale, "agenda");
  const absent = new Set(meeting.absent);
  const order = meeting.order.filter((id) => members[id] && !absent.has(id));
  const base: Step[] = [];
  for (const b of blocks) {
    if (b.type === "intro") base.push({ type: "intro", key: "intro", label: t("intro") });
    else if (b.type === "round") base.push(...order.map<Step>((id) => ({ type: "speaker", key: id, id, label: members[id]!.name })));
    else if (b.type === "projects" && data.projects)
      base.push(...projectSteps(b, data.projects, order, meeting.projectOrder, meeting.stepKey, meeting.projectsAdded));
    else if (b.type === "topics") base.push({ type: "misc", key: "misc", label: t("topics") });
    else if (b.type === "timebox")
      base.push({ type: "block", block: "timebox", blockId: b.id, key: b.id, label: b.title, limitMs: b.minutes * 60_000 });
    else if (b.type === "poker") base.push({ type: "block", block: "poker", blockId: b.id, key: b.id, label: t("poker") });
    else if (b.type === "retro" && data.retro)
      base.push(
        ...retroSteps(b.id, data.retro, {
          reflect: t("retro.reflect"),
          group: t("retro.group"),
          vote: t("retro.vote"),
          discuss: (title) => t("retro.discuss", { title }),
          done: t("retro.done"),
        }).map<Step>((x) => ({ type: "block", block: "retro", blockId: b.id, ...x })),
      );
  }
  const out: Step[] = [];
  for (const b of base) {
    out.push(b);
    const it = interactions.filter((i) => i.stepKey === b.key);
    if (it.length)
      out.push({
        type: "qa",
        key: qaKey(b.key),
        of: b.key,
        label: t("questions"),
        pending: it.filter((i) => !i.resolved).length,
        total: it.length,
      });
  }
  out.push({ type: "end", key: "end", label: t("end") });
  return out;
}

/** Position of the current step in the agenda (falls back to the base step if its questions are gone) */
export function currentIndex(agenda: Step[], stepKey: string | undefined): number {
  let i = agenda.findIndex((s) => s.key === stepKey);
  if (i < 0 && stepKey?.startsWith("qa:")) i = agenda.findIndex((s) => s.key === stepKey.slice(3));
  return Math.max(0, i);
}

export function elapsedOf(m: MeetingDTO | null, now: number): number {
  if (!m) return 0;
  const t = m.timer;
  return (t.baseMs || 0) + (t.running && t.startedAt != null ? now - t.startedAt : 0);
}

export function spentOf(m: MeetingDTO | null, key: string, now: number): number {
  if (!m) return 0;
  return key === m.stepKey ? elapsedOf(m, now) : m.spent[key] || 0;
}

/** Time allowed for a step: what its block plans, otherwise the speaking time; plus the extra time given */
export function limitOf(m: MeetingDTO | null, key: string, speakSec: number, step?: Pick<Step, "limitMs">): number {
  return (step?.limitMs ?? speakSec * 1000) + (m?.bonus[key] || 0);
}

/** New timer state when moving to another step */
export function transition(
  m: MeetingDTO,
  step: Step,
  now: number,
  autoStart: boolean,
): Pick<MeetingDTO, "stepKey" | "spent" | "timer" | "startedAt" | "endedAt"> {
  const spent = { ...m.spent };
  if (m.stepKey && m.stepKey !== "end") spent[m.stepKey] = elapsedOf(m, now);
  const auto = step.type !== "end" && ((step.type !== "speaker" && step.type !== "project") || autoStart);
  return {
    stepKey: step.key,
    spent,
    timer: { running: auto, startedAt: auto ? now : null, baseMs: spent[step.key] || 0 },
    startedAt: m.startedAt ?? now,
    endedAt: step.type === "end" ? now : null,
  };
}
