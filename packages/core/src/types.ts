// Types exchanged between the server and the browser.

import type { Locale } from "@ronde/i18n";
import type { AgendaBlock, BlockData, RetroPhase } from "./agenda";
import type { Appearance } from "./appearance";
import type { NotifyEvent } from "./notify";
import type { RecordV1 } from "./record";
import type { Occurrence, ScheduleException, ScheduleRule } from "./schedule";
import type { SoundSettings } from "./sound";
import type { ReminderWhen } from "./util";

/** Job category, picked among the ones defined in the settings */
export type JobCategory = string;
export type ActionStatus = "open" | "doing" | "done";
export type InteractionType = "hand" | "question";
export type SectionKey = "done" | "next" | "blockers" | "other";
/** Input of a section: list of items, checklist, or free text */
export type SectionType = "list" | "checklist" | "text";
/** What a section is for: sets its behaviour on screen, in reminders, minutes and stats */
export type SectionRole = "achievement" | "plan" | "blocker" | "note" | "custom";

/** A check-in section as configured for a meeting */
export interface SectionDef {
  /** Stable key in check-ins and records */
  key: string;
  /** Empty: the translated default of the role */
  label: string;
  role: SectionRole;
  input: SectionType;
  /** Achievement section in checklist form: what each person planned last time comes back in it, as boxes to tick */
  carryPlans?: boolean;
}

export interface MemberDTO {
  /** Person id (directory profile) */
  id: string;
  name: string;
  email: string;
  jobCategory: JobCategory;
  /** Role in the meeting */
  role: "host" | "cohost" | "participant" | "observer";
  color: number;
  position: number;
  active: boolean;
  remind: boolean;
  gitlabUsername: string | null;
  githubUsername: string | null;
  /** Birthday "MM-DD" (no year), null when not celebrated */
  birthday: string | null;
  /** Photo version (update time), null without a photo */
  avatarVer: number | null;
}

/** Items of a check-in, per kind of section */
export interface CheckInFields {
  done: string[];
  next: string[];
  blockers: string[];
  other: string[];
  /** Custom sections added by the team */
  extra: Record<string, string[]>;
}

export interface CheckInDTO extends CheckInFields {
  /** Items written in the tab of a project, per project id */
  byProject: Record<string, CheckInFields>;
  updatedAt: number | null;
}

export type ProjectStatus = "proposed" | "active" | "paused" | "done" | "cancelled";
export type ProjectHealth = "onTrack" | "atRisk" | "offTrack";
export const PROJECT_STATUSES: readonly ProjectStatus[] = ["proposed", "active", "paused", "done", "cancelled"];
export const PROJECT_HEALTHS: readonly ProjectHealth[] = ["onTrack", "atRisk", "offTrack"];

/** The shared sheet of a project for the coming session */
export interface ProjectSheetDTO {
  health: ProjectHealth | null;
  /** Markdown */
  headline: string;
  updatedById: string | null;
  updatedAt: number | null;
  /** Who wrote the message of the day (the last change may be someone else's health, set live) */
  headlineById: string | null;
  /** Who is writing it right now (it is theirs until they save or leave), and until when without news from them */
  editingById: string | null;
  editingUntil: number | null;
}

/** A project followed by the meeting, with its sheet for the coming session */
export interface ProjectDTO {
  id: string;
  slug: string;
  name: string;
  summary: string;
  theme: { id: string; name: string; color: number; position: number } | null;
  status: ProjectStatus;
  /** Last health known (the sheet's, once given) */
  health: ProjectHealth | null;
  leadId: string | null;
  /** People of the directory working on it */
  memberIds: string[];
  targetDate: string | null;
  color: number;
  /** Repositories linked to it, by forge: full paths ("group/repo") */
  repos: { gitlab: string[]; github: string[] };
  /** Imported from a tool counting its issues: how far along it is, from 0 to 1 */
  progress?: number | null;
  /** Version of its logo (null or missing: none) */
  logo?: number | null;
  /** Order in the meeting */
  position: number;
  sheet: ProjectSheetDTO | null;
}

export interface TimerDTO {
  running: boolean;
  startedAt: number | null;
  baseMs: number;
}

