import "server-only";
import { agendaOf } from "@ronde/core/agenda";
import { appearanceOf } from "@ronde/core/appearance";
import { parseSound } from "@ronde/core/sound";
import type {
  ActionDTO,
  AnswerDTO,
  CommentDTO,
  ContributorDTO,
  InteractionDTO,
  KudoDTO,
  MeetingDTO,
  MemberDTO,
  MoodDTO,
  ReactionDTO,
  RotatingRole,
  ScheduleDTO,
  SectionDef,
  SettingsDTO,
  SpotlightDTO,
  TopicDTO,
} from "@ronde/core/types";
import { fieldOf, RATING_MIN_VOTES, sectionBehavior } from "@ronde/core/util";
import type {
  Action,
  CheckInComment,
  CheckInItem,
  IcebreakerAnswer,
  Interaction,
  Kudo,
  Meeting,
  MeetingParticipant,
  Mood,
  Person,
  Reaction,
  Section,
  Session,
  Topic,
  TopicVote,
} from "@ronde/db";
import { isLocale, resolveLocale } from "@ronde/i18n";
import { readConfig } from "@ronde/module-sdk";
import { github, gitlab, icebreaker, readDraw, video, videoLink } from "@ronde/modules";
import { parseGitlabSecret } from "@/lib/shared/gitlab-grant";
import { env } from "../env";
import { decryptSecret } from "../secrets";

// Database rows → data sent to the browser

/**
 * The GitLab account a meeting is connected with, if any. A secret that cannot be read (the encryption key
 * changed) says nothing here: the meeting still opens, and its GitLab settings say what to do
 */
export function connectedGitlabUser(secret: string | null | undefined): string | null {
  if (!secret) return null;
  try {
    return parseGitlabSecret(decryptSecret(secret)).grant?.user ?? null;
  } catch {
    return null;
  }
}

export const ms = (d: Date | null | undefined) => (d ? d.getTime() : null);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export const numMap = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(obj(v))) if (typeof n === "number") out[k] = n;
  return out;
};

export const toSection = (s: Section): SectionDef => {
  const behavior = (s.behavior ?? {}) as { carryPlans?: boolean };
  return { key: s.key, label: s.label, role: s.role, input: s.input, ...sectionBehavior({ ...s, carryPlans: behavior.carryPlans }) };
};

export function toSettings(
  m: Meeting,
  sections: Section[],
  workspace: { locale: string; slug: string },
  jobCategories: string[],
  mods: Record<string, { enabled: boolean; config: unknown; secret: string }>,
  schedule: ScheduleDTO,
): SettingsDTO {
  const gl = readConfig(gitlab, mods.gitlab?.config);
  const vc = readConfig(video, mods.video?.config);
  // BigBlueButton goes through Ronde, which opens the room and signs each person in
  const joinPath = `${env.appUrl()}/w/${workspace.slug}/m/${m.id}/video`;
  return {
    teamName: m.name,
    icon: m.icon,
    image: null,
    locale: resolveLocale(m.locale, workspace.locale),
    meetingLocale: isLocale(m.locale) ? m.locale : null,
    hostLabel: m.hostLabel,
    videoUrl: mods.video?.enabled ? videoLink(vc, m.videoUrl, joinPath) : "",
    video: { provider: vc.provider, link: m.videoUrl, jitsiUrl: vc.jitsiUrl, bbbUrl: vc.bbbUrl },
    speakSec: m.speakSec,
    autoStart: m.autoStart,
    projectsBy: m.projectsBy === "participants" ? "participants" : "hosts",
    targetMin: m.targetMin,
    announcements: m.announcements,
    reminderEnabled: m.reminderEnabled,
    reminderWhen: m.reminderWhen === "sameDay" ? "sameDay" : "dayBefore",
    reminderTime: m.reminderTime,
    gitlabProjects: gl.projects,
    gitlabGroups: gl.groups,
    githubRepos: readConfig(github, mods.github?.config).repos,
    tokensSet: { gitlab: !!mods.gitlab?.secret, github: !!mods.github?.secret, bbb: !!mods.video?.secret },
    // Read (decrypted) for the people configuring the meeting only: lib/server/meeting/state.ts
    gitlabUser: null,
    jobCategories,
    schedule,
    icebreakers: readConfig(icebreaker, mods.icebreaker?.config).bank,
    sections: sections.map(toSection),
    moodEnabled: !!mods.mood?.enabled,
    sound: parseSound(mods.sounds?.config),
    appearance: appearanceOf(m.appearance),
    agenda: agendaOf(m.agenda),
  };
}

/** Username of the person in another tool ("gitlab", "github"), from the directory */
const handle = (handles: unknown, tool: string): string | null => {
  const v = obj(handles)[tool];
  return typeof v === "string" && v ? v : null;
};

export type ParticipantRow = MeetingParticipant & {
  person: Person & { jobCategory: { name: string } | null; avatar: { updatedAt: Date } | null };
};

/** Participants with their directory profile, in round-table order */
export const participantInclude = {
  person: { include: { jobCategory: { select: { name: true } }, avatar: { select: { updatedAt: true } } } },
} as const;

export const personName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();

