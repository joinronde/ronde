import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { TEAMS_BOT_SECRET } from "@ronde/connectors";
import type { SectionDef, SectionType } from "@ronde/core/types";
import { checkInFromItems, isCheckInReady, itemsFromCheckIn, plainItem, resolveSections } from "@ronde/core/util";
import { prisma, type ScopedClient, scoped } from "@ronde/db";
import type { TeamsApp } from "@ronde/editions/ee";
import { formatters, type Locale, locales, resolveLocale, translator } from "@ronde/i18n";
import { enterprise } from "@/ee-bridge";
import { audit } from "./audit";
import type { TeamsSettings, WorkspaceContext, WorkspaceSettings } from "./authz";
import { publish } from "./bus";
import { env } from "./env";
import { AccessError, OpError } from "./errors";
import { featureOn, type PlanScope } from "./license";
import { loadCheckIns, saveCheckIn } from "./meeting/checkins";
import { toSection } from "./meeting/dto";
import { sectionsOf } from "./meeting/state";
import { publicUrl } from "./public-url";
import { canEncrypt, encryptSecret } from "./secrets";
import { TEAMS_ICONS } from "./teams-icons";

// The Microsoft Teams app (Team). An administrator uploads Ronde's app package to Teams and adds it to a team;
// in its channel, the bot offers to link the team to a Ronde workspace. Then:
// - check-in reminders arrive as personal messages, with a button turning the message into the check-in's form;
// - the channel becomes a connector, for the meetings' notification rules (minutes published, session soon…);
// - writing to the bot ("ronde") lists the person's next sessions and open follow-up actions.
// People are matched by their email: their Microsoft account and their Ronde profile share it.

/** The instance's Teams app, once its registration is configured */
export function teamsApp(): TeamsApp | null {
  const appId = env.teamsAppId();
  const password = env.teamsAppPassword();
  return appId && password ? { appId, password, tenantId: env.teamsTenantId() } : null;
}

export const teamsOn = (ws: PlanScope) => featureOn("integrations.teams", ws);

/** An activity of the Bot Framework, as far as Ronde reads it */
export interface Activity {
  type?: string;
  id?: string;
  name?: string;
  text?: string;
  serviceUrl?: string;
  channelId?: string;
  locale?: string;
  action?: string;
  from?: { id?: string; name?: string; aadObjectId?: string };
  recipient?: { id?: string; name?: string };
  conversation?: { id?: string; conversationType?: string; tenantId?: string };
  membersAdded?: { id?: string }[];
  channelData?: { tenant?: { id?: string }; team?: { id?: string; name?: string }; channel?: { id?: string; name?: string } };
  value?: { action?: { verb?: string; data?: Record<string, unknown> } } & Record<string, unknown>;
}

/** The answer to an invoke: the card that takes the place of the one clicked */
export type InvokeAnswer = { statusCode: number; type: string; value: object };

/** Checks that a request comes from Microsoft for the instance's app */
export async function fromTeams(authorization: string, activity: Activity): Promise<boolean> {
  const app = teamsApp();
  return !!app && enterprise.teams.verify(authorization, activity, app);
}

const CARD = "application/vnd.microsoft.card.adaptive";
const VERB_OPEN = "ronde.checkin";
const VERB_SAVE = "ronde.save";
/** The same limits as the check-in page */
const ITEMS_MAX = 50;
const ITEM_MAX = 2000;
const INPUT_MAX = 5000;

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const tenantOf = (a: Activity) => a.conversation?.tenantId ?? a.channelData?.tenant?.id ?? "";
const text = (t: string, more: Record<string, unknown> = {}) => ({ type: "TextBlock", text: t, wrap: true, ...more });
const card = (body: object[], actions: object[] = []) => ({
  $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
  type: "AdaptiveCard",
  version: "1.4",
  body,
  ...(actions.length ? { actions } : {}),
});
const message = (c: object, summary = "") => ({
  type: "message",
  ...(summary ? { summary } : {}),
  attachments: [{ contentType: CARD, content: c }],
});
const answer = (c: object): InvokeAnswer => ({ statusCode: 200, type: CARD, value: c });
const bullets = (items: string[], max = 10) =>
  [...items.slice(0, max).map((i) => `- ${cut(i, 300)}`), ...(items.length > max ? ["…"] : [])].join("\r");