export type DrawKind = "wheel" | "order" | "teams" | "coin";

/** A random draw: the server picks the seed and the outcome, every screen replays the same animation */
export interface DrawDTO {
  id: string;
  kind: DrawKind;
  seed: string;
  /** When it was drawn (ms): screens that open later show the outcome without the animation */
  at: number;
  /** Person ids on the wheel, in the order or in the teams */
  entries: string[];
  pick: string | null;
  tails: boolean | null;
  order: string[];
  teams: string[][];
  /** The pick or the order was applied to the speaking order */
  applied: boolean;
}

export interface SpotlightDTO {
  label: string;
  text: string;
}

/** Recurrence of a meeting, with its next dates */
export interface ScheduleDTO {
  timeZone: string;
  /** Time zone set on the meeting itself; null: it follows the workspace */
  meetingTimeZone: string | null;
  rules: ScheduleRule[];
  exceptions: ScheduleException[];
  /** Next occurrences (cancelled ones included, flagged), from today */
  upcoming: Occurrence[];
  /** Plain-words summary, in the viewer's language */
  summary: string;
  /** Upcoming occurrences too close to another meeting of the same people (margin of the workspace included) */
  conflicts: Record<string, { meeting: string; names: string[] }[]>;
  /** Public holidays that skip its sessions */
  holidays: {
    /** The meeting's own choice: null follows the workspace, "none" skips none, or a country / region code */
    value: string | null;
    /** The workspace's choice (code), or null */
    workspace: string | null;
    /** Countries with a calendar (ISO codes) */
    countries: string[];
    /** Regions of the country in use, when its holidays differ by region: code → name */
    regions: Record<string, string>;
  };
}

/** Roles that rotate from one session to the next */
export type RotatingRole = "facilitator" | "noteTaker";

export interface MeetingDTO {
  date: string;
  /** Planned local time "HH:MM", start instant (ms) and duration */
  time: string;
  plannedAt: number | null;
  durationMin: number;
  /** Occurrence of the schedule this session comes from */
  occurrenceKey: string | null;
  /** Who holds each rotating role this session */
  assignments: Partial<Record<RotatingRole, string>>;
  stepKey: string;
  order: string[];
  /** Order of the project round chosen by the host (empty: the agenda block's) */
  projectOrder: string[];
  /** Projects the host presents this session although nothing is written about them */
  projectsAdded: string[];
  absent: string[];
  spent: Record<string, number>;
  bonus: Record<string, number>;
  timer: TimerDTO;
  startedAt: number | null;
  endedAt: number | null;
  icebreaker: string | null;
  spotlight: SpotlightDTO | null;
  draw: DrawDTO | null;
}

export interface InteractionDTO {
  id: string;
  type: InteractionType;
  byId: string;
  targetId: string | null;
  text: string;
  stepKey: string;
  resolved: boolean;
  createdAt: number;
}

export interface ReactionDTO {
  id: string;
  emoji: string;
  byId: string | null;
  stepKey: string;
  createdAt: number;
}

export interface TopicDTO {
  id: string;
  text: string;
  byId: string | null;
  done: boolean;
  createdAt: number;
  votes: number;
  /** The viewer voted for this topic */
  mine: boolean;
  /** Set aside in the parking lot (an open topic of the next session) */
  parked: boolean;
}

/** An entry of the decision log */
export interface DecisionDTO {
  /** Date of the session */
  date: string;
  text: string;
  /** Where it was taken: "(Alice Martin)", "(Open topics)" */
  context: string;
}

export interface AnswerDTO {
  byId: string;
  text: string;
  createdAt: number;
}

export interface KudoDTO {
  id: string;
  fromId: string;
  toId: string;
  text: string;
  createdAt: number;
}

export interface ActionDTO {
  id: string;
  text: string;
  ownerId: string;
  status: ActionStatus;
  /** Where it stands, in its owner's words, and when that was written */
  progress: string | null;
  progressAt: number | null;
  originDate: string | null;
  originText: string | null;
  projectId: string | null;
  createdAt: number;
  doneAt: number | null;
}

