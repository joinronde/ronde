import "server-only";
import { type AgendaBlock, agendaOf, type BlockData } from "@ronde/core/agenda";
import type { Step } from "@ronde/core/meeting";
import type { PokerDTO, PollDTO, RetroDTO } from "@ronde/core/types";
import { HOST_ID } from "@ronde/core/util";
import type { Meeting, ScopedClient, ScopedTx, Session } from "@ronde/db";
import type { Locale } from "@ronde/i18n";
import { readConfig } from "@ronde/module-sdk";
import { groupLoneCards, POKER_DECKS, poker, pokerLive, retro, retroColumns, retroState, SCALE } from "@ronde/modules";
import type { ModuleState } from "./modules";
import { type FollowedProject, projectRoundData } from "./projects";

// Module blocks of the agenda (retrospective, timebox…): what their steps depend on, and what each viewer sees

type Db = ScopedClient | ScopedTx;

/** Blocks of the meeting's agenda whose module is on (a block of a module turned off is left out) */
export function activeBlocks(meeting: Pick<Meeting, "agenda">, mods: Record<string, ModuleState>): AgendaBlock[] {
  return agendaOf(meeting.agenda).filter((b) => !["retro", "timebox", "poker"].includes(b.type) || mods[b.type]?.enabled);
}

/** Data the agenda expands from: the same on the server and in the browser */
export async function blockData(
  db: Db,
  meeting: Pick<Meeting, "id" | "speakSec">,
  blocks: AgendaBlock[],
  session: Pick<Session, "id"> | null,
  mods: Record<string, ModuleState>,
  projects?: FollowedProject[],
): Promise<BlockData> {
  const out: BlockData = {};
  if (blocks.some((b) => b.type === "projects")) out.projects = await projectRoundData(db, meeting, projects);
  if (blocks.some((b) => b.type === "retro")) {
    const config = readConfig(retro, mods.retro?.config);
    const groups = session
      ? await db.retroGroup.findMany({
          where: { sessionId: session.id },
          include: { _count: { select: { votes: true } } },
          orderBy: { position: "asc" },
        })
      : [];
    const cards =
      session && groups.length
        ? await db.retroCard.findMany({ where: { sessionId: session.id, groupId: { not: null } }, orderBy: { createdAt: "asc" } })
        : [];
    out.retro = {
      reflectMin: config.reflectMinutes,
      voteMin: config.voteMinutes,
      discussMin: config.discussMinutes,
      // A group without a title is named after its first note
      groups: groups.map((g) => ({
        id: g.id,
        title: g.title || cards.find((c) => c.groupId === g.id)?.text.slice(0, 80) || "",
        votes: g._count.votes,
        position: g.position,
      })),
    };
  }
  return out;
}

/** The retro as one viewer sees it: never an author, and during the writing only their own notes */
export async function retroView(
  db: Db,
  meeting: Pick<Meeting, "agenda">,
  session: Session | null,
  mods: Record<string, ModuleState>,
  viewer: { memberId: string | null; isHost: boolean },
  locale: Locale,
): Promise<RetroDTO | null> {
  if (!mods.retro?.enabled) return null;
  const { blockId, phase } = retroState(meeting, session);
  if (!blockId) return null;
  const config = readConfig(retro, mods.retro.config);
  const me = viewer.memberId ?? (viewer.isHost ? HOST_ID : null);
  const [cards, groups] = session
    ? await Promise.all([
        db.retroCard.findMany({ where: { sessionId: session.id }, orderBy: { createdAt: "asc" } }),
        db.retroGroup.findMany({
          where: { sessionId: session.id },
          include: { votes: { select: { personId: true } } },
          orderBy: { position: "asc" },
        }),
      ])
    : [[], []];
  const columns = retroColumns(config, locale);
  const counts: Record<string, number> = Object.fromEntries(columns.map((c) => [c.key, 0]));
  for (const c of cards) counts[c.column] = (counts[c.column] ?? 0) + 1;
  // Before the reveal, the others' notes stay on the server: only how many there are
  const revealed = phase !== null && phase !== "reflect";
  const shown = cards.filter((c) => revealed || c.authorId === me);
  const myVotes = me ? groups.filter((g) => g.votes.some((v) => v.personId === me)).length : 0;
  return {
    blockId,
    phase,
    columns,
    votesPerPerson: config.votesPerPerson,
    cards: shown.map((c) => ({ id: c.id, column: c.column, groupId: c.groupId, text: c.text, mine: c.authorId === me })),
    counts,
    writers: new Set(cards.map((c) => c.authorId)).size,
    groups: groups.map((g) => ({
      id: g.id,
      column: g.column,
      title: g.title,
      position: g.position,
      votes: g.votes.length,
      mine: !!me && g.votes.some((v) => v.personId === me),
    })),
    myVotesLeft: Math.max(0, config.votesPerPerson - myVotes),
    voters: new Set(groups.flatMap((g) => g.votes.map((v) => v.personId))).size,
  };
}

