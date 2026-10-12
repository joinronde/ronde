import "server-only";
import { buildAgenda } from "@ronde/core/meeting";
import type { CheckInDTO, SectionDef, Snapshot, WikiChoice } from "@ronde/core/types";
import { HOST_ID, plainItem } from "@ronde/core/util";
import { prisma, type ScopedClient, type ScopedTx } from "@ronde/db";
import { resolveLocale } from "@ronde/i18n";
import { HIDE_UPGRADE_HINTS } from "@/lib/shared/prefs";
import { aiConfig } from "../ai";
import { brandingOn, logoPath } from "../branding";
import { calendarSyncOn, listCalendarAccounts } from "../calendars";
import { env } from "../env";
import { inboundOn } from "../inbound";
import { editionOf } from "../license";
import { notificationsDTO } from "../notify/rules";
import { upgradeTarget } from "../plans";
import { visibleWhere } from "../projects";
import { canEncrypt } from "../secrets";
import { transcriptionConfig, transcriptionOn } from "../transcripts";
import { listVideoAccounts, videoLinksOn } from "../video-accounts";
import { wikisOn } from "../wikis";
import { activeBlocks, blockData, pokerView, pollsView, retroView } from "./blocks";
import { lastPlans, loadCheckIns } from "./checkins";
import type { MeetingCtx } from "./context";
import {
  ms,
  participantInclude,
  personName,
  toAction,
  toAnswer,
  toComment,
  toContributor,
  toInteraction,
  toKudo,
  toMeeting,
  toMember,
  toMood,
  toRating,
  toReaction,
  toSection,
  toSettings,
  toTopic,
} from "./dto";
import { moduleStates } from "./modules";
import { followedProjects, toProjectDTO } from "./projects";
import { scheduleDTO } from "./schedule";

type Db = ScopedClient | ScopedTx;

/** The session being prepared or run, if any */
export const currentSession = (db: Db, meetingId: string) => db.session.findFirst({ where: { meetingId, status: "current" } });

export const sectionsOf = (db: Db, meetingId: string) => db.section.findMany({ where: { meetingId }, orderBy: { position: "asc" } });

/** Participants who take part (observers excluded), in round-table order */
export const participantsOf = (db: Db, meetingId: string) =>
  db.meetingParticipant.findMany({
    where: { meetingId, role: { not: "observer" } },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    include: participantInclude,
  });

export const observersOf = (db: Db, meetingId: string) =>
  db.meetingParticipant.findMany({ where: { meetingId, role: "observer" }, orderBy: { createdAt: "asc" }, include: participantInclude });

export const jobCategoryNames = async (db: Db) =>
  (await db.jobCategory.findMany({ orderBy: { position: "asc" }, select: { name: true } })).map((c) => c.name);

