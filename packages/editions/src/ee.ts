// What the Enterprise code offers the core. The core only reaches it through apps/web/src/ee-bridge.ts;
// a pure Community build (RONDE_PURE_CE=1) swaps it for @ronde/ee-stub, which implements the same contract
// with the Community behaviour. The core checks the license (hasFeature) before calling a paid feature.

import type { ScopedClient, ScopedTx } from "@ronde/db";
import type { Locale } from "@ronde/i18n";

type Db = ScopedClient | ScopedTx;

/** An action to keep in the audit log */
export interface AuditInput {
  /** User who acted; null: the system */
  actorUserId: string | null;
  /** "Name <email>" */
  actorLabel: string;
  action: string;
  targetType?: string;
  targetId?: string | null;
  meetingId?: string | null;
  /** Details; secrets are removed before saving */
  data?: unknown;
}

export interface AuditRow {
  id: string;
  actorUserId: string | null;
  actorLabel: string;
  action: string;
  targetType: string;
  targetId: string | null;
  meetingId: string | null;
  data: unknown;
  /** ISO date */
  createdAt: string;
}

export interface AuditQuery {
  /** Actions starting with this ("meeting." for every meeting action) */
  action?: string;
  /** Part of the actor's name or email */
  actor?: string;
  from?: Date;
  to?: Date;
  /** Page cursor: the id of the last row of the previous page */
  after?: string;
  limit?: number;
}

/** A custom role, as the settings show it */
export interface CustomRoleView {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  /** People holding it */
  members: number;
}

export interface DomainView {
  id: string;
  domain: string;
  /** TXT record to add: name and value */
  record: { name: string; value: string };
  verified: boolean;
  capture: boolean;
  enforceSso: boolean;
}

/** TXT records of a name, as DNS returns them (each record in chunks) */
export type TxtResolver = (name: string) => Promise<string[][]>;

/** What the identity code of the paid editions needs from the core */
export interface IdentityHost {
  /** The license includes the feature (checked at each use) */
  allowed: (feature: "identity.saml" | "identity.ldap" | "identity.scim") => Promise<boolean>;
  /** Someone signed in through a workspace's own provider: they become a member of it if they are not */
  joinWorkspace: (user: { id: string; email: string; name: string }, workspaceId: string) => Promise<void>;
  /** Company directory for an address (its domain verified by a workspace with a directory), secrets decrypted */
  ldapDirectoryFor: (email: string) => Promise<(LdapSettings & { workspaceId: string }) | null>;
}

/** How to reach a company directory */
export interface LdapSettings {
  url: string;
  startTls: boolean;
  bindDn: string;
  bindPassword: string;
  baseDn: string;
  userFilter: string;
  emailAttribute: string;
  nameAttribute: string;
}

/** An identity provider of a workspace, as its settings show it (never its secrets) */
export interface SsoProviderView {
  id: string;
  providerId: string;
  name: string;
  kind: "oidc" | "saml";
  issuer: string;
  domains: string[];
}

/** A new identity provider, as entered in the workspace settings */
export interface SsoProviderInput {
  name: string;
  domains: string[];
  oidc?: { issuer: string; clientId: string; clientSecret: string; discoveryUrl?: string };
  saml?: { entryPoint: string; certificate: string; idpEntityId: string };
}

/** A SCIM request, once its token is checked */
export interface ScimRequest {
  method: string;
  /** Path after /scim/v2/<workspace>: ["Users", "<id>"] */
  path: string[];
  query: URLSearchParams;
  body: unknown;
  /** Absolute address of /scim/v2/<workspace>, for the resources' locations */
  baseUrl: string;
}

export interface ScimResult {
  status: number;
  body?: unknown;
  /** A person was created, changed or removed: kept in the audit log */
  change?: { action: "scim.create" | "scim.update" | "scim.deactivate" | "scim.delete"; personId: string; email: string };
}

/** Figures of one meeting over a period */
export interface MeetingInsight {
  id: string;
  name: string;
  sessions: number;
  /** Present out of expected, 0..1 (null without any session) */
  attendance: number | null;
  /** Sessions within their target duration, 0..1 */
  onTime: number | null;
  /** Planned items reported done at the next session, 0..1 */
  followThrough: number | null;
  /** Questions, raised hands, kudos and icebreaker answers per person and session */
  participation: number | null;
  /** Average mood, 1..5 */
  mood: number | null;
  openActions: number;
  /** 0..100: attendance, follow-through, participation, mood and punctuality together */
  engagement: number | null;
  /** Engagement of each session of the period, oldest first, for a sparkline */
  trend: (number | null)[];
}