/** Work done when a step of a module block starts */
export async function onBlockStep(db: ScopedTx, workspaceId: string, session: Session, step: Step) {
  // The vote starts: every note left alone becomes a group of its own, so it can be voted on
  if (step.block === "retro" && step.sub === "vote") await groupLoneCards(db, workspaceId, session.id);
}

/** Planning poker as one viewer sees it: the cards of others only once revealed */
export async function pokerView(
  db: Db,
  meeting: Pick<Meeting, "agenda">,
  session: Session | null,
  mods: Record<string, ModuleState>,
  viewer: { memberId: string | null; isHost: boolean },
): Promise<PokerDTO | null> {
  if (!mods.poker?.enabled || !agendaOf(meeting.agenda).some((b) => b.type === "poker")) return null;
  const me = viewer.memberId ?? (viewer.isHost ? HOST_ID : null);
  const items = session
    ? await db.pokerItem.findMany({ where: { sessionId: session.id }, include: { votes: true }, orderBy: { position: "asc" } })
    : [];
  return {
    live: pokerLive(meeting, session),
    deck: [...POKER_DECKS[readConfig(poker, mods.poker.config).deck as keyof typeof POKER_DECKS]],
    items: items.map((i) => ({
      id: i.id,
      title: i.title,
      position: i.position,
      revealed: i.revealed,
      final: i.final,
      voted: i.votes.length,
      votes: i.revealed ? i.votes.map((v) => ({ personId: v.personId, value: v.value })) : [],
      myVote: i.votes.find((v) => v.personId === me)?.value ?? null,
    })),
  };
}

/** Totals of a poll: per option, per scale value, or per word (case and accents aside) */
export function pollResults(
  poll: { kind: string; options: string[]; anonymous: boolean },
  answers: { personId: string; values: string[] }[],
  names: Record<string, string>,
): PollDTO["results"] {
  const fold = (w: string) => w.trim().toLowerCase();
  const base = poll.kind === "scale" ? SCALE : poll.kind === "words" ? [] : poll.options;
  const counts = new Map<string, { value: string; count: number; people: string[] }>(
    base.map((v) => [v, { value: v, count: 0, people: [] }]),
  );
  for (const a of answers)
    for (const v of a.values) {
      const key = poll.kind === "words" ? fold(v) : v;
      const row = counts.get(key) ?? { value: v.trim(), count: 0, people: [] };
      row.count++;
      if (!poll.anonymous) row.people.push(names[a.personId] ?? "");
      counts.set(key, row);
    }
  const rows = [...counts.values()];
  return poll.kind === "words" ? rows.sort((a, b) => b.count - a.count).slice(0, 40) : rows;
}

export async function pollsView(
  db: Db,
  session: Session | null,
  mods: Record<string, ModuleState>,
  viewer: { memberId: string | null; isHost: boolean },
  names: Record<string, string>,
): Promise<PollDTO[]> {
  if (!mods.polls?.enabled || !session) return [];
  const me = viewer.memberId ?? (viewer.isHost ? HOST_ID : null);
  const polls = await db.poll.findMany({ where: { sessionId: session.id }, include: { answers: true }, orderBy: { createdAt: "asc" } });
  return polls.map((p) => ({
    id: p.id,
    question: p.question,
    kind: p.kind,
    options: p.options,
    anonymous: p.anonymous,
    open: p.open,
    shown: session.shownPollId === p.id,
    answers: p.answers.length,
    results: pollResults(p, p.answers, names),
    mine: p.answers.find((a) => a.personId === me)?.values ?? null,
  }));
}