/** State of a meeting as one viewer sees it; texts built on the server (schedule summary) use their language */
export async function loadSnapshot(ctx: MeetingCtx, viewerLocale?: string): Promise<Snapshot> {
  const { db } = ctx.ws;
  const { meeting, viewer } = ctx;
  const [sectionRows, participants, observers, session, topics, actions, lastArchived, plans, prefs, categories, mods] = await Promise.all([
    sectionsOf(db, meeting.id),
    participantsOf(db, meeting.id),
    observersOf(db, meeting.id),
    currentSession(db, meeting.id),
    db.topic.findMany({ where: { meetingId: meeting.id }, orderBy: { createdAt: "asc" }, include: { votes: true } }),
    db.action.findMany({ where: { meetingId: meeting.id }, orderBy: { createdAt: "asc" } }),
    db.session.findFirst({ where: { meetingId: meeting.id, status: "archived" }, orderBy: { date: "desc" }, select: { archivedAt: true } }),
    lastPlans(db, meeting.id),
    prisma.userPref.findMany({ where: { userId: viewer.userId } }),
    jobCategoryNames(db),
    moduleStates(db, meeting.id),
  ]);
  const on = (id: string) => !!mods[id]?.enabled;
  const sections: SectionDef[] = sectionRows.map(toSection);
  const checkIns = await loadCheckIns(db, meeting.id, sections);
  const sid = session?.id ?? "-";
  const [notes, interactions, reactions, answers, kudos, moods, ratings, comments, contributors] = await Promise.all([
    ctx.can("notes.read") ? db.note.findMany({ where: { sessionId: sid } }) : Promise.resolve([]),
    db.interaction.findMany({ where: { sessionId: sid }, orderBy: { createdAt: "asc" } }),
    db.reaction.findMany({ where: { sessionId: sid }, orderBy: { createdAt: "asc" } }),
    db.icebreakerAnswer.findMany({ where: { sessionId: sid }, orderBy: { createdAt: "asc" } }),
    db.kudo.findMany({ where: { sessionId: sid }, orderBy: { createdAt: "asc" } }),
    db.mood.findMany({ where: { sessionId: sid } }),
    db.rating.findMany({ where: { sessionId: sid } }),
    db.checkInComment.findMany({ where: { sessionId: sid }, orderBy: { createdAt: "asc" }, include: { item: true } }),
    db.checkInItemContributor.findMany({
      where: { item: { meetingId: meeting.id, sessionId: null } },
      orderBy: { createdAt: "asc" },
      include: { item: { select: { personId: true, sectionKey: true, text: true, projectId: true } } },
    }),
  ]);

  // What each person planned at the most recent archived session where they spoke
  const lastWeek: Snapshot["lastWeek"] = Object.fromEntries(
    Object.entries(plans).map(([id, p]) => {
      const byProject: Record<string, string[]> = {};
      for (const i of p.items) if (i.projectId) (byProject[i.projectId] ??= []).push(plainItem(i.text));
      return [id, { date: p.date, next: p.items.map((i) => plainItem(i.text)), ...(Object.keys(byProject).length ? { byProject } : {}) }];
    }),
  );

  const locale = resolveLocale(viewerLocale, meeting.locale, ctx.ws.workspace.locale);
  const notify = await notificationsDTO(db, meeting.id);
  const blocks = activeBlocks(meeting, mods);
  const names = Object.fromEntries([...participants, ...observers].map((p) => [p.personId, personName(p.person)]));
  const brand = brandingOn(ctx.ws.workspace) ? await ctx.ws.db.workspaceLogo.findFirst({ select: { updatedAt: true } }) : null;
  const projects = await followedProjects(db, meeting.id);
  const [blocksData, retro, poker, polls] = await Promise.all([
    blockData(db, meeting, blocks, session, mods, projects),
    retroView(db, meeting, session, mods, viewer, locale),
    pokerView(db, meeting, session, mods, viewer),
    pollsView(db, session, mods, viewer, names),
  ]);
  const schedule = await scheduleDTO(db, meeting, ctx.ws.workspace, locale);
  // Attendance answers of the upcoming occurrences
  const answers_ = await db.attendance.findMany({
    where: { meetingId: meeting.id, occurrenceKey: { in: schedule.upcoming.map((o) => o.key) } },
    select: { occurrenceKey: true, personId: true, status: true },
  });
  const attendance: Snapshot["attendance"] = {};
  for (const a of answers_) (attendance[a.occurrenceKey] ??= {})[a.personId] = a.status;
  const settings = toSettings(meeting, sectionRows, ctx.ws.workspace, categories, mods, schedule);
  const image = await db.meetingImage.findFirst({ where: { meetingId: meeting.id }, select: { updatedAt: true } });
  settings.image = image ? image.updatedAt.getTime() : null;
  // A module turned off sends nothing: its data stays in the database, out of every browser
  const dto = session ? toMeeting(session) : null;
  if (dto && !on("icebreaker")) dto.icebreaker = null;
  if (dto && !on("spotlight")) dto.spotlight = null;
  if (dto && !on("random")) dto.draw = null;
  // Addresses, birthdays and handles are the directory's: for the people who read it, not an observer from
  // outside, a workspace guest or a guest link
  const directory = ctx.can("people.read");
  const people = (list: typeof participants) =>
    list
      .map(toMember)
      .map((p) => (on("birthdays") && directory ? p : { ...p, birthday: null }))
      .map((p) => (directory ? p : { ...p, email: "", gitlabUsername: "", githubUsername: "" }));
  // Without the right to read every check-in (an observer, a guest link, a custom role), only what the session
  // running has presented so far, and one's own: a draft stays its writer's until their turn
  const shown = ctx.can("checkin.read.all")
    ? null
    : presentedSoFar(
        dto,
        Object.fromEntries(participants.map((p) => [p.personId, toMember(p)])),
        interactions.map(toInteraction),
        locale,
        blocks,
        blocksData,
      );
  const visible = (personId: string, projectId: string | null) =>
    !shown || personId === viewer.memberId || shown.speakers.has(personId) || (!!projectId && shown.projects.has(projectId));
  const guestLink = !ctx.ws.member.personId;
  // Whose votes are "mine" on the topics: the person running the meeting votes too, round or not
  const voter = viewer.memberId ?? (ctx.can("session.run") ? ctx.ws.member.personId || null : null);
  return {
    serverNow: Date.now(),
    context: { ...ctx.links, sample: ctx.meeting.sample },
    viewer,
    // GitLab connection details only serve the people configuring the meeting
    settings: viewer.isAdmin
      ? settings
      : {
          ...settings,
          gitlabProjects: "",
          gitlabGroups: "",
          githubRepos: "",
          // A guest link watches the shared screen: the team's call is not its to join
          ...(guestLink ? { videoUrl: "" } : {}),
          video: guestLink ? { ...settings.video, link: "", jitsiUrl: "", bbbUrl: "" } : { ...settings.video, bbbUrl: "" },
          tokensSet: { gitlab: false, github: false, bbb: false },
        },
    members: people(participants),
    observers: people(observers),
    meeting: dto,
    checkIns: shown ? visibleCheckIns(checkIns, visible) : checkIns,
    projects: projects.map((p) => toProjectDTO(p, new Set([...participants, ...observers].map((x) => x.personId)))),
    projectChoices: ctx.can("meeting.configure")
      ? (
          await db.project.findMany({
            // A private project is offered only to the people who see it
            where: { archivedAt: null, ...visibleWhere(ctx.ws) },
            orderBy: [{ position: "asc" }, { name: "asc" }],
            select: { id: true, name: true, status: true, theme: { select: { name: true } } },
          })
        ).map((p) => ({ id: p.id, name: p.name, status: p.status, theme: p.theme?.name ?? "" }))
      : null,
    notes: Object.fromEntries(notes.map((n) => [n.key, n.text])),
    interactions: on("hands") ? interactions.map(toInteraction) : [],
    reactions: on("reactions") ? reactions.map(toReaction) : [],
    // Parking lot turned off: what was parked shows with the other topics
    topics: topics.filter((t) => !t.parked || !on("parking")).map((t) => toTopic(t, voter)),
    parking: on("parking") ? topics.filter((t) => t.parked).map((t) => toTopic(t, voter)) : [],
    answers: on("icebreaker") ? answers.map(toAnswer) : [],
    kudos: on("kudos") ? kudos.map(toKudo) : [],
    mood: toMood(on("mood") ? moods : [], viewer.memberId ?? (viewer.isHost ? HOST_ID : null)),
    rating: toRating(on("rating") ? ratings : [], viewer.memberId ?? (viewer.isHost ? HOST_ID : null)),
    comments: comments.filter((c) => visible(c.item.personId, c.item.projectId)).map((c) => toComment(c, sections)),
    contributors: contributors.filter((c) => visible(c.item.personId, c.item.projectId)).map((c) => toContributor(c, sections)),
    actions: actions.map(toAction),
    lastWeek,
    lastArchivedAt: ms(lastArchived?.archivedAt),
    prefs: Object.fromEntries(prefs.map((p) => [p.key, p.value])),
    // Who comes to the coming sessions: the team's business, not a guest link's
    attendance: guestLink ? {} : attendance,
    modules: Object.fromEntries(Object.entries(mods).map(([id, m]) => [id, m.enabled])),
    // Paid plans: suggested to the people who choose the plan, unless hidden by the instance, by them, or already owned
    upgradeHints: prefs.some((p) => p.key === HIDE_UPGRADE_HINTS) ? null : upgradeTarget(ctx.ws.workspace, ctx.ws.member.role),
    edition: editionOf(ctx.ws.workspace),
    iceServers: env.iceServers(),
    transcription: transcriptionOn(ctx.ws.workspace)
      ? {
          allowed: ctx.meeting.transcription,
          ready: ctx.meeting.transcription && !!transcriptionConfig(ctx.ws.workspace.settings, ctx.ws.workspace),
          recording: session?.recordingSince
            ? { since: session.recordingSince.getTime(), by: names[session.recordingBy ?? ""] ?? "" }
            : null,
          optedOut: !!session?.transcriptOptOut.includes(ctx.ws.member.personId),
        }
      : null,
    calendars:
      calendarSyncOn(ctx.ws.workspace) && ctx.can("meeting.configure")
        ? {
            accounts: (await listCalendarAccounts(ctx.ws.db)).map(({ id, name, kind }) => ({ id, name, kind })),
            current: ctx.meeting.calendarAccountId,
          }
        : null,
    wikis:
      wikisOn(ctx.ws.workspace) && (ctx.can("meeting.configure") || ctx.can("minutes.edit"))
        ? await (async () => {
            const list = (await ctx.ws.db.wiki.findMany({
              orderBy: { createdAt: "asc" },
              select: { id: true, name: true, kind: true },
            })) as WikiChoice[];
            return { list: ctx.can("meeting.configure") ? list : [], current: list.find((w) => w.id === ctx.meeting.wikiId) ?? null };
          })()
        : null,
    videoAccounts:
      videoLinksOn(ctx.ws.workspace) && ctx.can("meeting.configure")
        ? (await listVideoAccounts(ctx.ws.db)).map(({ id, name, kind }) => ({ id, name, kind }))
        : [],
    ai: ctx.can("minutes.edit") && !!aiConfig(ctx.ws.workspace.settings, ctx.ws.workspace),
    brand: { logo: brand ? logoPath(ctx.ws.workspace.slug, brand.updatedAt.getTime()) : null, allowed: brandingOn(ctx.ws.workspace) },
    integrations: {
      gitlab: on("gitlab") && !!(mods.gitlab?.secret || env.gitlabToken()),
      // Public repositories answer without a token
      github: on("github"),
      smtp: !!env.smtpUrl(),
      secrets: canEncrypt(),
      inbound: inboundOn(),
    },
    blockData: blocksData,
    retro,
    poker,
    polls,
    notify: {
      nudge: notify.rules.some((r) => r.enabled && r.event === "checkin.reminder"),
      started: notify.rules.some((r) => r.enabled && r.event === "session.started"),
    },
    notifications: viewer.isAdmin ? { ...notify, canManageConnectors: ctx.can("connectors.manage") } : null,
  };
}