export interface InsightsDTO {
  from: string;
  to: string;
  totals: {
    sessions: number;
    meetings: number;
    attendance: number | null;
    onTime: number | null;
    followThrough: number | null;
    mood: number | null;
    actionsCreated: number;
    actionsDone: number;
    /** Median days to close an action closed in the period */
    medianDays: number | null;
    engagement: number | null;
  };
  /** Sessions held per week, oldest first */
  weeks: { week: string; sessions: number; attendance: number | null }[];
  meetings: MeetingInsight[];
  /** The portfolio over the same period, for the scheduled report (Team) */
  portfolio?: PortfolioDTO;
}

export type ProjectHealthValue = "onTrack" | "atRisk" | "offTrack";

/** The portfolio over a period: how each project went, week by week (Team) */
export interface PortfolioDTO {
  from: string;
  to: string;
  /** Mondays of the weeks of the period, oldest first */
  weeks: string[];
  projects: {
    id: string;
    slug: string;
    name: string;
    theme: string;
    status: string;
    health: ProjectHealthValue | null;
    lead: string;
    startDate: string | null;
    targetDate: string | null;
    /** Health given each week (the last sheet of the week); null: none */
    healthByWeek: (ProjectHealthValue | null)[];
    /** Items reported done each week */
    doneByWeek: number[];
    /** Date of the last session that spoke of it */
    lastNews: string | null;
    /** Active, and nothing said about it for three weeks or more */
    quiet: boolean;
    /** Due date passed while it is not done */
    overdue: boolean;
  }[];
}