/** Who adds projects for a meeting to follow: whoever configures it, or everyone taking part */
export const PROJECTS_BY = ["hosts", "participants"] as const;
export type ProjectsBy = (typeof PROJECTS_BY)[number];

export interface SettingsDTO {
  teamName: string;
  /** Emoji of the meeting in the menus (empty: its initials), and the version of its own image (null: none) */
  icon: string;
  image: number | null;
  /** Language of the meeting: emails, notifications and generated minutes */
  locale: Locale;
  /** Language set on the meeting itself; null: it follows the workspace */
  meetingLocale: Locale | null;
  /** Name shown for the person running the meeting (empty: the translated default, "Host") */
  hostLabel: string;
  /** Link to join the video call (free link, Jitsi room or Ronde's BigBlueButton entry); empty: none */
  videoUrl: string;
  /** Video call settings, for the settings page */
  /** `bbbAccount`: a BigBlueButton server of the workspace; empty, the meeting's own (`bbbUrl`) */
  video: { provider: "link" | "jitsi" | "bbb"; link: string; jitsiUrl: string; bbbAccount: string; bbbUrl: string };
  speakSec: number;
  autoStart: boolean;
  /** Who adds projects for the meeting to follow: its hosts, or every participant */
  projectsBy: ProjectsBy;
  targetMin: number;
  announcements: string[];
  reminderEnabled: boolean;
  /** Working day before the meeting, or the same day before the meeting */
  reminderWhen: ReminderWhen;
  reminderTime: string;
  /** GitLab and GitHub connections the meeting may use, and those it uses (empty for non-hosts) */
  forges: ForgeSettings;
  /** Tokens set in the settings (the value is never sent; always false for non-hosts) */
  tokensSet: { bbb: boolean };
  /** Job categories of the workspace */
  jobCategories: string[];
  /** Recurrence of the meeting */
  schedule: ScheduleDTO;
  icebreakers: string[];
  /** Check-in sections, in order */
  sections: SectionDef[];
  moodEnabled: boolean;
  /** Meeting sounds, set from the control room */
  sound: SoundSettings;
  appearance: Appearance;
  /** Blocks of the agenda (core ones and modules') */
  agenda: AgendaBlock[];
}

/** A check-in section, built-in or added by the team */
export interface Section {
  /** "done", "next", "blockers", "other", or "x:<key>" for a custom section */
  k: string;
  label: string;
  kind: SectionKey | "extra";
  type?: SectionType;
  /** Last time's plans come back in it (see `SectionDef.carryPlans`) */
  carryPlans?: boolean;
}

export interface CommentDTO {
  id: string;
  ownerId: string;
  section: string;
  itemText: string;
  /** Project tab of the item; null: the person's own */
  projectId: string | null;
  byId: string;
  /** Empty for a reaction */
  text: string;
  /** A reaction's emoji (one of LINE_REACTIONS); empty for a comment */
  emoji: string;
  createdAt: number;
}

/** The reactions offered on a line of a check-in */
export const LINE_REACTIONS = ["👍", "🎉", "❤️", "💡", "👀"] as const;

/** A person who took part in an item someone else wrote: their face shows on it too */
export interface ContributorDTO {
  ownerId: string;
  section: string;
  itemText: string;
  /** Project tab of the item; null: the owner's own */
  projectId: string | null;
  personId: string;
}

/** Anonymous answers on a 1 to 5 scale: the team mood, the usefulness of the meeting */
export interface MoodDTO {
  /** Number of answers per mood, from 1 (stormy) to 5 (sunny) */
  counts: number[];
  total: number;
  /** Mood picked by the viewer */
  mine: number | null;
}

export interface Viewer {
  userId: string;
  /** Directory profile of the viewer in the workspace */
  personId: string;
  email: string;
  name: string;
  /** Participant id when the viewer takes part in the meeting (has a check-in), otherwise null */
  memberId: string | null;
  /** Runs sessions: control room, stats, history (hosts and co-hosts, workspace admins) */
  isHost: boolean;
  /** Configures the meeting: settings, people and roles, integrations (hosts, workspace admins) */
  isAdmin: boolean;
}