async function callTeams<T = Record<string, unknown>>(
  serviceUrl: string,
  path: string,
  init?: Parameters<typeof enterprise.teams.call>[3],
) {
  const app = teamsApp();
  if (!app) throw new OpError("teamsNotConfigured");
  return enterprise.teams.call<T>(app, serviceUrl, path, init);
}

/** Posts a message in a conversation (a channel, a personal chat) */
export async function postToTeams(ref: { serviceUrl: string; conversationId: string }, activity: object): Promise<void> {
  await callTeams(ref.serviceUrl, `/v3/conversations/${encodeURIComponent(ref.conversationId)}/activities`, { body: activity });
}

// ---------- Linking a team ----------

/** What the "Link to Ronde" card carries, signed: the team and its channel, until a week later */
interface LinkRef {
  tenantId: string;
  serviceUrl: string;
  teamId: string;
  teamName: string;
  channelId: string;
  channelName: string;
  until: number;
}

const LINK_TTL_MS = 7 * 24 * 3600_000;
const linkMac = (payload: string) => createHmac("sha256", env.authSecret()).update(`teams-link:${payload}`).digest("base64url");

export function linkToken(ref: Omit<LinkRef, "until">, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...ref, until: now + LINK_TTL_MS })).toString("base64url");
  return `${payload}.${linkMac(payload)}`;
}

export function readLinkToken(token: string, now = Date.now()): Omit<LinkRef, "until"> | null {
  const [payload, mac, ...rest] = token.split(".");
  if (!payload || !mac || rest.length) return null;
  const expected = linkMac(payload);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const { until, ...ref } = JSON.parse(Buffer.from(payload, "base64url").toString()) as LinkRef;
    return until > now ? ref : null;
  } catch {
    return null;
  }
}

/** One atomic change of the workspace's Teams settings (the other settings stay as they are) */
async function writeTeams(workspaceId: string, value: TeamsSettings | null) {
  if (value)
    await prisma.$executeRaw`UPDATE "Workspace" SET "settings" = jsonb_set("settings", '{teams}', ${JSON.stringify(value)}::jsonb) WHERE "id" = ${workspaceId}`;
  else await prisma.$executeRaw`UPDATE "Workspace" SET "settings" = "settings" - 'teams' WHERE "id" = ${workspaceId}`;
}

