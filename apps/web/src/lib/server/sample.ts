import "server-only";
import type { RecordV1 } from "@ronde/core/record";
import { zonedInstant } from "@ronde/core/schedule";
import type { Prisma } from "@ronde/db";
import { type Locale, resolveLocale, translator } from "@ronde/i18n";
import { AccessError } from "@ronde/module-sdk";
import { roundTableFaces } from "@ronde/ui/faces";
import sharp from "sharp";
import type { WorkspaceContext } from "./authz";
import { createMeeting } from "./meetings";
import { zonedClock } from "./reminders";

// The sample meeting: a weekly sync with a fictitious team and a month behind it (minutes, stats, actions), so a
// new workspace can try everything before inviting anyone. Written in the workspace's language. It is flagged
// (Meeting.sample, Person.sample): never counted as seats or first steps, never sending anything (its people's
// addresses are on the reserved .invalid domain), and deleted for good in one click.

/** The fictitious team: names shared by every language, faces of the sign-in round table */
const TEAM = [
  { key: "emma", first: "Emma", last: "Laurent" },
  { key: "lucas", first: "Lucas", last: "Martin" },
  { key: "sarah", first: "Sarah", last: "Cohen" },
  { key: "tom", first: "Tom", last: "Becker" },
  { key: "sofia", first: "Sofia", last: "Rossi" },
] as const;
type Who = (typeof TEAM)[number]["key"];

/** Archived sessions before the current one, a week apart */
const PAST = 4;
/** Number of votes per mood and per usefulness level (1 to 5), session after session */
const MOODS = [
  [0, 1, 2, 1, 1],
  [0, 0, 2, 2, 1],
  [0, 1, 1, 2, 1],
  [0, 0, 1, 3, 1],
];
const RATINGS = [
  [0, 1, 2, 2, 0],
  [0, 0, 2, 2, 1],
  [0, 0, 1, 3, 1],
  [0, 0, 1, 2, 2],
];
/** Blockers raised, by session: the staging access drags on and becomes an action */
const BLOCKERS: Record<number, [Who, "staging" | "crm" | "licence"][]> = {
  1: [["tom", "licence"]],
  2: [["emma", "staging"]],
  3: [
    ["emma", "staging"],
    ["lucas", "crm"],
  ],
};
const KUDOS: Record<number, [Who, Who, "checklist" | "screens" | "export"][]> = {
  1: [["sarah", "sofia", "checklist"]],
  2: [["emma", "tom", "screens"]],
  3: [["lucas", "emma", "export"]],
};
const QUESTIONS: Record<number, [Who, Who, "endpoint" | "alerts"][]> = {
  2: [["sarah", "emma", "endpoint"]],
  3: [["lucas", "sofia", "alerts"]],
};
const DECISIONS: Record<number, [Who, "escalate" | "notes"]> = { 1: ["tom", "notes"], 3: ["emma", "escalate"] };

const avg = (c: number[]) => c.reduce((a, n, i) => a + n * (i + 1), 0) / c.reduce((a, b) => a + b, 0);
const plusDays = (date: string, days: number) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The workspace's sample meeting, if it has one */
export function sampleMeeting(ctx: WorkspaceContext) {
  return ctx.db.meeting.findFirst({ where: { sample: true, archivedAt: null }, select: { id: true } });
}