/** Where the meeting lives: used to build links and API calls */
export interface MeetingContext {
  workspace: { slug: string; name: string };
  meetingId: string;
  /** App path of the meeting, e.g. /w/acme/m/<id> */
  path: string;
  /** API path of the meeting, base path included, e.g. /ronde/api/w/acme/m/<id> */
  api: string;
  /** API path of the workspace (people photos), base path included */
  workspaceApi: string;
  /** The sample meeting, with a fictitious team: a banner says so and offers to delete it */
  sample?: boolean;
}

export interface Snapshot {
  serverNow: number;
  context: MeetingContext;
  viewer: Viewer;
  settings: SettingsDTO;
  /** Participants who take part (hosts included), in round-table order */
  members: MemberDTO[];
  /** Observers: follow the sessions without a check-in */
  observers: MemberDTO[];
  meeting: MeetingDTO | null;
  checkIns: Record<string, CheckInDTO>;
  /** Projects the meeting follows, in its order, with their sheets */
  projects: ProjectDTO[];
  /** Projects of the workspace the meeting could follow, for the people configuring it (null otherwise) */
  projectChoices: { id: string; name: string; theme: string; status: ProjectStatus; color: number }[] | null;
  /** Host notes of the current meeting, per step */
  notes: Record<string, string>;
  interactions: InteractionDTO[];
  reactions: ReactionDTO[];
  topics: TopicDTO[];
  /** Parking lot: subjects set aside (empty when the module is off: they are then plain topics) */
  parking: TopicDTO[];
  /** Icebreaker answers of the current meeting */
  answers: AnswerDTO[];
  kudos: KudoDTO[];
  mood: MoodDTO;
  /** How useful the meeting was, rated at its wrap-up (empty when the module is off) */
  rating: MoodDTO;
  comments: CommentDTO[];
  /** People who joined an item someone else wrote (current check-ins) */
  contributors: ContributorDTO[];
  actions: ActionDTO[];
  /** What each person planned at the last archived meeting (`byProject`: the items written in a project's tab, also in `next`) */
  lastWeek: Record<string, { date: string; next: string[]; byProject?: Record<string, string[]> }>;
  /** When the last meeting was archived: a check-in filled in earlier was kept during an absence */
  lastArchivedAt: number | null;
  /**
   * Integrations: only whether they are configured is sent, never a secret value.
   * `secrets`: an encryption key is configured, so tokens can be saved.
   */
  /** inbound: replies to reminders fill check-ins (INBOUND_IMAP_URL) */
  /** `gitlabOAuth`: the server has a GitLab OAuth application ("Connect with GitLab") */
  /** `ownVideoServer`: the viewer may set a BigBlueButton server of the meeting's own (an administrator of the workspace) */
  integrations: {
    gitlab: boolean;
    gitlabOAuth: boolean;
    github: boolean;
    smtp: boolean;
    secrets: boolean;
    inbound: boolean;
    ownVideoServer: boolean;
  };
  /** What module blocks of the agenda expand from (retro groups and their votes…) */
  blockData: BlockData;
  /** The retrospective of the session, as this viewer sees it (null without a retro block) */
  retro: RetroDTO | null;
  /** Planning poker of the session (null without a poker block) */
  poker: PokerDTO | null;
  /** Polls of the session (empty when the module is off) */
  polls: PollDTO[];
  /** Notification rules in force: the control room offers a nudge and says when the start is announced */
  notify: { nudge: boolean; started: boolean };
  /** Connectors of the workspace and rules of the meeting, for the people configuring it (null otherwise) */
  notifications: NotificationsDTO | null;
  /** Viewer preferences (block layouts…) */
  prefs: Record<string, unknown>;
  /** Attendance answers for the upcoming occurrences: { occurrenceKey: { personId: "yes" | "no" } } */
  attendance: Record<string, Record<string, "yes" | "no">>;
  /** Modules turned on for this meeting, by id ("kudos", "mood"…) */
  modules: Record<string, boolean>;
  /** Page presenting the paid plans, when they may be mentioned to this viewer (admins, in the settings only) */
  upgradeHints: string | null;
  /** The workspace logo (path of the image) in place of Ronde's, and whether the license allows one */
  brand: { logo: string | null; allowed: boolean };
  /** The AI assistant can help this viewer with the minutes (Team, set up, allowed to edit them) */
  ai: boolean;
  /** Edition the instance can use: paid modules it already has are not announced */
  edition: "community" | "team" | "enterprise";
  /**
   * Video accounts of the workspace, for the people configuring the meeting: those that create rooms (Team), and
   * the BigBlueButton servers (every edition)
   */
  videoAccounts: { id: string; name: string; kind: "zoom" | "meet" | "teams" | "bbb" }[];
  /** Where the meeting's access to each tool comes from, as its integration cards say */
  origins: IntegrationOrigins;
  /** Calendar sync of the meeting, for the people configuring it (Team): the accounts, the one in use */
  calendars: { accounts: { id: string; name: string; kind: "google" | "microsoft" | "caldav" }[]; current: string | null } | null;
  /**
   * Where the minutes are published (Team; null without the plan, or for people who neither configure the
   * meeting nor edit its minutes): the wikis of the workspace (for those who configure it), the one in use
   */
  wikis: { list: WikiChoice[]; current: WikiChoice | null } | null;
  /** Transcript of the sessions (Team; null without the plan): allowed for this meeting, set up, recording now, the viewer's turn left out */
  transcription: { allowed: boolean; ready: boolean; recording: { since: number; by: string } | null; optedOut: boolean } | null;
  /** Network helpers of screen sharing between tabs (STUN, TURN) */
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
}

