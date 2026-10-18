// Minutes of a session, built from its record as a tree of parts and blocks, in any language. The tree is
// rendered as Markdown (copy, file, PDF) or directly by the history page: nothing is parsed back from text.

import { formatters, type Locale, locales, translator } from "@ronde/i18n";
import { listItemOf } from "./markdown";
import { type MinutesPart, projectItems, type RecordItem, type RecordV1, recordSections } from "./record";
import type { SectionRole } from "./types";
import { hostName, MOODS, mmssPlain, nextMonday, taskOf } from "./util";

export { isMinutesPart, MINUTES_PARTS, type MinutesPart } from "./record";

/** Kinds of parts, in their order in the minutes */
export type MinutesKind =
  | "summary"
  | "decisions"
  | "intro"
  | "slide"
  | "mood"
  | "icebreaker"
  | "round"
  | "projects"
  | "timebox"
  | "retro"
  | "poker"
  | "polls"
  | "topics"
  | "parking"
  | "actions"
  | "kudos"
  | "rating"
  | "blockers";

export interface MinutesItem {
  text: string;
  /** Checklist item: ticked or not */
  checked?: boolean | null;
  /** Who said it: "Chloe Roy: …" */
  by?: string;
  /** Plain text after the item: " (Alice Martin)", " · 3 votes" */
  meta?: string;
  /** Where it comes from, in italics: "(Alice Martin)" */
  context?: string;
  likes?: number;
  children?: MinutesItem[];
}

/** Tone of a label: the role of a check-in section, or a host block */
export type LabelTone = SectionRole | "notes" | "qa";

export type MinutesBlock =
  /** Written by the host (summary, notes): Markdown */
  | { type: "markdown"; text: string }
  /** Generated line */
  | { type: "text"; text: string }
  | { type: "label"; text: string; tone: LabelTone }
  | { type: "list"; items: MinutesItem[] }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "person"; id: string; name: string; role: string; spentMs: number; blocks: MinutesBlock[] }
  /** A project of the project round: its theme and health as words, its time, then what was said */
  | {
      type: "project";
      id: string;
      name: string;
      theme: string;
      health: "onTrack" | "atRisk" | "offTrack" | null;
      healthLabel: string;
      spentMs: number;
      blocks: MinutesBlock[];
    };

export interface MinutesSection {
  kind: MinutesKind;
  title: string;
  blocks: MinutesBlock[];
}

export interface MinutesDoc {
  title: string;
  /** Date, duration, people */
  meta: string;
  parts: MinutesSection[];
  /** Date of the next session */
  next: string;
}

/** Host notes as a Markdown list: a line of text becomes a bullet, typed lists and sub-lists are kept */
export function noteLines(text: string | undefined): string[] {
  return String(text ?? "")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const li = listItemOf(l);
      return li ? "  ".repeat(li.level) + (li.ordered ? li.marker : "-") + " " + li.text.trim() : "- " + l.trim();
    });
}

/** "Decision:" prefixes in every language, so notes typed in any locale are recognised */
const DECISION_PREFIXES = [...new Set(locales.map((l) => translator(l, "minutes")("decisionPrefix")))];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const DECISION_RE = new RegExp(
  `^\\s*(?:[-*+]|\\d+[.)])?\\s*(?:\\*\\*)?(?:${DECISION_PREFIXES.map(escapeRe).join("|")})\\s*[:：]\\s*(?:\\*\\*)?\\s*(.+)$`,
  "i",
);

/** "Action:" prefixes of the follow-up actions written in the notes, in every language */
const ACTION_PREFIXES = [...new Set(locales.map((l) => translator(l, "control")("notes.actionPrefix")))];
const startOf = (prefixes: string[]) =>
  new RegExp(`^\\s*(?:[-*+]|\\d+[.)])?\\s*(?:\\*\\*)?(?:${prefixes.map(escapeRe).join("|")})\\s*(?:\\*\\*)?\\s*[:：]`, "i");
const DECISION_START = startOf(DECISION_PREFIXES);
const ACTION_START = startOf(ACTION_PREFIXES);

/**
 * What a line of the notes starts as, in any language: a decision ("Decision:") or an action ("Action:"), even
 * before anything is written after it; the editor gives them their look as they are typed
 */
export function noteLineKind(line: string): "decision" | "action" | null {
  return DECISION_START.test(line) ? "decision" : ACTION_START.test(line) ? "action" : null;
}