/** The speakers and projects the session running has presented so far (its current step included) */
function presentedSoFar(...args: Parameters<typeof buildAgenda>): { speakers: Set<string>; projects: Set<string> } {
  const meeting = args[0];
  const agenda = meeting?.startedAt ? buildAgenda(...args) : [];
  const at = agenda.findIndex((x) => x.key === meeting?.stepKey);
  const passed = at < 0 ? [] : agenda.slice(0, at + 1);
  return {
    speakers: new Set(passed.flatMap((x) => (x.type === "speaker" && x.id ? [x.id] : []))),
    projects: new Set(passed.flatMap((x) => (x.type === "project" && x.projectId ? [x.projectId] : []))),
  };
}

const NO_FIELDS = { done: [], next: [], blockers: [], other: [], extra: {} };

/** Check-ins held to what may be seen: whole for a person presented, by project for the projects presented */
function visibleCheckIns(all: Record<string, CheckInDTO>, visible: (personId: string, projectId: string | null) => boolean) {
  const out: Record<string, CheckInDTO> = {};
  for (const [id, c] of Object.entries(all)) {
    if (visible(id, null)) out[id] = c;
    else {
      const byProject = Object.fromEntries(Object.entries(c.byProject).filter(([projectId]) => visible(id, projectId)));
      if (Object.keys(byProject).length) out[id] = { ...NO_FIELDS, byProject, updatedAt: c.updatedAt };
    }
  }
  return out;
}