export const toMember = (p: ParticipantRow): MemberDTO => ({
  id: p.personId,
  name: personName(p.person),
  email: p.person.email,
  jobCategory: p.person.jobCategory?.name ?? "",
  role: p.role,
  color: p.person.color,
  position: p.position,
  active: p.active,
  remind: p.remind,
  gitlabUsername: handle(p.person.handles, "gitlab"),
  githubUsername: handle(p.person.handles, "github"),
  birthday: p.person.birthday,
  avatarVer: ms(p.person.avatar?.updatedAt),
});

const toSpotlight = (v: unknown): SpotlightDTO | null => {
  const o = obj(v);
  return typeof o.text === "string" ? { label: typeof o.label === "string" ? o.label : "", text: o.text } : null;
};

export const toMeeting = (s: Session): MeetingDTO => ({
  date: s.date,
  time: s.time,
  plannedAt: ms(s.startsAt),
  durationMin: s.durationMin,
  occurrenceKey: s.occurrenceKey,
  assignments: obj(s.assignments) as Partial<Record<RotatingRole, string>>,
  stepKey: s.stepKey,
  order: s.order,
  projectOrder: s.projectOrder,
  projectsAdded: s.projectsAdded,
  absent: s.absent,
  spent: numMap(s.spent),
  bonus: numMap(s.bonus),
  timer: { running: s.timerRunning, startedAt: ms(s.timerStartedAt), baseMs: s.timerBaseMs },
  startedAt: ms(s.startedAt),
  endedAt: ms(s.endedAt),
  icebreaker: s.icebreaker,
  spotlight: toSpotlight(s.spotlight),
  draw: readDraw(s.draw),
});

export const toInteraction = (i: Interaction): InteractionDTO => ({
  id: i.id,
  type: i.type,
  byId: i.byId,
  targetId: i.targetId,
  text: i.text,
  stepKey: i.stepKey,
  resolved: i.resolved,
  createdAt: i.createdAt.getTime(),
});

export const toReaction = (r: Reaction): ReactionDTO => ({
  id: r.id,
  emoji: r.emoji,
  byId: r.byId,
  stepKey: r.stepKey,
  createdAt: r.createdAt.getTime(),
});

export const toTopic = (t: Topic & { votes: TopicVote[] }, viewerId: string | null): TopicDTO => ({
  id: t.id,
  text: t.text,
  byId: t.byId,
  done: t.done,
  createdAt: t.createdAt.getTime(),
  votes: t.votes.length,
  mine: !!viewerId && t.votes.some((v) => v.personId === viewerId),
  parked: t.parked,
});

export const toAnswer = (a: IcebreakerAnswer): AnswerDTO => ({ byId: a.byId, text: a.text, createdAt: a.createdAt.getTime() });

/** A comment, with the check-in field of its item ("done", "x:<key>") and the item text, as screens show them */
export const toComment = (c: CheckInComment & { item: CheckInItem }, sections: SectionDef[]): CommentDTO => ({
  id: c.id,
  ownerId: c.ownerId,
  section: fieldOf(sections, c.item.sectionKey) ?? c.item.sectionKey,
  itemText: c.item.text,
  projectId: c.item.projectId,
  byId: c.byId,
  text: c.text,
  // A reaction from before there were several is a 👍
  emoji: c.text ? "" : c.emoji || "👍",
  createdAt: c.createdAt.getTime(),
});

/** A person who joined an item someone else wrote */
export const toContributor = (
  c: { personId: string; item: { personId: string; sectionKey: string; text: string; projectId: string | null } },
  sections: SectionDef[],
): ContributorDTO => ({
  ownerId: c.item.personId,
  section: fieldOf(sections, c.item.sectionKey) ?? c.item.sectionKey,
  itemText: c.item.text,
  projectId: c.item.projectId,
  personId: c.personId,
});

/** Anonymous answers from 1 to 5 (the mood, the usefulness of the meeting): only the counts, and the viewer's own */
export function toMood(moods: Pick<Mood, "personId" | "value">[], viewerId: string | null): MoodDTO {
  const counts = [0, 0, 0, 0, 0];
  for (const m of moods) if (m.value >= 1 && m.value <= 5) counts[m.value - 1]!++;
  return { counts, total: moods.length, mine: moods.find((m) => m.personId === viewerId)?.value ?? null };
}

/** Usefulness votes: like the mood, but the counts stay hidden until enough people have voted */
export function toRating(ratings: Pick<Mood, "personId" | "value">[], viewerId: string | null): MoodDTO {
  const dto = toMood(ratings, viewerId);
  return dto.total < RATING_MIN_VOTES ? { ...dto, counts: [0, 0, 0, 0, 0] } : dto;
}

export const toKudo = (k: Kudo): KudoDTO => ({ id: k.id, fromId: k.fromId, toId: k.toId, text: k.text, createdAt: k.createdAt.getTime() });

export const toAction = (a: Action): ActionDTO => ({
  id: a.id,
  text: a.text,
  ownerId: a.ownerId,
  status: a.status,
  originDate: a.originDate,
  originText: a.originText,
  projectId: a.projectId,
  createdAt: a.createdAt.getTime(),
  doneAt: ms(a.doneAt),
});