/** Decisions of a note: "Decision: …" lines (bold or not, bulleted or not; the colon may be the full-width one
 * Chinese keyboards type) */
export function decisionsOf(text: string | undefined): string[] {
  return String(text ?? "")
    .split("\n")
    .map((l) => DECISION_RE.exec(l)?.[1]?.trim())
    .filter((d): d is string => !!d);
}

const notesBlock = (text: string | undefined): MinutesBlock[] =>
  text?.trim() ? [{ type: "markdown", text: noteLines(text).join("\n") }] : [];

const itemOf = (text: string): MinutesItem => {
  const t = taskOf(text);
  return t.done === null ? { text } : { text: t.text, checked: t.done };
};

/** Decisions noted during a session ("Decision: …" lines of the notes), with where they were taken, in agenda order */
export function recordDecisions(r: RecordV1, locale: Locale): MinutesItem[] {
  const t = translator(locale, "minutes");
  const blockName = (b: RecordV1["agenda"][number]) =>
    b.type === "timebox" || b.type === "slide"
      ? b.title || t(b.type)
      : b.type === "poker"
        ? t("poker")
        : b.type === "retro"
          ? t("retro")
          : "";
  const places: [string, string][] = [
    ["intro", t("introduction")],
    ["qa:intro", t("questionsAbout", { what: t("introduction") })],
    ...r.participants.flatMap((p): [string, string][] => [
      [p.id, p.name],
      ["qa:" + p.id, t("questionsAbout", { what: p.name })],
    ]),
    ...r.projects
      .filter((p) => p.presented)
      .flatMap((p): [string, string][] => [
        [`p:${p.id}`, p.name],
        [`qa:p:${p.id}`, t("questionsAbout", { what: p.name })],
      ]),
    ...(r.retro?.groups ?? []).map((g): [string, string] => [`${r.retro!.blockId}:discuss:${g.id}`, g.title]),
    // Blocks of the agenda (timeboxes, planning poker, the other steps of a retro…)
    ...r.agenda
      .filter((b) => blockName(b))
      .flatMap((b): [string, string][] => [
        [b.id, blockName(b)],
        [`qa:${b.id}`, t("questionsAbout", { what: blockName(b) })],
        ...Object.keys(r.notes)
          .filter((k) => k.startsWith(`${b.id}:`) && !k.includes(":discuss:"))
          .map((k): [string, string] => [k, blockName(b)]),
      ]),
    ["misc", t("topics")],
    ["qa:misc", t("questionsAbout", { what: t("topics") })],
  ];
  return places.flatMap(([k, where]) => decisionsOf(r.notes[k]).map((text) => ({ text, context: `(${where})` })));
}

export interface MinutesOptions {
  /** Summary written by the host, shown first */
  summary?: string | null;
  /** Team inputs left out; the record's own choice by default */
  omit?: Iterable<MinutesPart>;
}

