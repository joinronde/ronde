import "server-only";
import type { AgendaBlock } from "@ronde/core/agenda";
import { buildAgenda, elapsedOf, transition } from "@ronde/core/meeting";
import type { MinutesPart, RecordV1 } from "@ronde/core/record";
import type { MeetingDTO, SectionDef } from "@ronde/core/types";
import { moodAverage, RATING_MIN_VOTES, withEffectiveRoles } from "@ronde/core/util";
import { Prisma, type ScopedTx, type Session } from "@ronde/db";
import { type Locale, resolveLocale } from "@ronde/i18n";
import { readConfig } from "@ronde/module-sdk";
import { retro, retroColumns } from "@ronde/modules";
import { OpError } from "../errors";
import { activeBlocks, blockData, onBlockStep, pollResults } from "./blocks";
import { archiveCheckIns } from "./checkins";
import type { MeetingCtx } from "./context";
import { personName, toInteraction, toMeeting, toMember, toSection } from "./dto";
import { type ModuleState, moduleStates } from "./modules";
import { archiveProjectSheets, followedProjects } from "./projects";
import { nextSessionOccurrence, openSession } from "./schedule";
import { participantsOf, sectionsOf } from "./state";

const nextDay = (iso: string) => new Date(Date.parse(`${iso}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Session columns from a partial meeting DTO */
export function sessionData(p: Partial<MeetingDTO>): Prisma.SessionUpdateInput {
  const d: Prisma.SessionUpdateInput = {};
  if (p.stepKey !== undefined) d.stepKey = p.stepKey;
  if (p.order !== undefined) d.order = p.order;
  if (p.projectOrder !== undefined) d.projectOrder = p.projectOrder;
  if (p.absent !== undefined) d.absent = p.absent;
  if (p.spent !== undefined) d.spent = p.spent;
  if (p.bonus !== undefined) d.bonus = p.bonus;
  if (p.timer !== undefined) {
    d.timerRunning = p.timer.running;
    d.timerStartedAt = p.timer.startedAt ? new Date(p.timer.startedAt) : null;
    d.timerBaseMs = Math.round(p.timer.baseMs);
  }
  if (p.startedAt !== undefined) d.startedAt = p.startedAt ? new Date(p.startedAt) : null;
  if (p.endedAt !== undefined) d.endedAt = p.endedAt ? new Date(p.endedAt) : null;
  return d;
}

/** Agenda of a session; labels do not matter here, only step keys and types */
export async function agendaFor(db: ScopedTx, s: Session) {
  const [participants, interactions, meeting, mods] = await Promise.all([
    participantsOf(db, s.meetingId),
    db.interaction.findMany({ where: { sessionId: s.id } }),
    db.meeting.findFirstOrThrow({ where: { id: s.meetingId }, select: { id: true, agenda: true, speakSec: true } }),
    moduleStates(db, s.meetingId),
  ]);
  const byId = Object.fromEntries(participants.map((p) => [p.personId, toMember(p)]));
  const blocks = activeBlocks(meeting, mods);
  return buildAgenda(toMeeting(s), byId, interactions.map(toInteraction), "en", blocks, await blockData(db, meeting, blocks, s, mods));
}

/** Goes to a step of the session; returns it with the agenda (null when the session already stands there) */
export async function goToKey(db: ScopedTx, s: Session, key: string, autoStart: boolean) {
  const agenda = await agendaFor(db, s);
  const step = agenda.find((x) => x.key === key);
  if (!step) throw new OpError("stepNotFound");
  if (step.key === s.stepKey) return null;
  // Before "Start the meeting", stay on the intro: one click too many does not skip it
  if (!s.startedAt) throw new OpError("startFirst");
  const patch = transition(toMeeting(s), step, Date.now(), autoStart);
  await db.session.update({ where: { id: s.id }, data: { ...sessionData(patch), spotlight: Prisma.DbNull, draw: Prisma.DbNull } });
  await onBlockStep(db, s.workspaceId, s, step);
  // Leaving a "Questions" step forward: whatever was still pending there counts as handled
  const from = agenda.findIndex((x) => x.key === s.stepKey);
  if (s.stepKey.startsWith("qa:") && agenda.indexOf(step) > from)
    await db.interaction.updateMany({ where: { sessionId: s.id, stepKey: s.stepKey.slice(3), resolved: false }, data: { resolved: true } });
  return { step, agenda };
}

/** What archiving needs to know of the meeting: a signed-in host's context, or a background job's */
export type RecordCtx = Pick<MeetingCtx, "meeting"> & { ws: Pick<MeetingCtx["ws"], "workspace"> };

/**
 * Archives the session: its record and summary, the check-ins presented, the topics handled, the parking lot
 * carried over; then prepares the next session. Returns the record.
 */
export async function archiveSession(
  db: ScopedTx,
  m: RecordCtx,
  s: Session,
  o: { summary: string | null; omit: MinutesPart[] },
): Promise<RecordV1> {
  const record = await buildRecord(db, m, s, o.omit);
  await db.session.update({
    where: { id: s.id },
    data: {
      status: "archived",
      record: record as unknown as Prisma.InputJsonValue,
      summary: o.summary?.trim() || null,
      archivedAt: new Date(),
      timerRunning: false,
    },
  });
  // The items presented move to the session, and so do the sheets of the projects presented; the next
  // check-ins start empty. Absent people's own items are kept: they will be presented at the next session.
  await archiveCheckIns(
    db,
    m.meeting.id,
    s.id,
    Object.values(record.checkIns).flatMap((c) => c.items.map((i) => i.id)),
    record.sections,
  );
  // Items of a section removed since: they go with the person who was presented, as before the sections changed
  await db.checkInItem.updateMany({
    where: {
      meetingId: m.meeting.id,
      sessionId: null,
      personId: { in: record.participants.map((p) => p.id) },
      sectionKey: { notIn: record.sections.map((d) => d.key) },
    },
    data: { sessionId: s.id },
  });
  await archiveProjectSheets(
    db,
    m.meeting.id,
    s.id,
    record.projects.filter((p) => p.presented).map((p) => p.id),
  );
  // Handled open topics disappear, the others are carried over with their votes
  await db.topic.deleteMany({ where: { meetingId: m.meeting.id, done: true } });
  // The parking lot becomes open topics of the next session
  await db.topic.updateMany({ where: { meetingId: m.meeting.id, parked: true }, data: { parked: false } });
  // Next session: the next occurrence of the schedule (none when the schedule has no date left)
  await openSession(db, m.meeting, m.ws.workspace, { after: s.date, avoidIcebreaker: s.icebreaker });
  return record;
}

/** Snapshot of the session as it will be archived (current record format) */
export async function buildRecord(db: ScopedTx, ctx: RecordCtx, s: Session, omit: MinutesPart[] = []): Promise<RecordV1> {
  const now = Date.now();
  const dto = toMeeting(s);
  const { meeting } = ctx;
  const [participants, sectionRows, projects, items, notes, interactions, topics, actions, answers, kudos, moods, ratings, comments] =
    await Promise.all([
      participantsOf(db, meeting.id),
      sectionsOf(db, meeting.id),
      followedProjects(db, meeting.id),
      db.checkInItem.findMany({
        where: { meetingId: meeting.id, sessionId: null },
        orderBy: { position: "asc" },
        include: { contributors: { orderBy: { createdAt: "asc" }, select: { personId: true } } },
      }),
      db.note.findMany({ where: { sessionId: s.id } }),
      db.interaction.findMany({ where: { sessionId: s.id }, orderBy: { createdAt: "asc" } }),
      db.topic.findMany({
        where: { meetingId: meeting.id },
        orderBy: { createdAt: "asc" },
        include: { _count: { select: { votes: true } } },
      }),
      db.action.findMany({ where: { meetingId: meeting.id }, orderBy: { createdAt: "asc" } }),
      db.icebreakerAnswer.findMany({ where: { sessionId: s.id }, orderBy: { createdAt: "asc" } }),
      db.kudo.findMany({ where: { sessionId: s.id }, orderBy: { createdAt: "asc" } }),
      db.mood.findMany({ where: { sessionId: s.id } }),
      db.rating.findMany({ where: { sessionId: s.id } }),
      db.checkInComment.findMany({ where: { sessionId: s.id }, orderBy: { createdAt: "asc" } }),
    ]);
  const sections: SectionDef[] = withEffectiveRoles(sectionRows.map(toSection));
  const locale = resolveLocale(meeting.locale, ctx.ws.workspace.locale);
  const moodCounts = [0, 0, 0, 0, 0];
  for (const x of moods) if (x.value >= 1 && x.value <= 5) moodCounts[x.value - 1]!++;
  const ratingCounts = [0, 0, 0, 0, 0];
  for (const x of ratings) if (x.value >= 1 && x.value <= 5) ratingCounts[x.value - 1]!++;
  const byId = Object.fromEntries(participants.map((p) => [p.personId, toMember(p)]));
  const mods = await moduleStates(db, meeting.id);
  const blocks = activeBlocks(meeting, mods);
  const agenda = buildAgenda(
    dto,
    byId,
    interactions.map(toInteraction),
    locale,
    blocks,
    await blockData(db, meeting, blocks, s, mods, projects),
  );
  const spent = { ...dto.spent };
  if (dto.stepKey !== "end") spent[dto.stepKey] = elapsedOf(dto, now);
  const speakers = agenda.filter((x) => x.type === "speaker").map((x) => x.id!);
  // Projects of the project round: their items are presented whoever is absent; the items about the other
  // projects go with the person who wrote them, when they speak
  const projectTurns = agenda.filter((x) => x.type === "project");
  const roundOf = new Set(projectTurns.map((x) => x.projectId!));
  const sectionOrder = new Map(sections.map((d, i) => [d.key, i]));
  const end = dto.endedAt ?? now;
  const weekAgo = (dto.startedAt ?? now) - 7 * 86_400_000;
  // Names of everyone mentioned, participants or not (a workspace admin running the session…)
  const names: Record<string, string> = Object.fromEntries(participants.map((p) => [p.personId, personName(p.person)]));
  const presented = new Set(speakers);
  const said = items
    .filter((i) => sectionOrder.has(i.sectionKey) && (presented.has(i.personId) || (!!i.projectId && roundOf.has(i.projectId))))
    .filter((i) => byId[i.personId])
    .sort((a, b) => sectionOrder.get(a.sectionKey)! - sectionOrder.get(b.sectionKey)! || a.position - b.position);
  const saidIds = new Set(said.map((i) => i.id));
  // …and the people who joined lines or own an action (an observer…), even someone no longer in the meeting
  const others = [...new Set([...said.flatMap((i) => i.contributors.map((c) => c.personId)), ...actions.map((a) => a.ownerId)])].filter(
    (id) => !names[id],
  );
  if (others.length) for (const p of await db.person.findMany({ where: { id: { in: others } } })) names[p.id] = personName(p);
  const writers = [...new Set([...speakers.filter((id) => said.some((i) => i.personId === id)), ...said.map((i) => i.personId)])];
  const recordProject = (p: (typeof projects)[number], speakersOf: string[], inRound: boolean): RecordV1["projects"][number] => ({
    id: p.id,
    name: p.name,
    theme: p.theme?.name ?? "",
    status: p.status,
    health: p.sheet?.health ?? p.health,
    headline: inRound ? (p.sheet?.headline ?? "") : "",
    speakers: speakersOf,
    presented: inRound,
  });
  const record: RecordV1 = {
    v: 1,
    date: s.date,
    teamName: meeting.name,
    hostLabel: meeting.hostLabel,
    startedAt: dto.startedAt,
    endedAt: end,
    durationMs: dto.startedAt ? end - dto.startedAt : 0,
    spent,
    participants: speakers.map((id) => ({ id, name: byId[id]!.name, jobCategory: byId[id]!.jobCategory })),
    absent: dto.absent.filter((id) => byId[id]).map((id) => ({ id, name: byId[id]!.name })),
    sections,
    checkIns: Object.fromEntries(
      [...new Set([...speakers, ...writers])].map((id) => [
        id,
        {
          items: said
            .filter((i) => i.personId === id)
            .map((i) => ({
              id: i.id,
              section: i.sectionKey,
              text: i.text,
              sourceItemId: i.sourceItemId,
              projectId: i.projectId,
              with: i.contributors.map((c) => c.personId),
            })),
        },
      ]),
    ),
    projects: [
      ...projectTurns.map((x) => recordProject(projects.find((p) => p.id === x.projectId)!, x.speakers ?? [], true)),
      ...projects.filter((p) => !roundOf.has(p.id) && said.some((i) => i.projectId === p.id)).map((p) => recordProject(p, [], false)),
    ],
    notes: Object.fromEntries(notes.filter((n) => n.text.trim()).map((n) => [n.key, n.text])),
    interactions: interactions.map((i) => ({
      type: i.type,
      byId: i.byId,
      targetId: i.targetId,
      text: i.text,
      stepKey: i.stepKey,
      resolved: i.resolved,
    })),
    topics: topics
      .filter((t) => !t.parked || !mods.parking?.enabled)
      .map((t) => ({ text: t.text, byId: t.byId, done: t.done, votes: t._count.votes }))
      .sort((a, b) => b.votes - a.votes),
    parking: mods.parking?.enabled ? topics.filter((t) => t.parked).map((t) => ({ text: t.text, byId: t.byId })) : [],
    actions: actions
      .filter((a) => a.status !== "done" || (a.doneAt?.getTime() ?? 0) > weekAgo)
      .map((a) => ({ text: a.text, ownerId: a.ownerId, status: a.status, progress: a.progress })),
    names,
    icebreaker: s.icebreaker ? { question: s.icebreaker, answers: answers.map((a) => ({ byId: a.byId, text: a.text })) } : null,
    kudos: kudos.map((k) => ({ fromId: k.fromId, toId: k.toId, text: k.text })),
    mood: moods.length ? { counts: moodCounts, avg: moodAverage(moodCounts) } : null,
    // Too few votes to keep them anonymous: not archived
    rating: ratings.length >= RATING_MIN_VOTES ? { counts: ratingCounts, avg: moodAverage(ratingCounts) } : null,
    comments: comments.filter((c) => saidIds.has(c.itemId)).map((c) => ({ itemId: c.itemId, byId: c.byId, text: c.text })),
    nextDate: (await nextSessionOccurrence(db, meeting, ctx.ws.workspace, nextDay(s.date)))?.date ?? null,
    omit,
    agenda: blocks.map((b) => ({ id: b.id, type: b.type, ...(b.type === "timebox" ? { title: b.title } : {}) })),
    retro: await retroRecord(db, blocks, s, mods, locale),
    ...(await pokerAndPolls(db, s, mods)),
  };
  return record;
}

/** The retro of a session as archived: columns and groups with their notes, most voted first, never an author */
async function retroRecord(
  db: ScopedTx,
  blocks: AgendaBlock[],
  s: Session,
  mods: Record<string, ModuleState>,
  locale: Locale,
): Promise<RecordV1["retro"]> {
  const block = blocks.find((b) => b.type === "retro");
  if (!block) return null;
  const [cards, groups] = await Promise.all([
    db.retroCard.findMany({ where: { sessionId: s.id }, orderBy: { createdAt: "asc" } }),
    db.retroGroup.findMany({ where: { sessionId: s.id }, include: { _count: { select: { votes: true } } }, orderBy: { position: "asc" } }),
  ]);
  return {
    blockId: block.id,
    // Columns of a preset keep their key only: the minutes name them in the language they are read in
    columns: (() => {
      const config = readConfig(retro, mods.retro?.config);
      return retroColumns(config, locale).map(({ key, label }) => ({ key, label: config.preset === "custom" ? label : "" }));
    })(),
    groups: [
      ...groups.map((g) => {
        const texts = cards.filter((c) => c.groupId === g.id).map((c) => c.text);
        return { id: g.id, column: g.column, title: g.title || texts[0]?.slice(0, 80) || "", votes: g._count.votes, cards: texts };
      }),
      // Notes never grouped (archived before the vote): one group each
      ...cards
        .filter((c) => !c.groupId)
        .map((c) => ({ id: c.id, column: c.column, title: c.text.slice(0, 80), votes: 0, cards: [c.text] })),
    ].sort((a, b) => b.votes - a.votes),
  };
}

/** Planning poker items with their estimate, polls with their totals (never who answered what) */
async function pokerAndPolls(db: ScopedTx, s: Session, mods: Record<string, ModuleState>): Promise<Pick<RecordV1, "poker" | "polls">> {
  const [items, polls] = await Promise.all([
    mods.poker?.enabled
      ? db.pokerItem.findMany({ where: { sessionId: s.id }, include: { votes: true }, orderBy: { position: "asc" } })
      : [],
    mods.polls?.enabled ? db.poll.findMany({ where: { sessionId: s.id }, include: { answers: true }, orderBy: { createdAt: "asc" } }) : [],
  ]);
  return {
    poker: items.map((i) => ({ title: i.title, final: i.final, votes: i.revealed || i.final ? i.votes.map((v) => v.value) : [] })),
    polls: polls.map((p) => ({
      question: p.question,
      kind: p.kind,
      answers: p.answers.length,
      results: pollResults({ ...p, anonymous: true }, p.answers, {}).map(({ value, count }) => ({ value, count })),
    })),
  };
}