/** Creates the sample meeting (or returns the one already there) and gives its id */
export async function createSample(ctx: WorkspaceContext): Promise<{ id: string }> {
  if (!ctx.can("meeting.create")) throw new AccessError(403, "accessDenied");
  const existing = await sampleMeeting(ctx);
  if (existing) return existing;
  const locale: Locale = resolveLocale(ctx.workspace.locale);
  const t = translator(locale, "sample");
  // Six tasks a person, done one week after the other
  const task = (who: Who, n: number) => t(`tasks.${who}.${n}` as Parameters<typeof t>[0]);
  const workspaceId = ctx.workspace.id;
  const timeZone = ctx.workspace.timezone || "UTC";

  // The team, with the faces of the sign-in page (drawn as SVG, stored as WebP like an uploaded photo)
  const faces = new Map(roundTableFaces().map((f) => [f.name, f.src]));
  const ids = {} as Record<Who, string>;
  for (const [i, p] of TEAM.entries()) {
    const person = await ctx.db.person.create({
      data: {
        workspaceId,
        sample: true,
        firstName: p.first,
        lastName: p.last,
        // A reserved domain (RFC 2606): nothing can ever reach it
        email: `${p.key}.${crypto.randomUUID().slice(0, 8)}@sample.invalid`,
        color: i % 6,
      },
    });
    ids[p.key] = person.id;
    const src = faces.get(p.first);
    if (src) {
      const svg = Buffer.from(decodeURIComponent(src.slice(src.indexOf(",") + 1)));
      const data = await sharp(svg, { density: 300 }).resize(256, 256).webp({ quality: 88 }).toBuffer();
      await ctx.db.personAvatar.create({ data: { personId: person.id, workspaceId, data, type: "image/webp" } });
    }
  }

  // The meeting, as any weekly sync: on today's weekday, the person who asked for it hosts and speaks
  const today = zonedClock(new Date(), timeZone).date;
  const day = ((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  // A weekly sync on a working day: on a weekend, the Monday after
  const weekday = day > 5 ? 1 : day;
  const { id: meetingId } = await createMeeting(ctx, {
    name: t("meetingName"),
    template: "builtin:weekly",
    startDate: today,
    time: "10:00",
    durationMin: 30,
    weekday,
    personIds: TEAM.map((p) => ids[p.key]),
    creatorSpeaks: true,
    modules: {},
  });
  await ctx.db.meeting.update({ where: { id: meetingId }, data: { sample: true, reminderEnabled: false } });
  const current = await ctx.db.session.findFirstOrThrow({ where: { meetingId, status: "current" } });
  // The fictitious team speaks first: starting the sample shows their check-ins at once, the host's turn comes last
  await ctx.db.meetingParticipant.updateMany({ where: { meetingId, personId: ctx.member.personId }, data: { position: TEAM.length + 1 } });
  await ctx.db.session.update({ where: { id: current.id }, data: { order: [...TEAM.map((p) => ids[p.key]), ctx.member.personId] } });
  const rule = await ctx.db.scheduleRule.findFirst({ where: { meetingId }, orderBy: { position: "asc" } });
  const sections = await ctx.db.section.findMany({ where: { meetingId }, orderBy: { position: "asc" } });
  const sectionDefs = sections.map((s) => ({ key: s.key, label: s.label, role: s.role, input: s.input }));
  const role = (key: string) => sections.find((s) => s.key === key)?.role ?? "custom";
  // The archived sessions fall on the same weekday, the weeks before the current one
  const dates = Array.from({ length: PAST }, (_, w) => plusDays(current.date, -7 * (PAST - w)));
  if (rule) await ctx.db.scheduleRule.update({ where: { id: rule.id }, data: { startDate: dates[0] } });
  const names = Object.fromEntries(TEAM.map((p) => [ids[p.key], `${p.first} ${p.last}`]));

  /** Item rows of a check-in; an achievement written like an item planned last time reports on it */
  type Row = Prisma.CheckInItemCreateManyInput & { id: string };
  let plans = new Map<string, string>();
  const rows = (who: Who, fields: Record<string, string[]>, sessionId: string | null): Row[] =>
    Object.entries(fields).flatMap(([key, texts]) =>
      texts.map((text, position) => ({
        id: crypto.randomUUID(),
        workspaceId,
        meetingId,
        personId: ids[who],
        sessionId,
        sectionKey: key,
        role: role(key),
        position,
        text,
        sourceItemId: role(key) === "achievement" ? (plans.get(`${ids[who]}:${text}`) ?? null) : null,
      })),
    );

  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const [w, date] of dates.entries()) {
    const sessionId = crypto.randomUUID();
    const items: Row[] = [];
    for (const p of TEAM) {
      // Sarah's second week went to an urgent fix: nothing of her plan done, it stays planned
      const done = p.key === "sarah" && w === 1 ? [] : [task(p.key, w + 1)];
      const next = [task(p.key, w + 2)];
      const blockers = (BLOCKERS[w] ?? []).filter(([who]) => who === p.key).map(([, b]) => t(`blockers.${b}`));
      items.push(...rows(p.key, { done, next, blockers }, sessionId));
    }
    const startedAt = zonedInstant(date, "10:00", timeZone);
    const spent: Record<string, number> = { intro: 120_000 + Math.round(rnd() * 60_000), misc: 150_000 + Math.round(rnd() * 180_000) };
    for (const p of TEAM) spent[ids[p.key]] = Math.round(85_000 + rnd() * 60_000 + (p.key === "emma" ? 25_000 : 0));
    const durationMs = Object.values(spent).reduce((a, b) => a + b, 0);
    const decision = DECISIONS[w];
    const kudos = (KUDOS[w] ?? []).map(([from, to, k]) => ({ fromId: ids[from], toId: ids[to], text: t(`kudos.${k}`) }));
    const record: RecordV1 = {
      v: 1,
      date,
      teamName: t("meetingName"),
      hostLabel: "",
      startedAt,
      endedAt: startedAt + durationMs,
      durationMs,
      spent,
      participants: TEAM.map((p) => ({ id: ids[p.key], name: names[ids[p.key]]!, jobCategory: "" })),
      absent: [],
      sections: sectionDefs,
      checkIns: Object.fromEntries(
        TEAM.map((p) => [
          ids[p.key],
          {
            items: items
              .filter((r) => r.personId === ids[p.key])
              .map((r) => ({
                id: r.id,
                section: r.sectionKey,
                text: r.text,
                sourceItemId: r.sourceItemId ?? null,
                projectId: null,
                with: [],
              })),
          },
        ]),
      ),
      projects: [],
      notes: decision ? { [ids[decision[0]]]: t(`decisions.${decision[1]}`) } : {},
      interactions: (QUESTIONS[w] ?? []).map(([by, to, q]) => ({
        type: "question" as const,
        byId: ids[by],
        targetId: ids[to],
        text: t(`questions.${q}`),
        stepKey: ids[to],
        resolved: true,
      })),
      topics: [],
      actions: [],
      names,
      icebreaker: null,
      kudos,
      mood: { counts: MOODS[w]!, avg: avg(MOODS[w]!) },
      rating: { counts: RATINGS[w]!, avg: avg(RATINGS[w]!) },
      comments: [],
      nextDate: dates[w + 1] ?? current.date,
      omit: [],
      agenda: [],
      retro: null,
      poker: [],
      parking: [],
      polls: [],
    };
    await ctx.db.session.create({
      data: {
        id: sessionId,
        workspaceId,
        meetingId,
        date,
        time: "10:00",
        durationMin: 30,
        occurrenceKey: rule ? `${rule.id}:${date}` : null,
        startsAt: new Date(startedAt),
        status: "archived",
        record: record as unknown as Prisma.InputJsonValue,
        summary: w === PAST - 1 ? t("summary") : null,
        startedAt: new Date(startedAt),
        endedAt: new Date(startedAt + durationMs),
        archivedAt: new Date(startedAt + durationMs),
      },
    });
    if (kudos.length) await ctx.db.kudo.createMany({ data: kudos.map((k) => ({ ...k, workspaceId, sessionId })) });
    await ctx.db.checkInItem.createMany({ data: items });
    plans = new Map(items.filter((r) => r.role === "plan").map((r) => [`${r.personId}:${r.text}`, r.id]));
  }

  // The coming session, ready to run: everyone's check-in written, two icebreaker answers, topics, moods
  for (const p of TEAM) {
    await ctx.db.checkIn.create({ data: { workspaceId, meetingId, personId: ids[p.key] } });
    const blockers = p.key === "emma" ? [t("blockers.staging")] : p.key === "lucas" ? [t("blockers.crm")] : [];
    await ctx.db.checkInItem.createMany({
      data: rows(
        p.key,
        { done: [task(p.key, PAST + 1)], next: [task(p.key, PAST + 2)], blockers, other: p.key === "emma" ? [t("dayOff")] : [] },
        null,
      ),
    });
  }
  const sessionId = current.id;
  await ctx.db.session.update({ where: { id: sessionId }, data: { icebreaker: t("icebreaker") } });
  await ctx.db.icebreakerAnswer.createMany({
    data: [
      { workspaceId, sessionId, byId: ids.lucas, text: t("answers.lucas") },
      { workspaceId, sessionId, byId: ids.sofia, text: t("answers.sofia") },
    ],
  });
  await ctx.db.mood.createMany({
    data: [
      { workspaceId, sessionId, personId: ids.lucas, value: 4 },
      { workspaceId, sessionId, personId: ids.sofia, value: 5 },
      { workspaceId, sessionId, personId: ids.emma, value: 2 },
    ],
  });
  const oncall = await ctx.db.topic.create({ data: { workspaceId, meetingId, text: t("topics.oncall"), byId: ids.sofia } });
  const flags = await ctx.db.topic.create({ data: { workspaceId, meetingId, text: t("topics.flags"), byId: ids.lucas } });
  await ctx.db.topicVote.createMany({
    data: [
      { workspaceId, topicId: oncall.id, personId: ids.emma },
      { workspaceId, topicId: oncall.id, personId: ids.tom },
      { workspaceId, topicId: flags.id, personId: ids.sarah },
    ],
  });
  // Follow-up actions born from the blockers, as old as the session that decided them
  const actions = [
    { text: t("actions.licence"), ownerId: ids.tom, status: "done" as const, originDate: dates[1]!, originText: t("blockers.licence") },
    { text: t("actions.staging"), ownerId: ids.emma, status: "doing" as const, originDate: dates[2]!, originText: t("blockers.staging") },
    { text: t("actions.crm"), ownerId: ids.lucas, status: "open" as const, originDate: dates[3]!, originText: t("blockers.crm") },
  ];
  for (const a of actions)
    await ctx.db.action.create({
      data: {
        workspaceId,
        meetingId,
        ...a,
        createdAt: new Date(`${a.originDate}T11:00:00Z`),
        doneAt: a.status === "done" ? new Date(`${dates[2]}T11:00:00Z`) : null,
      },
    });
  return { id: meetingId };
}

/** Deletes the sample meeting for good, with the people of its fictitious team who are nowhere else */
export async function deleteSample(ctx: WorkspaceContext, meetingId: string): Promise<void> {
  const meeting = await ctx.db.meeting.findFirst({
    where: { id: meetingId, sample: true },
    select: { id: true, createdById: true, participants: { select: { personId: true } } },
  });
  if (!meeting) return;
  // Its creator, or whoever administers the workspace
  if (meeting.createdById !== ctx.user.id && ctx.member.role !== "owner" && ctx.member.role !== "admin")
    throw new AccessError(403, "accessDenied");
  const people = meeting.participants.map((p) => p.personId);
  await ctx.db.$transaction(async (tx) => {
    await tx.inboxItem.deleteMany({ where: { meetingId } });
    await tx.meeting.delete({ where: { id: meetingId } });
    await tx.person.deleteMany({ where: { id: { in: people }, sample: true, participations: { none: {} } } });
  });
}