/** The minutes of a record, in a language */
export function buildMinutes(r: RecordV1, locale: Locale, options: MinutesOptions = {}): MinutesDoc {
  const t = translator(locale, "minutes");
  const f = formatters(locale);
  const off = new Set(options.omit ?? r.omit);
  const on = (k: MinutesPart) => !off.has(k);
  const host = hostName(r, locale);
  const nm = (id: string | null) => (id && (r.names[id] || r.participants.find((p) => p.id === id)?.name)) || host;
  const sections = recordSections(r, locale);
  const parts: MinutesSection[] = [];
  const part = (kind: MinutesKind, title: string, blocks: MinutesBlock[]) => {
    if (blocks.length) parts.push({ kind, title, blocks });
  };

  if (options.summary?.trim()) part("summary", t("summaryTitle"), [{ type: "markdown", text: options.summary.trim() }]);

  // Decisions noted during the meeting, grouped at the top so the essentials read at a glance (they also stay in place)
  const decisions = recordDecisions(r, locale);
  part("decisions", t("decisions"), decisions.length ? [{ type: "list", items: decisions }] : []);

  part("intro", t("introduction"), [
    ...notesBlock(r.notes.intro),
    ...(r.notes["qa:intro"]?.trim()
      ? [{ type: "label", text: t("exchanges"), tone: "qa" } as const, ...notesBlock(r.notes["qa:intro"])]
      : []),
  ]);

  // Slides: their text, what the team raised on them, the actions decided there, the host notes and the exchanges
  const slidePart = (b: RecordV1["agenda"][number]) => {
    const slide = r.slides.find((x) => x.blockId === b.id);
    const items = slide?.items ?? [];
    const actions = slide?.actions ?? [];
    part("slide", b.title || t("slide"), [
      ...(slide?.body.trim() ? [{ type: "markdown", text: slide.body.trim() } as const] : []),
      ...(items.length
        ? [
            { type: "label", text: t("slideItems"), tone: "custom" } as const,
            {
              type: "list",
              items: items.map((i) => ({
                text: i.text,
                ...(i.byId ? { by: nm(i.byId) } : {}),
                ...(i.tracked ? { meta: ` · ${t("slideTracked")}` } : {}),
              })),
            } as const,
          ]
        : []),
      ...(actions.length
        ? [
            { type: "label", text: t("slideActions"), tone: "notes" } as const,
            { type: "list", items: actions.map((a) => ({ text: a.text, meta: ` (${nm(a.ownerId)})` })) } as const,
          ]
        : []),
      ...notesBlock(r.notes[b.id]),
      ...(r.notes[`qa:${b.id}`]?.trim()
        ? [{ type: "label", text: t("exchanges"), tone: "qa" } as const, ...notesBlock(r.notes[`qa:${b.id}`])]
        : []),
    ]);
  };
  // Slides placed before the turns read right after the intro, as they were run; the others after the turns
  const firstTurn = r.agenda.findIndex((b) => b.type === "round" || b.type === "projects");
  const slides = r.agenda.map((b, i) => ({ b, early: firstTurn < 0 || i < firstTurn })).filter((x) => x.b.type === "slide");
  for (const x of slides.filter((y) => y.early)) slidePart(x.b);

  if (on("mood") && r.mood?.counts.some(Boolean)) {
    const avg = r.mood.avg;
    part("mood", t("mood"), [
      {
        type: "text",
        text:
          MOODS.map((m, i) => `${m.e} ${r.mood!.counts[i] ?? 0}`).join(" · ") +
          (avg !== null ? ` (${t("moodAverage", { avg: f.decimal(avg) })})` : ""),
      },
    ]);
  }
  if (on("icebreaker") && r.icebreaker?.answers.length)
    part("icebreaker", t("icebreaker", { question: r.icebreaker.question }), [
      { type: "list", items: r.icebreaker.answers.map((a) => ({ by: nm(a.byId), text: a.text })) },
    ]);

  const presented = new Set(r.projects.filter((p) => p.presented).map((p) => p.id));
  const projectName = (id: string) => r.projects.find((p) => p.id === id)?.name ?? "";
  /** Check-in items as labelled lists, section by section; `by` names the author (items of several people), or
   * nobody when it gives "" */
  const sectionBlocks = (items: RecordItem[], by?: (x: RecordItem) => string): MinutesBlock[] => {
    const out: MinutesBlock[] = [];
    r.sections.forEach((def, i) => {
      const list = items.filter((x) => x.section === def.key);
      if (!list.length) return;
      const s = sections[i]!;
      out.push({ type: "label", text: s.label, tone: s.kind === "extra" ? "custom" : def.role });
      // Free text: kept as is, one paragraph per line
      if (s.type === "text" && list.every((x) => !by?.(x))) {
        for (const x of list) for (const line of x.text.split("\n")) if (line.trim()) out.push({ type: "text", text: line });
        return;
      }
      out.push({
        type: "list",
        items: list.map((x) => {
          const cs = on("comments") ? r.comments.filter((cm) => cm.itemId === x.id) : [];
          const likes = cs.filter((cm) => !cm.text).length;
          const notes = cs.filter((cm) => cm.text).map((cm) => ({ by: nm(cm.byId), text: cm.text }));
          const text = s.type === "text" ? x.text.replace(/\n+/g, " ") : x.text;
          return {
            ...itemOf(text),
            ...(by?.(x) ? { by: by(x) } : {}),
            ...(likes ? { likes } : {}),
            ...(notes.length ? { children: notes } : {}),
          };
        }),
      });
    });
    return out;
  };
  /** Host notes, questions and exchanges of a step */
  const stepBlocks = (key: string, withHeading: boolean): MinutesBlock[] => {
    const out: MinutesBlock[] = [];
    if (r.notes[key]?.trim()) {
      if (withHeading) out.push({ type: "label", text: t("hostNotes", { host }), tone: "notes" });
      out.push(...notesBlock(r.notes[key]));
    }
    const qa = on("questions") ? r.interactions.filter((x) => x.stepKey === key && x.type === "question") : [];
    if (qa.length)
      out.push(
        { type: "label", text: t("questions"), tone: "qa" },
        { type: "list", items: qa.map((x) => ({ by: nm(x.byId), text: x.text })) },
      );
    if (r.notes["qa:" + key]?.trim()) out.push({ type: "label", text: t("exchanges"), tone: "qa" }, ...notesBlock(r.notes["qa:" + key]));
    return out;
  };

  const people: MinutesBlock[] = [];
  for (const p of r.participants) {
    const c = r.checkIns[p.id];
    const blocks: MinutesBlock[] = [];
    if (on("checkIns")) {
      const items = c?.items ?? [];
      // A line others joined ("me too") names them all, the author first
      const joined = (x: RecordItem) =>
        x.with.some((id) => r.names[id]) ? [nm(p.id), ...x.with.filter((id) => r.names[id]).map((id) => nm(id))].join(", ") : "";
      blocks.push(
        ...sectionBlocks(
          items.filter((x) => !x.projectId),
          joined,
        ),
      );
      // Items about a project that had no step of its own: presented by the person, under the project's name
      for (const pid of [...new Set(items.map((x) => x.projectId))])
        if (pid && !presented.has(pid)) {
          const own = sectionBlocks(items.filter((x) => x.projectId === pid));
          // A project the record no longer names (deleted since) keeps its items, without a heading
          if (own.length)
            blocks.push(
              ...(projectName(pid) ? [{ type: "text" as const, text: t("aboutProject", { project: projectName(pid) }) }] : []),
              ...own,
            );
        }
    }
    // Without check-ins, the host notes need no heading
    blocks.push(...stepBlocks(p.id, blocks.length > 0));
    // With check-ins, every participant gets a line (speaking time); without, only those with something noted
    if (blocks.length || on("checkIns"))
      people.push({ type: "person", id: p.id, name: p.name, role: p.jobCategory, spentMs: r.spent[p.id] || 0, blocks });
  }
  part("round", t("round"), people);

  // Project round: the sheet of each project (its health, the message of the day), then what its people wrote
  const tProjects = translator(locale, "projects");
  part(
    "projects",
    t("projectRound"),
    r.projects
      .filter((p) => p.presented)
      .map((p): MinutesBlock => {
        const blocks: MinutesBlock[] = [];
        if (p.headline.trim()) blocks.push({ type: "markdown", text: p.headline.trim() });
        if (on("checkIns")) {
          const groups = projectItems(r, p.id);
          const author = new Map(groups.flatMap((g) => g.items.map((x) => [x.id, g.personId] as const)));
          blocks.push(
            ...sectionBlocks(
              groups.flatMap((g) => g.items),
              // Its author, then the people who joined it
              // (someone the record does not name is left out, not shown as the host)
              (x) => [nm(author.get(x.id) ?? null), ...x.with.filter((id) => r.names[id]).map((id) => nm(id))].filter(Boolean).join(", "),
            ),
          );
        }
        const key = `p:${p.id}`;
        blocks.push(...stepBlocks(key, blocks.length > 0));
        return {
          type: "project",
          id: p.id,
          name: p.name,
          theme: p.theme,
          health: p.health,
          healthLabel: p.health ? tProjects(`health.${p.health}`) : "",
          spentMs: r.spent[key] || 0,
          blocks,
        };
      }),
  );

  // Timeboxes: their own topic, with the host notes and the exchanges
  for (const b of r.agenda.filter((x) => x.type === "timebox"))
    part("timebox", b.title || t("timebox"), [
      ...notesBlock(r.notes[b.id]),
      ...(r.notes[`qa:${b.id}`]?.trim()
        ? [{ type: "label", text: t("exchanges"), tone: "qa" } as const, ...notesBlock(r.notes[`qa:${b.id}`])]
        : []),
    ]);

  for (const x of slides.filter((y) => !y.early)) slidePart(x.b);

  // Retro: per column, the groups most voted first, their notes and the host notes of their discussion
  if (r.retro && on("retro")) {
    const rb = r.retro;
    const tRetro = translator(locale, "retro");
    const blocks: MinutesBlock[] = [];
    for (const col of rb.columns) {
      const groups = rb.groups.filter((g) => g.column === col.key);
      if (!groups.length) continue;
      blocks.push(
        { type: "label", text: col.label || tRetro(`columns.${col.key}` as "columns.well"), tone: "custom" },
        {
          type: "list",
          items: groups.map((g) => ({
            text: g.title,
            meta: g.votes ? ` · ${t("votes", { count: g.votes })}` : "",
            children: [
              ...g.cards.filter((c) => c !== g.title || g.cards.length > 1).map((text) => ({ text })),
              ...noteLines(r.notes[`${rb.blockId}:discuss:${g.id}`]).map((line) => ({
                by: host,
                text: line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, ""),
              })),
            ],
          })),
        },
      );
    }
    // Host notes taken at the other steps of the retro (writing, grouping, vote, recap)
    const stepNotes = Object.entries(r.notes)
      .filter(([k, v]) => k.startsWith(`${rb.blockId}:`) && !k.includes(":discuss:") && v.trim())
      .map(([, v]) => v);
    if (stepNotes.length)
      blocks.push({ type: "label", text: t("hostNotes", { host }), tone: "notes" }, ...stepNotes.flatMap((v) => notesBlock(v)));
    part("retro", t("retro"), blocks);
  }

  // Planning poker: the estimate agreed for each item, the cards played, then the host notes and the exchanges
  const pokerBlock = r.agenda.find((b) => b.type === "poker");
  part("poker", t("poker"), [
    ...(r.poker.length
      ? [
          {
            type: "list",
            items: r.poker.map((i) => ({
              text: i.title,
              meta: `${i.final ? ` · ${t("estimate", { value: i.final })}` : ` · ${t("notEstimated")}`}${i.votes.length ? ` (${i.votes.join(", ")})` : ""}`,
            })),
          } as const,
        ]
      : []),
    ...(pokerBlock ? notesBlock(r.notes[pokerBlock.id]) : []),
    ...(pokerBlock && r.notes[`qa:${pokerBlock.id}`]?.trim()
      ? [{ type: "label", text: t("exchanges"), tone: "qa" } as const, ...notesBlock(r.notes[`qa:${pokerBlock.id}`])]
      : []),
  ]);
  // Polls: the question and its totals
  if (on("polls") && r.polls.length)
    part(
      "polls",
      t("polls"),
      r.polls.flatMap((p): MinutesBlock[] => [
        { type: "label", text: `${p.question} (${t("answers", { count: p.answers })})`, tone: "custom" },
        {
          type: "list",
          items: p.results
            .filter((x) => x.count || p.kind !== "words")
            .slice(0, 10)
            .map((x) => ({ text: x.value, meta: ` · ${x.count}` })),
        },
      ]),
    );

  const topics = on("topics") ? r.topics : [];
  if (topics.length || r.notes.misc?.trim() || r.notes["qa:misc"]?.trim())
    parts.push({
      kind: "topics",
      title: t("topics"),
      blocks: [
        ...(topics.length
          ? [
              {
                type: "list",
                items: topics.map((x) => ({
                  text: x.text,
                  meta: `${x.byId ? ` (${nm(x.byId)})` : ""}${x.votes ? ` · ${t("votes", { count: x.votes })}` : ""}${x.done ? "" : ` · ${t("postponed")}`}`,
                })),
              } as const,
            ]
          : []),
        ...notesBlock(r.notes.misc),
        ...(r.notes["qa:misc"]?.trim()
          ? [{ type: "label", text: t("exchanges"), tone: "qa" } as const, ...notesBlock(r.notes["qa:misc"])]
          : []),
      ],
    });

  if (on("topics") && r.parking.length)
    part("parking", t("parking"), [
      { type: "list", items: r.parking.map((x) => ({ text: x.text, meta: x.byId ? ` (${nm(x.byId)})` : "" })) },
    ]);

  if (r.actions.length) {
    const status = translator(locale, "actionStatus");
    // Where each one stands, as its owner wrote it: a column only when someone did
    const progress = r.actions.some((a) => a.progress);
    part("actions", t("actions"), [
      {
        type: "table",
        head: [t("action"), t("owner"), t("status"), ...(progress ? [t("progress")] : [])],
        rows: r.actions.map((a) => [a.text, nm(a.ownerId), status(a.status), ...(progress ? [a.progress ?? ""] : [])]),
      },
    ]);
  }
  if (on("kudos") && r.kudos.length)
    part("kudos", t("kudos"), [{ type: "list", items: r.kudos.map((k) => ({ by: `${nm(k.fromId)} → ${nm(k.toId)}`, text: k.text })) }]);
  // How useful the meeting was, rated at its wrap-up: at the end, where it was given
  if (on("rating") && r.rating?.counts.some(Boolean)) {
    const votes = r.rating.counts.reduce((a, b) => a + b, 0);
    part("rating", t("rating"), [
      { type: "text", text: t("ratingAverage", { avg: r.rating.avg === null ? "–" : f.decimal(r.rating.avg), count: votes }) },
    ]);
  }

  const blockerKeys = new Set(r.sections.filter((s) => s.role === "blocker").map((s) => s.key));
  const said = new Set(r.participants.map((p) => p.id));
  // Blockers of the people presented, and those written about a project presented by its members
  const blockers: MinutesItem[] = on("checkIns")
    ? Object.entries(r.checkIns).flatMap(([pid, c]) =>
        c.items
          .filter((x) => blockerKeys.has(x.section) && (x.projectId ? said.has(pid) || presented.has(x.projectId) : said.has(pid)))
          .map((x) => ({
            ...itemOf(x.text.replace(/\n+/g, " ")),
            meta: ` (${nm(pid)}${x.projectId ? ` · ${projectName(x.projectId)}` : ""})`,
          })),
      )
    : [];
  part("blockers", t("blockers"), blockers.length ? [{ type: "list", items: blockers }] : []);

  return {
    title: t("title", { team: r.teamName || t("defaultTeam") }),
    meta:
      t("summary", { date: f.date(r.date), duration: mmssPlain(r.durationMs), count: r.participants.length }) +
      (r.absent.length ? ` · ${t("absent", { names: r.absent.map((a) => a.name).join(", ") })}` : ""),
    parts,
    next: t("nextMeeting", { date: f.dateShort(r.nextDate ?? nextMonday(r.date)) }),
  };
}