export interface EnterpriseEdition {
  /** "ee" when the Enterprise code is part of the build, "stub" in a pure Community build */
  kind: "ee" | "stub";
  /** Name of the code shipped; a pure Community build must not contain "Ronde Enterprise Edition" anywhere */
  label: string;
  audit: {
    /** Saves an entry; returns its id (null when not kept) */
    record: (db: Db, workspaceId: string, entry: AuditInput) => Promise<string | null>;
    /** Newest first, a page at a time */
    list: (db: Db, query: AuditQuery) => Promise<{ rows: AuditRow[]; next: string | null }>;
    toCsv: (rows: AuditRow[]) => string;
    /** Sends one entry to a SIEM endpoint, signed like Ronde's webhooks */
    stream: (row: AuditRow, target: { url: string; secret: string; workspace: string }, fetcher?: typeof fetch) => Promise<void>;
  };
  roles: {
    list: (db: Db) => Promise<CustomRoleView[]>;
    /** Creates or updates a role; unknown or owner-only permissions are refused */
    save: (
      db: Db,
      workspaceId: string,
      input: { id?: string; name: string; description: string; permissions: string[] },
    ) => Promise<{ id: string }>;
    remove: (db: Db, id: string) => Promise<void>;
    /** Gives a member a role, or takes it back (null); owners and admins already have every permission */
    assign: (db: Db, personId: string, roleId: string | null) => Promise<void>;
  };
  identity: {
    /** Better Auth plugins of the paid editions; none in a pure Community build */
    authPlugins: (host: IdentityHost) => unknown[];
    /** Body of Better Auth's SSO registration for a workspace's provider; the addresses it must give the provider */
    ssoRegistration: (
      input: SsoProviderInput,
      target: { appUrl: string; providerId: string },
    ) => { body: Record<string, unknown>; endpoints: { callback: string; metadata?: string; entityId?: string } };
    listSso: (db: Db) => Promise<SsoProviderView[]>;
    /** Checks an address and password against a company directory: the person, or null when refused */
    ldapAuthenticate: (settings: LdapSettings, email: string, password: string) => Promise<{ email: string; name: string } | null>;
    /** Checks the service account and the search: how many people the filter finds for a sample address */
    ldapTest: (settings: LdapSettings, sampleEmail: string) => Promise<{ ok: true; found: number } | { ok: false; error: string }>;
    /** Who an SSO sign-in is: a new account, an existing one to link, or refused (address outside the provider's domains) */
    resolveSsoUser: (
      host: IdentityHost,
      providerId: string,
      email: string | undefined,
    ) => Promise<{ action: "continue" } | { action: "link"; userId: string; profile: "preserve" } | { action: "reject"; code: string }>;
  };
  billing: {
    /** A Stripe Checkout page to subscribe a workspace; Stripe creates the customer when there is none */
    checkout: (account: BillingAccess, input: CheckoutInput) => Promise<{ url: string }>;
    /** The Stripe customer portal: invoices, payment method, cancellation */
    portal: (account: BillingAccess, input: { customerId: string; returnUrl: string }) => Promise<{ url: string }>;
    /** Checks the signature of a webhook and reads its event; null when the signature is wrong or too old */
    event: (payload: string, signature: string, secret: string, now?: number) => BillingEvent | null;
    /**
     * Brings the paid seats of a subscription to the people counted, and returns the seats now paid. Monthly,
     * they follow (prorated); yearly, a seat more is charged at once and a seat less waits for the renewal.
     */
    setSeats: (account: BillingAccess, subscriptionId: string, seats: number, now?: number) => Promise<number>;
  };
  transcription: {
    /** Speech to text of a piece of sound: passages timed from its start, in seconds */
    transcribe: (
      account: TranscriptionAccess,
      audio: { data: Uint8Array; type: string },
    ) => Promise<{ start: number; end: number; text: string }[]>;
  };
  calendar: {
    /** Writes a session into the organizer's calendar and invites its attendees; returns the event id */
    upsert: (account: CalendarAccess, event: CalendarEventInput, eventId?: string) => Promise<string>;
    /** Removes an event (cancelled session); an event already gone is fine */
    remove: (account: CalendarAccess, eventId: string) => Promise<void>;
    /** Busy times of people between two instants (ISO), by address */
    busy: (
      account: CalendarAccess,
      emails: string[],
      range: { from: string; to: string },
    ) => Promise<Record<string, { start: string; end: string }[]>>;
    test: (account: CalendarAccess) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
  video: {
    /** Opens a lasting room for a meeting: the same link for every session */
    createRoom: (account: VideoAccess, meeting: { topic: string; timezone: string }) => Promise<{ url: string; id: string }>;
    /** Checks the account: its credentials and the user rooms are created for */
    test: (account: VideoAccess) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
  workflows: {
    /** Whether every condition holds for the figures of the event */
    matches: (conditions: { field: string; op: string; value: number }[], facts: Record<string, number>) => boolean;
    /** Replaces {variables} in a text written by the team */
    render: (template: string, variables: Record<string, string>) => string;
  };
  trackers: {
    /** Opens a ticket from a follow-up action: its key ("ENG-12", "#34") and address */
    create: (tracker: TrackerAccess, issue: TrackerIssue) => Promise<TicketRef>;
    /** Whether the ticket was closed (done or cancelled) in the tracker */
    closed: (tracker: TrackerAccess, ticket: TicketRef) => Promise<boolean>;
    /** Checks the token and the destination */
    test: (tracker: TrackerAccess) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
  wikis: {
    /**
     * Publishes the minutes of a session as a page; given the page of an earlier publication, the new
     * version takes its place (updated in Confluence, replaced in Notion)
     */
    publish: (wiki: WikiAccess, doc: WikiDoc, previous?: WikiPageRef | null) => Promise<WikiPageRef>;
    /** Checks the token and where the pages go */
    test: (wiki: WikiAccess) => Promise<{ ok: true } | { ok: false; code: WikiErrorCode; detail: string }>;
  };
  slack: {
    /** Checks a request from Slack against the app's signing secret (and its age) */
    verify: (body: string, timestamp: string, signature: string, signingSecret: string, now?: number) => boolean;
    /** The page where a Slack workspace adds the app */
    authorizeUrl: (app: SlackApp, redirectUri: string, state: string) => string;
    /** The OAuth code exchanged for the installation */
    exchange: (app: SlackApp, code: string, redirectUri: string, fetcher?: typeof fetch) => Promise<SlackInstall>;
    /** One Web API method with the bot's token */
    call: <T = Record<string, unknown>>(token: string, method: string, body: Record<string, unknown>, fetcher?: typeof fetch) => Promise<T>;
  };
  teams: {
    /**
     * Checks a request of the Bot Connector (Microsoft Teams): a token signed by Microsoft, for this app, from
     * the service the activity names, by a key endorsed for its channel
     */
    verify: (
      authorization: string,
      activity: { serviceUrl?: string; channelId?: string },
      app: TeamsApp,
      fetcher?: typeof fetch,
    ) => Promise<boolean>;
    /** One call to the Bot Connector of a conversation's service, with the app's token; the answer as JSON */
    call: <T = Record<string, unknown>>(
      app: TeamsApp,
      serviceUrl: string,
      path: string,
      init?: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown },
      fetcher?: typeof fetch,
    ) => Promise<T>;
    /** The app package an administrator uploads to Teams: its manifest, translations and icons, zipped */
    appPackage: (app: TeamsApp, options: TeamsPackage) => Uint8Array;
  };
  ai: {
    /** Drafts the summary of a session from its minutes, in the language asked */
    summarize: (input: AiInput, config: AiConfig) => Promise<string>;
    /** Follow-up actions the minutes call for, each with the participant who should own it when one is named */
    suggestActions: (input: AiInput & { people: { id: string; name: string }[] }, config: AiConfig) => Promise<AiAction[]>;
  };
  insights: {
    /** Figures of the workspace's meetings between two dates (YYYY-MM-DD, inclusive) */
    compute: (db: Db, period: { from: string; to: string }) => Promise<InsightsDTO>;
  };
  portfolio: {
    /** The portfolio between two dates (YYYY-MM-DD, inclusive); `readable` limits it to some meetings, `projects` to some projects */
    compute: (
      db: Db,
      period: { from: string; to: string },
      readable?: Set<string> | null,
      projects?: Set<string> | null,
    ) => Promise<PortfolioDTO>;
  };
  reports: {
    /** The report of a period by email, in a language */
    email: (
      data: InsightsDTO,
      options: { locale: Locale; workspace: string; url: string /** The workspace logo, absolute (Team) */; logo?: string },
    ) => { subject: string; text: string; html: string };
    /**
     * Whether a report is due at this local time, and for which period: weekly on Monday from 8:00 (the week
     * before), monthly on the 1st from 8:00 (the month before). The key names the period, so it goes out once.
     */
    due: (frequency: "weekly" | "monthly", local: { date: string; minutes: number }) => { key: string; from: string; to: string } | null;
  };
  scim: {
    handle: (db: Db, workspaceId: string, req: ScimRequest) => Promise<ScimResult>;
  };
  domains: {
    list: (db: Db) => Promise<DomainView[]>;
    add: (db: Db, workspaceId: string, domain: string) => Promise<DomainView>;
    /** Looks for the TXT record; true once found (the domain is then verified) */
    verify: (db: Db, id: string, resolve?: TxtResolver) => Promise<boolean>;
    update: (db: Db, id: string, patch: { capture?: boolean; enforceSso?: boolean }) => Promise<void>;
    remove: (db: Db, id: string) => Promise<void>;
  };
}

/** What the assistant reads: the minutes of a session, as Markdown */
export interface AiInput {
  meeting: string;
  minutes: string;
  locale: Locale;
  /** What was said, turn by turn, when the session was transcribed */
  transcript?: string;
}

/** The provider account of the workspace (or of the instance) */
export interface AiConfig {
  apiKey: string;
  model: string;
  /** Replaced in tests */
  fetch?: typeof fetch;
}

export interface AiAction {
  text: string;
  ownerId: string | null;
}

export type TrackerKind = "jira" | "linear" | "gitlab" | "github";

/** An issue tracker of the workspace, with its decrypted token */
export interface TrackerAccess {
  kind: TrackerKind;
  /** { site, project, email } (Jira), { team } (Linear), { url, project } (GitLab), { repo } (GitHub) */
  config: Record<string, string>;
  token: string;
  /** Replaced in tests */
  fetch?: typeof fetch;
}

export interface TrackerIssue {
  title: string;
  /** Markdown: where the action comes from */
  body: string;
  /** Usernames of the owner in the tracker, when the directory knows them */
  assignee?: { gitlab?: string; github?: string };
}

export interface TicketRef {
  key: string;
  url: string;
  /** Internal id the API needs (Linear) */
  id?: string;
}

export type WikiKind = "notion" | "confluence";

/** A wiki of the workspace, with its decrypted token */
export interface WikiAccess {
  kind: WikiKind;
  /** { parent } (Notion); { site, space, parent, email } (Confluence; email for Confluence Cloud only) */
  config: Record<string, string>;
  token: string;
  /** Replaced in tests */
  fetch?: typeof fetch;
}

/** A page to publish: its title and its body, the Markdown of the minutes (its own "# title" line left out) */
export interface WikiDoc {
  title: string;
  markdown: string;
  /** The way back to the meeting in Ronde, at the bottom of the page */
  link?: { label: string; url: string };
}

/**
 * Why a wiki refused, for the person to fix it (publish throws an error carrying it as `code`): the token,
 * the Notion parent page (not shared with the integration, or not a page address), the Confluence space or
 * page, an unexpected answer (its status in `detail`), or no answer at all
 */
export type WikiErrorCode = "token" | "notionPage" | "notionParent" | "confluenceSpace" | "answer" | "network";

export interface WikiPageRef {
  id: string;
  url: string;
}

export type VideoKind = "zoom" | "meet" | "teams";

/** A video account of the workspace, with its decrypted secret */
export interface VideoAccess {
  kind: VideoKind;
  config: Record<string, string>;
  secret: string;
  /** Replaced in tests */
  fetch?: typeof fetch;
}

export type CalendarKind = "google" | "microsoft";

/** A calendar account of the workspace, with its decrypted secret */
export interface CalendarAccess {
  kind: CalendarKind;
  /** { clientEmail, organizer } (Google), { tenant, clientId, organizer } (Microsoft) */
  config: Record<string, string>;
  secret: string;
  fetch?: typeof fetch;
}

export interface CalendarEventInput {
  title: string;
  description: string;
  /** Instants, ISO */
  start: string;
  end: string;
  attendees: string[];
  /** The video link, when the meeting has one */
  location: string;
}

/** A speech-to-text service with the OpenAI transcription API (OpenAI, or a self-hosted Whisper) */
export interface TranscriptionAccess {
  /** https://api.openai.com/v1, or the address of a self-hosted server */
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Spoken language ("fr", "en"), empty to detect it */
  language: string;
  fetch?: typeof fetch;
}

/** The Stripe account of the Ronde cloud */
/** The Slack app of the instance (its credentials at api.slack.com) */
/** The instance's Teams app: its Microsoft Entra registration (the bot), and the tenant it lives in */
export interface TeamsApp {
  appId: string;
  password: string;
  /** Home tenant of a single-tenant bot; empty for a bot registered before multi-tenant bots were retired */
  tenantId: string;
}

/** What the Teams app package says about Ronde, per language */
export interface TeamsPackage {
  /** The host the app opens links to (app.joinronde.com) */
  domain: string;
  version: string;
  developer: { name: string; websiteUrl: string; privacyUrl: string; termsOfUseUrl: string };
  accentColor: string;
  /** English first: the manifest's own texts; the others become its translations */
  texts: {
    locale: string;
    shortName: string;
    fullName: string;
    shortDescription: string;
    fullDescription: string;
    commands: { title: string; description: string }[];
  }[];
  /** color.png (192 px) and outline.png (32 px, white on transparent) */
  icons: { color: Uint8Array; outline: Uint8Array };
}

export interface SlackApp {
  clientId: string;
  clientSecret: string;
}

/** What "Add to Slack" gives a workspace */
export interface SlackInstall {
  teamId: string;
  teamName: string;
  /** xoxb- token of the bot */
  botToken: string;
  botUserId: string;
  /** Incoming webhook of the channel picked during the installation (notifications) */
  webhookUrl: string;
  channel: string;
}

export interface BillingAccess {
  secretKey: string;
  fetch?: typeof fetch;
}

export interface CheckoutInput {
  workspaceId: string;
  priceId: string;
  seats: number;
  email: string;
  customerId?: string;
  successUrl: string;
  cancelUrl: string;
}

/** What a webhook says about a workspace's subscription */
export type BillingEvent = {
  id: string;
  type: string;
  /** The workspace, when Ronde put it on the object (checkout and subscription metadata) */
  workspaceId: string | null;
  customerId: string | null;
  subscription: {
    id: string;
    status: string;
    seats: number;
    priceId: string | null;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  /** A paid invoice (invoice.paid): what was paid, in the currency's main unit */
  payment: { amount: number; currency: string } | null;
};