/** "Link to Ronde", confirmed in Ronde by an admin of the workspace: the team, its channel as a connector */
export async function linkTeams(ctx: WorkspaceContext, token: string): Promise<void> {
  if (!teamsApp()) throw new OpError("teamsNotConfigured");
  if (!teamsOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
  if (!canEncrypt()) throw new OpError("encryptionNotConfigured");
  const ref = readLinkToken(token);
  if (!ref) throw new OpError("teamsLinkExpired");
  const previous = ctx.workspace.settings.teams;
  const name = `Teams · ${cut(ref.teamName || ref.channelName || "Teams", 40)}`;
  const secret = encryptSecret(`${TEAMS_BOT_SECRET}${JSON.stringify({ serviceUrl: ref.serviceUrl, conversationId: ref.channelId })}`);
  let connectorId = previous?.connectorId ?? null;
  const kept = connectorId
    ? await ctx.db.connector.updateMany({ where: { id: connectorId, kind: "teams" }, data: { name, secret } })
    : { count: 0 };
  if (!kept.count)
    connectorId = (
      await ctx.db.connector.create({ data: { workspaceId: ctx.workspace.id, kind: "teams", name, secret, createdById: ctx.user.id } })
    ).id;
  await writeTeams(ctx.workspace.id, {
    ...ref,
    connectorId,
    reminders: previous?.reminders ?? true,
    linkedAt: new Date().toISOString(),
    linkedById: ctx.user.id,
  });
  await audit(ctx, ctx.db, { action: "teams.connect", targetType: "workspace", targetId: ctx.workspace.id, data: { team: ref.teamName } });
  const t = translator(resolveLocale(ctx.workspace.locale), "teams");
  await postToTeams(
    { serviceUrl: ref.serviceUrl, conversationId: ref.channelId },
    message(card([text(`✅ ${t("bot.linked", { workspace: ctx.workspace.name })}`)])),
  ).catch((e) => console.error("[teams] confirmation", e));
}

/** Unlinks the team: reminders go back to email, the channel's connector (and the rules using it) goes */
export async function unlinkTeams(ctx: WorkspaceContext): Promise<void> {
  const s = ctx.workspace.settings.teams;
  if (!s) return;
  await forget(ctx.workspace.id, s);
  await audit(ctx, ctx.db, { action: "teams.disconnect", targetType: "workspace", targetId: ctx.workspace.id, data: { team: s.teamName } });
  const t = translator(resolveLocale(ctx.workspace.locale), "teams");
  await postToTeams({ serviceUrl: s.serviceUrl, conversationId: s.channelId }, message(card([text(t("bot.unlinked"))]))).catch(
    () => undefined,
  );
}

async function forget(workspaceId: string, s: TeamsSettings) {
  await writeTeams(workspaceId, null);
  if (s.connectorId) await prisma.connector.deleteMany({ where: { id: s.connectorId, workspaceId } });
}

export async function setTeamsReminders(ctx: WorkspaceContext, on: boolean): Promise<void> {
  const s = ctx.workspace.settings.teams;
  if (!s) throw new OpError("notFound");
  await writeTeams(ctx.workspace.id, { ...s, reminders: on });
}

/** What the settings page shows */
export interface TeamsView {
  /** The instance has its Teams app */
  configured: boolean;
  /** The app in Teams, once an administrator added it to the organization (a link that opens it there) */
  openUrl: string | null;
  linked: { teamName: string; channelName: string; reminders: boolean; linkedAt: string } | null;
}

export function teamsView(settings: WorkspaceSettings): TeamsView {
  const s = settings.teams;
  return {
    configured: !!teamsApp(),
    openUrl: teamsApp() ? `https://teams.microsoft.com/l/app/${encodeURIComponent(teamsApp()!.appId)}` : null,
    linked: s ? { teamName: s.teamName, channelName: s.channelName, reminders: s.reminders, linkedAt: s.linkedAt } : null,
  };
}

/** The workspaces where a manager could link this team: theirs, in a plan with the app */
export async function linkChoices(userId: string): Promise<{ slug: string; name: string; linked: string | null }[]> {
  const rows = await prisma.workspaceMember.findMany({
    where: { userId, status: "active", role: { in: ["owner", "admin"] }, workspace: { deletedAt: null, suspendedAt: null } },
    select: { workspace: { select: { slug: true, name: true, plan: true, settings: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows
    .map((r) => r.workspace)
    .filter((w) => teamsOn(w))
    .map((w) => ({ slug: w.slug, name: w.name, linked: (w.settings as WorkspaceSettings).teams?.teamName ?? null }));
}

// ---------- People ----------

interface TeamsWorkspace {
  id: string;
  slug: string;
  name: string;
  locale: string;
  teams: TeamsSettings;
  /** The team's people by email, read once when needed */
  roster?: Map<string, string>;
}

/** The workspaces linked to teams of this Microsoft organization, still in a plan that includes the app */
async function teamsWorkspaces(tenantId: string, id?: string): Promise<TeamsWorkspace[]> {
  if (!tenantId) return [];
  const rows = await prisma.workspace.findMany({
    where: { ...(id ? { id } : {}), deletedAt: null, suspendedAt: null, settings: { path: ["teams", "tenantId"], equals: tenantId } },
    select: { id: true, slug: true, name: true, locale: true, plan: true, settings: true },
  });
  return rows.flatMap(({ settings, plan, ...w }) => {
    const teams = (settings as WorkspaceSettings).teams;
    return teams && teamsOn({ plan }) ? [{ ...w, teams }] : [];
  });
}

type Handles = Record<string, unknown>;
type TeamsHandle = { id: string; chat?: string };
const personSelect = { id: true, email: true, firstName: true, lastName: true, locale: true, handles: true } as const;

/** A person's Teams accounts, per organization: { "teams": { "<tenant>": { "id": "29:…", "chat": "a:…" } } } */
const teamsIds = (handles: unknown): Record<string, TeamsHandle> => {
  const v = ((handles ?? {}) as Handles).teams;
  return v && typeof v === "object" ? (v as Record<string, TeamsHandle>) : {};
};

async function remember(personId: string, handles: unknown, tenantId: string, value: TeamsHandle) {
  const teams = { ...teamsIds(handles), [tenantId]: value };
  await prisma.person.update({ where: { id: personId }, data: { handles: { ...((handles ?? {}) as Handles), teams } } });
}

/** The email of a Teams account, as the Bot Connector gives it for a conversation it takes part in */
async function emailOf(a: Activity): Promise<string | null> {
  if (!a.serviceUrl || !a.conversation?.id || !a.from?.id) return null;
  const m = await callTeams<{ email?: string; userPrincipalName?: string }>(
    a.serviceUrl,
    `/v3/conversations/${encodeURIComponent(a.conversation.id)}/members/${encodeURIComponent(a.from.id)}`,
  ).catch((e) => console.error("[teams] member", e));
  return m?.email || m?.userPrincipalName || null;
}

/** The directory profile of the person writing, in a workspace: known by their Teams id, or found by email */
async function personOf(w: TeamsWorkspace, a: Activity, email?: string | null) {
  const id = a.from?.id ?? "";
  const known = await prisma.person.findFirst({
    where: { workspaceId: w.id, active: true, handles: { path: ["teams", w.teams.tenantId, "id"], equals: id } },
    select: personSelect,
  });
  if (known) return known;
  if (!email) return null;
  const person = await prisma.person.findFirst({
    where: { workspaceId: w.id, active: true, email: { equals: email, mode: "insensitive" } },
    select: personSelect,
  });
  // A personal chat is where reminders go: kept with the account
  if (person)
    await remember(person.id, person.handles, w.teams.tenantId, {
      id,
      ...(a.conversation?.conversationType === "personal" ? { chat: a.conversation.id } : {}),
    });
  return person;
}

/** The team's people, by email: read from Teams once per run of the reminders */
async function roster(w: TeamsWorkspace): Promise<Map<string, string>> {
  if (w.roster) return w.roster;
  const found = new Map<string, string>();
  let token = "";
  try {
    for (let page = 0; page < 20; page++) {
      const res = await callTeams<{ members?: { id: string; email?: string; userPrincipalName?: string }[]; continuationToken?: string }>(
        w.teams.serviceUrl,
        `/v3/conversations/${encodeURIComponent(w.teams.teamId)}/pagedmembers?pageSize=500${token ? `&continuationToken=${encodeURIComponent(token)}` : ""}`,
      );
      for (const m of res.members ?? []) for (const e of [m.email, m.userPrincipalName]) if (e) found.set(e.toLowerCase(), m.id);
      if (!res.continuationToken) break;
      token = res.continuationToken;
    }
  } catch (e) {
    console.error(`[teams] members of the team of workspace ${w.id}`, e);
  }
  w.roster = found;
  return found;
}

/** A person's personal chat with the bot, opened if needed (the bot is in a team they belong to) */
async function chatOf(w: TeamsWorkspace, p: { id: string; email: string; handles: unknown }): Promise<string | null> {
  const app = teamsApp();
  if (!app) return null;
  const known = teamsIds(p.handles)[w.teams.tenantId];
  if (known?.chat) return known.chat;
  const userId = known?.id ?? (await roster(w)).get(p.email.toLowerCase());
  if (!userId) return null;
  try {
    const chat = await callTeams<{ id?: string }>(w.teams.serviceUrl, "/v3/conversations", {
      body: {
        isGroup: false,
        bot: { id: `28:${app.appId}` },
        members: [{ id: userId }],
        tenantId: w.teams.tenantId,
        channelData: { tenant: { id: w.teams.tenantId } },
      },
    });
    if (!chat.id) return null;
    await remember(p.id, p.handles, w.teams.tenantId, { id: userId, chat: chat.id });
    return chat.id;
  } catch (e) {
    console.error(`[teams] chat with a person of workspace ${w.id}`, e);
    return null;
  }
}

// ---------- Reminders ----------

/** The Teams app of a workspace, when check-in reminders go through it */
export async function teamsReminders(workspaceId: string): Promise<TeamsWorkspace | null> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const tenantId = (ws?.settings as WorkspaceSettings | undefined)?.teams?.tenantId;
  if (!tenantId || !teamsApp()) return null;
  const [w] = await teamsWorkspaces(tenantId, workspaceId);
  return w?.teams.reminders ? w : null;
}

export interface TeamsReminder {
  locale: Locale;
  teamName: string;
  meetingId: string;
  date: string;
  time: string;
  name: string;
  checkInUrl: string;
  planned: string[];
  actions: { text: string; status: "open" | "doing" | "done" }[];
  sheets: string[];
}

/** The card reminding a person of their check-in, with the button that turns it into the form */
export function reminderCard(w: { id: string }, r: TeamsReminder): object {
  const t = translator(r.locale, "notifications");
  const ts = translator(r.locale, "slack");
  const status = translator(r.locale, "actionStatus");
  const when = t("when", { date: formatters(r.locale).date(r.date), time: r.time });
  const first = r.name.split(" ")[0] ?? r.name;
  const body: object[] = [
    text(t("email.title"), { weight: "Bolder", size: "Medium" }),
    text(t("email.greeting", { name: first })),
    text(t("email.intro", { team: r.teamName }), { spacing: "Small" }),
    text(`🗓️ ${when}`, { isSubtle: true, spacing: "Small" }),
  ];
  if (r.sheets.length) body.push(text(t("email.sheets"), { weight: "Bolder" }), text(bullets(r.sheets), { spacing: "Small" }));
  const planned = r.planned.map(plainItem).filter((p) => p.trim());
  if (planned.length) body.push(text(t("email.planned"), { weight: "Bolder" }), text(bullets(planned), { spacing: "Small" }));
  const todo = r.actions.filter((a) => a.status !== "done").map((a) => `${plainItem(a.text)} (${status(a.status)})`);
  if (todo.length) body.push(text(t("email.actions"), { weight: "Bolder" }), text(bullets(todo), { spacing: "Small" }));
  return card(body, [
    { type: "Action.Execute", title: ts("fillIn"), verb: VERB_OPEN, data: { w: w.id, m: r.meetingId }, style: "positive" },
    ...(r.checkInUrl ? [{ type: "Action.OpenUrl", title: ts("openRonde"), url: r.checkInUrl }] : []),
  ]);
}

/** Sends the reminder to a person in their personal chat; false when they are not found in the team or it fails */
export async function remindInTeams(
  w: TeamsWorkspace,
  person: { id: string; email: string; handles: unknown },
  r: TeamsReminder,
): Promise<boolean> {
  const chat = await chatOf(w, person);
  if (!chat) return false;
  try {
    const t = translator(r.locale, "notifications");
    await postToTeams(
      { serviceUrl: w.teams.serviceUrl, conversationId: chat },
      message(reminderCard(w, r), t("email.subject", { team: r.teamName, date: formatters(r.locale).dateShort(r.date), time: r.time })),
    );
    return true;
  } catch (e) {
    console.error(`[teams] reminder to ${person.email}`, e);
    return false;
  }
}

// ---------- The check-in form ----------

interface FormContext {
  w: TeamsWorkspace;
  db: ScopedClient;
  person: { id: string; email: string; handles: unknown };
  meeting: { id: string; name: string };
  locale: Locale;
  rows: SectionDef[];
}

/**
 * Everything a form needs, checked: the meeting of a workspace linked to this organization, the person writing
 * taking part in it. Otherwise the language to say so in.
 */
async function formContext(a: Activity, data: Record<string, unknown>): Promise<FormContext | { locale: Locale }> {
  const fallback = { locale: resolveLocale(a.locale?.slice(0, 2), env.defaultLocale()) };
  if (typeof data.w !== "string" || typeof data.m !== "string") return fallback;
  const [w] = await teamsWorkspaces(tenantOf(a), data.w);
  if (!w) return fallback;
  const person = await personOf(w, a, await emailOf(a));
  const db = scoped(prisma, w.id);
  const meeting = person
    ? await db.meeting.findFirst({ where: { id: data.m, archivedAt: null }, select: { id: true, name: true, locale: true } })
    : null;
  const seat =
    person && meeting
      ? await db.meetingParticipant.findFirst({
          where: { meetingId: meeting.id, personId: person.id, active: true, role: { not: "observer" } },
        })
      : null;
  if (!person || !meeting || !seat) return { locale: resolveLocale(w.locale) };
  const rows = (await sectionsOf(db, meeting.id)).map(toSection);
  return { w, db, person, meeting, locale: resolveLocale(person.locale, meeting.locale, w.locale), rows };
}

const linesOf = (value: string, input: SectionType): string[] =>
  input === "text"
    ? [value.trim()].filter(Boolean)
    : value
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

/** A card that only says something */
const notice = (t: string) => card([text(t)]);
const notFound = (locale: Locale) => notice(translator(locale, "teams")("bot.notFound"));

/** The check-in as a form: one field per section, filled with what was written (or typed), and "Save" */
async function formCard(c: FormContext, problem?: string, typed?: Record<string, string>): Promise<object> {
  const ts = translator(c.locale, "slack");
  const [checkIns, session] = await Promise.all([
    loadCheckIns(c.db, c.meeting.id, c.rows),
    c.db.session.findFirst({ where: { meetingId: c.meeting.id, status: "current" }, select: { date: true, time: true } }),
  ]);
  const mine = checkIns[c.person.id];
  const items = mine ? itemsFromCheckIn(mine, c.rows) : {};
  const initial = (d: SectionDef) =>
    typed?.[`s:${d.key}`] ?? (d.input === "text" ? (items[d.key] ?? []).join("\n\n") : (items[d.key] ?? []).join("\n"));
  // A check-in too long for the form could not be saved back whole: it is edited in Ronde
  if (c.rows.some((d) => initial(d).length > INPUT_MAX)) return notice(translator(c.locale, "teams")("bot.tooLong"));
  const labels = resolveSections({ sections: c.rows }, c.locale);
  const when = session
    ? translator(c.locale, "notifications")("when", { date: formatters(c.locale).dateShort(session.date), time: session.time })
    : "";
  const url = await publicUrl(`/w/${c.w.slug}/m/${c.meeting.id}/me`);
  return card(
    [
      text(ts("title"), { weight: "Bolder", size: "Medium" }),
      text([c.meeting.name, when].filter(Boolean).join(" · "), { isSubtle: true, spacing: "Small" }),
      ...(problem ? [text(`⚠️ ${problem}`, { color: "Attention" })] : []),
      ...c.rows.map((d, i) => ({
        type: "Input.Text",
        id: `s:${d.key}`,
        label: labels[i]?.label ?? d.key,
        isMultiline: true,
        maxLength: INPUT_MAX,
        placeholder: ts(`hint.${d.input}`),
        value: initial(d),
      })),
    ],
    [
      {
        type: "Action.Execute",
        title: ts("save"),
        verb: VERB_SAVE,
        style: "positive",
        data: { w: c.w.id, m: c.meeting.id, p: c.person.id, since: mine?.updatedAt ?? null },
      },
      { type: "Action.OpenUrl", title: ts("openRonde"), url },
    ],
  );
}

/** "Fill in my check-in": the card becomes the form */
async function openForm(a: Activity, data: Record<string, unknown>): Promise<object> {
  const c = await formContext(a, data);
  return "db" in c ? formCard(c) : notFound(c.locale);
}

/** The form sent: the check-in is saved like on the page, and the meeting's screens follow */
async function saveForm(a: Activity, data: Record<string, unknown>): Promise<object> {
  const c = await formContext(a, data);
  // Only the person the form was opened for can send it
  if (!("db" in c) || c.person.id !== data.p) return notFound(c.locale);
  const ts = translator(c.locale, "slack");
  const typed = Object.fromEntries(
    c.rows.map((d) => [`s:${d.key}`, typeof data[`s:${d.key}`] === "string" ? String(data[`s:${d.key}`]) : ""]),
  );
  const items: Record<string, string[]> = {};
  for (const d of c.rows) {
    const lines = linesOf(typed[`s:${d.key}`] ?? "", d.input);
    if (lines.length > ITEMS_MAX) return formCard(c, ts("tooMany", { max: ITEMS_MAX }), typed);
    if (lines.some((l) => l.length > ITEM_MAX)) return formCard(c, ts("itemTooLong", { max: ITEM_MAX }), typed);
    items[d.key] = lines;
  }
  const since = typeof data.since === "number" ? data.since : null;
  const changed = await c.db.$transaction(async (db) => {
    // Same turn-taking as the page: saves of one check-in wait for each other
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`checkin:${c.meeting.id}:${c.person.id}`}, 0))`;
    const head = await db.checkIn.findFirst({ where: { meetingId: c.meeting.id, personId: c.person.id }, select: { updatedAt: true } });
    if ((head?.updatedAt.getTime() ?? null) !== since) return true;
    await saveCheckIn(db, { workspaceId: c.w.id, meetingId: c.meeting.id, personId: c.person.id }, checkInFromItems(items, c.rows), c.rows);
    return false;
  });
  // Changed in Ronde meanwhile: the form comes back with the latest version
  if (changed) return formCard(c, ts("changed"));
  await publish(c.meeting.id, { kind: "state" });
  return notice(`✅ ${ts("saved", { team: c.meeting.name })}`);
}

// ---------- "ronde" in a personal chat ----------

/** What the bot answers in a personal chat: the person's next sessions with their check-in, their open actions */
export async function summaryCard(a: Activity): Promise<object> {
  const base = env.appUrl();
  const body: object[] = [];
  const actions: object[] = [];
  let locale = resolveLocale(a.locale?.slice(0, 2), env.defaultLocale());
  const email = await emailOf(a);
  for (const w of await teamsWorkspaces(tenantOf(a))) {
    const person = await personOf(w, a, email);
    if (!person) continue;
    locale = resolveLocale(person.locale, w.locale);
    const ts = translator(locale, "slack");
    const status = translator(locale, "actionStatus");
    const db = scoped(prisma, w.id);
    const seats = await db.meetingParticipant.findMany({
      where: { personId: person.id, active: true, role: { not: "observer" }, meeting: { archivedAt: null } },
      select: { meeting: { select: { id: true, name: true } } },
      take: 12,
    });
    body.push(text(w.name, { weight: "Bolder", size: "Large", spacing: body.length ? "ExtraLarge" : "None" }));
    for (const { meeting } of seats) {
      const rows = (await sectionsOf(db, meeting.id)).map(toSection);
      const [session, checkIns, last] = await Promise.all([
        db.session.findFirst({ where: { meetingId: meeting.id, status: "current" }, select: { date: true, time: true } }),
        loadCheckIns(db, meeting.id, rows),
        db.session.findFirst({
          where: { meetingId: meeting.id, status: "archived" },
          orderBy: { date: "desc" },
          select: { archivedAt: true },
        }),
      ]);
      const ready = isCheckInReady(checkIns[person.id], last?.archivedAt?.getTime() ?? null);
      const when = session
        ? translator(locale, "notifications")("when", { date: formatters(locale).dateShort(session.date), time: session.time })
        : ts("noSession");
      body.push({
        type: "ColumnSet",
        separator: true,
        columns: [
          {
            type: "Column",
            width: "stretch",
            items: [
              text(meeting.name, { weight: "Bolder" }),
              text(`${when} · ${ready ? `✅ ${ts("ready")}` : `✏️ ${ts("toFill")}`}`, { isSubtle: true, spacing: "None" }),
            ],
          },
          {
            type: "Column",
            width: "auto",
            verticalContentAlignment: "Center",
            items: [
              {
                type: "ActionSet",
                actions: [{ type: "Action.Execute", title: ts("fillIn"), verb: VERB_OPEN, data: { w: w.id, m: meeting.id } }],
              },
            ],
          },
        ],
      });
    }
    if (!seats.length) body.push(text(ts("noMeetings"), { isSubtle: true }));
    const open = await db.action.findMany({
      where: { ownerId: person.id, status: { not: "done" }, meeting: { archivedAt: null } },
      orderBy: { createdAt: "asc" },
      select: { text: true, status: true },
      take: 11,
    });
    if (open.length)
      body.push(
        text(ts("actions"), { weight: "Bolder", spacing: "Large" }),
        text(bullets(open.map((x) => `${plainItem(x.text)} (${status(x.status)})`)), { spacing: "Small" }),
      );
    if (base && !actions.length) actions.push({ type: "Action.OpenUrl", title: ts("openRonde"), url: `${base}/w/${w.slug}` });
  }
  if (!body.length) return card([text(translator(locale, "teams")("bot.unknown"))]);
  return card(body, actions);
}

// ---------- Activities ----------

/** The card asking, in a channel, to link the team to a Ronde workspace */
async function linkCard(a: Activity): Promise<object | null> {
  const team = a.channelData?.team;
  if (!a.serviceUrl || !team?.id || !a.conversation?.id) return null;
  const locale = resolveLocale(a.locale?.slice(0, 2), env.defaultLocale());
  const t = translator(locale, "teams");
  const token = linkToken({
    tenantId: tenantOf(a),
    serviceUrl: a.serviceUrl,
    teamId: team.id,
    teamName: team.name ?? "",
    channelId: a.conversation.id,
    channelName: a.channelData?.channel?.name ?? "",
  });
  return card(
    [
      text(t("bot.welcomeTitle"), { weight: "Bolder", size: "Medium" }),
      text(t("bot.welcome")),
      text(t("bot.welcomeWho"), { isSubtle: true }),
    ],
    [
      {
        type: "Action.OpenUrl",
        title: t("bot.link"),
        url: await publicUrl(`/teams/link?t=${encodeURIComponent(token)}`),
        style: "positive",
      },
    ],
  );
}

/** The workspace linked to this team, if any */
async function linkedTo(a: Activity): Promise<TeamsWorkspace | null> {
  const teamId = a.channelData?.team?.id;
  return (await teamsWorkspaces(tenantOf(a))).find((w) => w.teams.teamId === teamId) ?? null;
}

/**
 * One activity of Teams: the app added somewhere, a message to the bot, a button of its cards. Returns the
 * answer of an invoke (the card replacing the clicked one); the other activities answer by writing to Teams.
 */
export async function handleActivity(a: Activity): Promise<InvokeAnswer | null> {
  const reply = (activity: object) =>
    a.serviceUrl && a.conversation?.id
      ? postToTeams({ serviceUrl: a.serviceUrl, conversationId: a.conversation.id }, activity).catch((e) =>
          console.error("[teams] reply", e),
        )
      : undefined;
  const locale = resolveLocale(a.locale?.slice(0, 2), env.defaultLocale());
  const t = translator(locale, "teams");
  const inTeam = !!a.channelData?.team?.id && a.conversation?.conversationType === "channel";

  if (a.type === "invoke" && a.name === "adaptiveCard/action") {
    const verb = a.value?.action?.verb;
    const data = (a.value?.action?.data ?? {}) as Record<string, unknown>;
    if (verb === VERB_OPEN) return answer(await openForm(a, data));
    if (verb === VERB_SAVE) return answer(await saveForm(a, data));
    return answer(notice(t("bot.help")));
  }

  if (a.type === "conversationUpdate" && a.membersAdded?.some((m) => m.id === a.recipient?.id)) {
    // Added to a team: in its channel, the way to link it; in a personal chat, hello
    if (inTeam) {
      const linked = await linkedTo(a);
      const c = linked ? card([text(t("bot.alreadyLinked", { workspace: linked.name }))]) : await linkCard(a);
      if (c) await reply(message(c));
    } else await reply(message(card([text(t("bot.hello"))])));
    return null;
  }

  if (a.type === "installationUpdate" && a.action?.startsWith("remove") && a.channelData?.team?.id) {
    // Removed from the team: the workspaces linked to it forget it
    for (const w of await teamsWorkspaces(tenantOf(a))) if (w.teams.teamId === a.channelData.team.id) await forget(w.id, w.teams);
    return null;
  }

  if (a.type === "message") {
    if (inTeam) {
      // Mentioned in a channel: which workspace it is linked to, or the way to link it
      const linked = await linkedTo(a);
      const c = linked
        ? card([text(t("bot.alreadyLinked", { workspace: linked.name })), text(t("bot.help"), { isSubtle: true })])
        : await linkCard(a);
      if (c) await reply(message(c));
      return null;
    }
    const words = (a.text ?? "").trim().toLowerCase();
    if (/^(help|aide|ayuda|ajuda|aiuto|hilfe|помощь|帮助|मदद|مساعدة)\b/u.test(words)) await reply(message(card([text(t("bot.help"))])));
    else await reply(message(await summaryCard(a)));
    return null;
  }
  return null;
}

// ---------- The app package ----------

/** The package an administrator uploads to Teams, with the manifest's texts in every language of Ronde */
export function teamsPackage(): Uint8Array {
  const app = teamsApp();
  if (!app) throw new OpError("teamsNotConfigured");
  const site = env.siteUrl();
  // Teams knows Simplified Chinese as zh-cn
  const tag = (l: Locale) => (l === "zh" ? "zh-cn" : l);
  const ordered = ["en", ...locales.filter((l) => l !== "en")] as Locale[];
  return enterprise.teams.appPackage(app, {
    domain: new URL(env.appUrl() || "http://localhost:3000").host,
    version: "1.0.0",
    developer: { name: "Ronde", websiteUrl: site, privacyUrl: `${site}/privacy`, termsOfUseUrl: `${site}/terms` },
    accentColor: "#B8410E",
    texts: ordered.map((l) => {
      const p = translator(l, "teams");
      return {
        locale: tag(l),
        shortName: "Ronde",
        fullName: p("package.fullName"),
        shortDescription: p("package.shortDescription"),
        fullDescription: p("package.fullDescription"),
        commands: [
          { title: "ronde", description: p("package.commandRonde") },
          { title: p("package.helpWord"), description: p("package.commandHelp") },
        ],
      };
    }),
    icons: { color: Buffer.from(TEAMS_ICONS.color, "base64"), outline: Buffer.from(TEAMS_ICONS.outline, "base64") },
  });
}