// ---------- Markdown ----------

const checkbox = (checked: boolean | null | undefined) => (checked === undefined || checked === null ? "" : checked ? "☑ " : "☐ ");

function itemLines(item: MinutesItem, depth = 0): string[] {
  const head =
    `${"  ".repeat(depth)}- ${item.by ? `${item.by}: ` : ""}${checkbox(item.checked)}${item.text}` +
    (item.likes ? ` (👍 ${item.likes})` : "") +
    (item.meta ?? "") +
    (item.context ? ` _${item.context}_` : "");
  return [head, ...(item.children ?? []).flatMap((c) => itemLines(c, depth + 1))];
}

function blockLines(b: MinutesBlock): string[] {
  switch (b.type) {
    case "markdown":
    case "text":
      return [b.text];
    case "label":
      return [`**${b.text}**`];
    case "list":
      return b.items.flatMap((i) => itemLines(i));
    case "table":
      return [
        "",
        `| ${b.head.join(" | ")} |`,
        `|${b.head.map(() => "---").join("|")}|`,
        ...b.rows.map((r) => `| ${r.map((c) => c.replace(/\|/g, "/")).join(" | ")} |`),
      ];
    case "person":
      return ["", `### ${personHeading(b)}`, ...b.blocks.flatMap(blockLines)];
    case "project":
      return ["", `### ${projectHeading(b)}`, ...b.blocks.flatMap(blockLines)];
  }
}

/** "Alice Martin (design) · 2:05" */
export const personHeading = (p: { name: string; role: string; spentMs: number }) =>
  `${p.name}${p.role ? ` (${p.role.toLowerCase()})` : ""} · ${mmssPlain(p.spentMs)}`;

/** "Billing revamp (Payments) · At risk · 6:10" */
export const projectHeading = (p: { name: string; theme: string; healthLabel: string; spentMs: number }) =>
  `${p.name}${p.theme ? ` (${p.theme})` : ""}${p.healthLabel ? ` · ${p.healthLabel}` : ""} · ${mmssPlain(p.spentMs)}`;

/** The minutes as Markdown (copy, file, PDF) */
export function minutesToMarkdown(doc: MinutesDoc): string {
  const lines = [`# ${doc.title}`, doc.meta];
  for (const p of doc.parts) lines.push("", `## ${p.title}`, ...p.blocks.flatMap(blockLines));
  lines.push("", doc.next);
  return lines.join("\n");
}

/** Shortcut: the Markdown minutes of a record */
export const minutesMarkdown = (r: RecordV1, locale: Locale, options?: MinutesOptions) =>
  minutesToMarkdown(buildMinutes(r, locale, options));