/** Past check-in of a person, taken from an archived meeting */
export interface PastCheckIn {
  date: string;
  checkIn: RecordCheckIn;
  sections: Section[];
  /** Speaking time, in ms */
  spent: number;
  /** Projects of the tabs it has */
  projects: { id: string; name: string }[];
}

export interface RecordCheckIn {
  done: string[];
  next: string[];
  blockers: string[];
  other: string[];
  extra?: Record<string, string[]>;
  /** Items written in the tab of a project, per project id */
  byProject?: Record<string, Omit<RecordCheckIn, "byProject">>;
}

/** Snapshot of an archived meeting (current format of the record) */
export type { RecordV1 as MeetingRecord } from "./record";

export interface HistoryItem {
  date: string;
  record: RecordV1;
  /** Summary written by the host on top of the generated minutes (Markdown) */
  summary: string | null;
  archivedAt: number | null;
  /** Its page in the meeting's wiki (Team): where, or why the last publication failed */
  wiki?: { url: string; error: string; publishedAt: number } | null;
}

/** A wiki of the workspace where minutes can be published (Team) */
export interface WikiChoice {
  id: string;
  name: string;
  kind: "notion" | "confluence";
}

export interface ForgeItem {
  id: string;
  ref: string;
  title: string;
  project: string;
  /** Full path of the repository ("group/sub/repo", "owner/repo") */
  path: string;
  state: "opened" | "merged" | "closed";
  assignee: string | null;
  updatedAt: number;
  url: string;
}

/** A connection to a code forge as the settings show it, never its secret */
export interface ForgeConnectionView {
  id: string;
  kind: "gitlab" | "github";
  name: string;
  /** The server */
  url: string;
  /** The forge account it reads as, when known */
  account: string;
  /** "workspace": any meeting may use it; "meeting": this meeting's own; "instance": the server's variables */
  scope: "workspace" | "meeting" | "instance";
  /** Connected with OAuth, renewed by itself, rather than with a personal token */
  oauth: boolean;
}

/** Where a meeting's access to a tool comes from: inherited from the workspace (its hosts picked nothing), the
 * workspace's, the meeting's own, the server's */
export type IntegrationOrigin = "inherited" | "workspace" | "meeting" | "instance";

export interface IntegrationOrigins {
  /** Each origin of the connections used, once */
  gitlab: IntegrationOrigin[];
  github: IntegrationOrigin[];
  /** The account of the workspace it comes from (a BigBlueButton server, a Zoom account that made the room), named */
  video: { origin: IntegrationOrigin; name: string };
}

/** A GitLab connection a meeting uses: the groups whose projects it offers, the projects followed (empty: all) */
export interface GitlabSource {
  connection: string;
  groups: string;
  projects: string;
}

/** A GitHub connection a meeting uses: the followed repositories, "owner/repo" or "owner" (empty: all) */
export interface GithubSource {
  connection: string;
  repos: string;
}

/**
 * The forge connections a meeting may use and those it uses. Until its hosts pick them (`picked`), a meeting
 * uses the workspace's connections, otherwise the instance's.
 */
export interface ForgeSettings {
  connections: ForgeConnectionView[];
  /** The servers a connection reaches when none is typed (GITLAB_URL, GITHUB_API_URL) */
  servers: { gitlab: string; github: string };
  gitlab: { picked: boolean; sources: GitlabSource[] };
  github: { picked: boolean; sources: GithubSource[] };
}

/** Project offered in the settings ("Followed GitLab projects") */
export interface GitlabProject {
  /** Full path, e.g. my-group/my-subgroup/my-project */
  path: string;
  name: string;
  /** Settings group where the project was found */
  group: string;
}

/** A connector of the workspace, as a meeting's notification rules pick it (no settings, no secret) */
export interface NotifyConnectorDTO {
  id: string;
  kind: "email" | "matrix" | "slack" | "teams" | "discord" | "mattermost" | "webhook" | "sms" | "whatsapp";
  name: string;
}

/** "When this happens, send through this connector, there" */
export interface NotifyRuleDTO {
  id: string;
  connectorId: string;
  event: NotifyEvent;
  /** { room } for Matrix, { audience: "participants" | "hosts" } for email, {} otherwise */
  target: Record<string, string>;
  /** { minutesBefore } for session.soon, { days } for action.overdue */
  options: Record<string, number>;
  /** Workflows (Team): conditions that must hold, and the team's own message */
  conditions: import("./workflows").WorkflowCondition[];
  message: import("./workflows").WorkflowMessage | null;
  enabled: boolean;
}

export interface NotificationsDTO {
  connectors: NotifyConnectorDTO[];
  rules: NotifyRuleDTO[];
  /** The viewer manages the workspace connectors (otherwise they ask an admin) */
  canManageConnectors: boolean;
  /** Recent sends of the meeting, newest first */
  deliveries: {
    id: string;
    event: string;
    connectorId: string;
    status: "pending" | "sent" | "failed" | "skipped";
    error: string | null;
    at: number;
  }[];
}

/** A retrospective, as one viewer sees it: authors never leave the server */
export interface RetroDTO {
  blockId: string;
  /** Phase of the current step; null outside the retro */
  phase: RetroPhase | null;
  columns: { key: string; label: string; color: number }[];
  votesPerPerson: number;
  /** While writing, only the viewer's own notes; every note after the reveal */
  cards: { id: string; column: string; groupId: string | null; text: string; mine: boolean }[];
  /** Notes per column, everyone's */
  counts: Record<string, number>;
  /** People who wrote at least one note */
  writers: number;
  groups: { id: string; column: string; title: string; position: number; votes: number; mine: boolean }[];
  myVotesLeft: number;
  /** People who voted at least once */
  voters: number;
}

/** Planning poker: cards stay hidden until the host reveals them */
export interface PokerDTO {
  /** The session is on the poker step */
  live: boolean;
  deck: string[];
  items: {
    id: string;
    title: string;
    position: number;
    revealed: boolean;
    final: string | null;
    /** People who picked a card */
    voted: number;
    /** Everyone's card, once revealed */
    votes: { personId: string; value: string }[];
    myVote: string | null;
  }[];
}

/** A poll and its results (totals; names only for a poll that is not anonymous) */
export interface PollDTO {
  id: string;
  question: string;
  kind: "single" | "multiple" | "scale" | "words";
  options: string[];
  anonymous: boolean;
  /** A quick yes or no: results in green and red */
  yesNo: boolean;
  open: boolean;
  /** Shown on the shared screen */
  shown: boolean;
  answers: number;
  /** Per answer: how many, and who (names and ids, empty when anonymous) */
  results: { value: string; count: number; people: string[]; ids: string[] }[];
  /** Who answered (empty when anonymous) */
  respondents?: string[];
  mine: string[] | null;
}
