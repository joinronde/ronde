import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SectionDef, SectionType } from "@ronde/core/types";
import { checkInFromItems, isCheckInReady, itemsFromCheckIn, plainItem, resolveSections } from "@ronde/core/util";
import { prisma, scoped } from "@ronde/db";
import { formatters, type Locale, resolveLocale, translator } from "@ronde/i18n";
import { enterprise } from "@/ee-bridge";
import { audit } from "./audit";
import type { SlackSettings, WorkspaceContext, WorkspaceSettings } from "./authz";
import { publish } from "./bus";
import { env } from "./env";
import { AccessError, OpError } from "./errors";
import { featureOn, type PlanScope } from "./license";
import { loadCheckIns, saveCheckIn } from "./meeting/checkins";
import { toSection } from "./meeting/dto";
import { sectionsOf } from "./meeting/state";
import { publicUrl } from "./public-url";
import { canEncrypt, decryptSecret, encryptSecret } from "./secrets";

// The Slack app (Team). A workspace adds it with "Add to Slack"; then:
// - check-in reminders arrive as direct messages, with a button opening the check-in as a Slack form whose
//   answers are saved in Ronde;
// - the channel picked during the installation becomes a connector, for the meetings' notification rules
//   (minutes published, session soon…);
// - "/ronde" lists the person's next sessions and open follow-up actions.
// People are matched by their email: the Slack account and the Ronde directory profile share it.

/** The instance's Slack app, once its three keys are configured */
export function slackApp() {
  const clientId = env.slackClientId();
  const clientSecret = env.slackClientSecret();
  return clientId && clientSecret && env.slackSigningSecret() ? { clientId, clientSecret } : null;
}

export const slackOn = (ws: PlanScope) => featureOn("integrations.slack", ws);

/** Checks that a request comes from the instance's Slack app */
export const fromSlack = (body: string, headers: Headers) =>
  enterprise.slack.verify(
    body,
    headers.get("x-slack-request-timestamp") ?? "",
    headers.get("x-slack-signature") ?? "",
    env.slackSigningSecret(),
  );

const CHECKIN_ACTION = "ronde.checkin";
const CHECKIN_VIEW = "ronde.checkin";
/** Slack's limits: modal titles and buttons, text inputs, section texts */
const TITLE_MAX = 24;
const INPUT_MAX = 3000;
const SECTION_MAX = 2900;
/** Same limits as the check-in page */
const ITEMS_MAX = 50;
const ITEM_MAX = 2000;

const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
/** Text in Slack's mrkdwn: only &, < and > need escaping */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const plain = (text: string, max = TITLE_MAX) => ({ type: "plain_text", text: cut(text, max), emoji: true });
const mrkdwn = (text: string) => ({ type: "mrkdwn", text: cut(text, SECTION_MAX) });
const bullets = (items: string[], max = 10) =>
  [...items.slice(0, max).map((i) => `• ${esc(cut(i, 300))}`), ...(items.length > max ? ["…"] : [])].join("\n");

// ---------- Installation ----------

const STATE_TTL_MS = 10 * 60_000;
const stateMac = (payload: string) => createHmac("sha256", env.authSecret()).update(`slack-install:${payload}`).digest("base64url");

/** The "state" of the OAuth round trip: which workspace, for whom, until when; signed */
export function installState(workspaceId: string, userId: string, now = Date.now()): string {
  const payload = `${workspaceId}.${userId}.${now + STATE_TTL_MS}`;
  return `${payload}.${stateMac(payload)}`;
}

export function readInstallState(state: string, now = Date.now()): { workspaceId: string; userId: string } | null {
  const [workspaceId, userId, until, mac, ...rest] = state.split(".");
  if (!workspaceId || !userId || !until || !mac || rest.length) return null;
  const expected = stateMac(`${workspaceId}.${userId}.${until}`);
  if (mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return Number(until) > now ? { workspaceId, userId } : null;
}

const redirectUri = () => publicUrl("/api/slack/oauth");

/** Slack's consent page, where the administrator picks the Slack workspace and the channel */
export async function installUrl(ctx: WorkspaceContext): Promise<string> {
  const app = slackApp();
  if (!app) throw new OpError("slackNotConfigured");
  if (!slackOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
  return enterprise.slack.authorizeUrl(app, await redirectUri(), installState(ctx.workspace.id, ctx.user.id));
}

/** One atomic change of the workspace's Slack settings (the other settings stay as they are) */
async function writeSlack(workspaceId: string, value: SlackSettings | null) {
  if (value)
    await prisma.$executeRaw`UPDATE "Workspace" SET "settings" = jsonb_set("settings", '{slack}', ${JSON.stringify(value)}::jsonb) WHERE "id" = ${workspaceId}`;
  else await prisma.$executeRaw`UPDATE "Workspace" SET "settings" = "settings" - 'slack' WHERE "id" = ${workspaceId}`;
}

/** Back from Slack with a code: the installation is kept, and its channel becomes a connector */
export async function finishInstall(ctx: WorkspaceContext, code: string): Promise<void> {
  const app = slackApp();
  if (!app) throw new OpError("slackNotConfigured");
  if (!slackOn(ctx.workspace)) throw new AccessError(403, "featureNotInPlan");
  if (!canEncrypt()) throw new OpError("encryptionNotConfigured");
  const install = await enterprise.slack.exchange(app, code, await redirectUri());
  const previous = ctx.workspace.settings.slack;
  // Moved to another Slack workspace: the app leaves the previous one
  if (previous && previous.teamId !== install.teamId) await uninstall(app, previous);
  let connectorId = previous?.connectorId ?? null;
  if (install.webhookUrl) {
    const data = { name: install.channel ? `Slack ${install.channel}` : "Slack", secret: encryptSecret(install.webhookUrl) };
    const kept = connectorId ? await ctx.db.connector.updateMany({ where: { id: connectorId, kind: "slack" }, data }) : { count: 0 };
    if (!kept.count)
      connectorId = (
        await ctx.db.connector.create({ data: { ...data, workspaceId: ctx.workspace.id, kind: "slack", createdById: ctx.user.id } })
      ).id;
  }
  await writeSlack(ctx.workspace.id, {
    teamId: install.teamId,
    teamName: install.teamName,
    botUserId: install.botUserId,
    botToken: encryptSecret(install.botToken),
    channel: install.channel,
    connectorId,
    reminders: previous?.reminders ?? true,
    installedAt: new Date().toISOString(),
    installedById: ctx.user.id,
  });
  await audit(ctx, ctx.db, {
    action: "slack.connect",
    targetType: "workspace",
    targetId: ctx.workspace.id,
    data: { team: install.teamName, channel: install.channel },
  });
}

/** Removes the app from the Slack workspace, and its channel's connector (with the rules using it) */
export async function disconnectSlack(ctx: WorkspaceContext): Promise<void> {
  const s = ctx.workspace.settings.slack;
  if (!s) return;
  const app = slackApp();
  if (app) await uninstall(app, s);
  await forget(ctx.workspace.id, s);
  await audit(ctx, ctx.db, { action: "slack.disconnect", targetType: "workspace", targetId: ctx.workspace.id, data: { team: s.teamName } });
}

async function uninstall(app: { clientId: string; clientSecret: string }, s: SlackSettings) {
  try {
    await enterprise.slack.call(decryptSecret(s.botToken), "apps.uninstall", { client_id: app.clientId, client_secret: app.clientSecret });
  } catch (e) {
    // Already removed on Slack's side, or the key changed: Ronde forgets it all the same
    console.error("[slack] uninstall", e);
  }
}

async function forget(workspaceId: string, s: SlackSettings) {
  await writeSlack(workspaceId, null);
  if (s.connectorId) await prisma.connector.deleteMany({ where: { id: s.connectorId, workspaceId } });
}

/** The app was removed from Slack (or its token revoked) there: the workspaces it served forget it */
export async function slackUninstalled(teamId: string): Promise<void> {
  for (const w of await slackWorkspaces(teamId)) await forget(w.id, w.slack);
}

export async function setSlackReminders(ctx: WorkspaceContext, on: boolean): Promise<void> {
  const s = ctx.workspace.settings.slack;
  if (!s) throw new OpError("notFound");
  await writeSlack(ctx.workspace.id, { ...s, reminders: on });
}

/** What the settings page shows */
export interface SlackView {
  /** The instance has its Slack app */
  configured: boolean;
  connected: { teamName: string; channel: string; reminders: boolean; installedAt: string } | null;
}

export function slackView(settings: WorkspaceSettings): SlackView {
  const s = settings.slack;
  return {
    configured: !!slackApp(),
    connected: s ? { teamName: s.teamName, channel: s.channel, reminders: s.reminders, installedAt: s.installedAt } : null,
  };
}

// ---------- People ----------

interface SlackWorkspace {
  id: string;
  slug: string;
  name: string;
  locale: string;
  plan: string;
  slack: SlackSettings;
  token: string;
}

/** The workspaces where a Slack workspace added the app, still in a plan that includes it */
async function slackWorkspaces(teamId: string, id?: string): Promise<SlackWorkspace[]> {
  const rows = await prisma.workspace.findMany({
    where: { ...(id ? { id } : {}), deletedAt: null, suspendedAt: null, settings: { path: ["slack", "teamId"], equals: teamId } },
    select: { id: true, slug: true, name: true, locale: true, plan: true, settings: true },
  });
  const out: SlackWorkspace[] = [];
  for (const { settings, ...w } of rows) {
    const slack = (settings as WorkspaceSettings).slack;
    if (!slack || !slackOn(w)) continue;
    try {
      out.push({ ...w, slack, token: decryptSecret(slack.botToken) });
    } catch (e) {
      console.error(`[slack] token of workspace ${w.id}`, e);
    }
  }
  return out;
}

type Handles = Record<string, unknown>;
const personSelect = { id: true, email: true, firstName: true, lastName: true, locale: true, handles: true } as const;

/** Slack accounts of a person, per Slack workspace: { "slack": { "T024BE7LD": "U023BECGF" } } */
const slackIds = (handles: unknown): Record<string, string> => {
  const v = ((handles ?? {}) as Handles).slack;
  return v && typeof v === "object" ? (v as Record<string, string>) : {};
};

async function remember(personId: string, handles: unknown, teamId: string, slackId: string) {
  const slack = { ...slackIds(handles), [teamId]: slackId };
  await prisma.person.update({ where: { id: personId }, data: { handles: { ...((handles ?? {}) as Handles), slack } } });
}

/** A person's Slack account: found once by email, then remembered */
async function slackIdOf(w: SlackWorkspace, p: { id: string; email: string; handles: unknown }): Promise<string | null> {
  const known = slackIds(p.handles)[w.slack.teamId];
  if (known) return known;
  try {
    const found = await enterprise.slack.call<{ user?: { id?: string } }>(w.token, "users.lookupByEmail", { email: p.email });
    if (!found.user?.id) return null;
    await remember(p.id, p.handles, w.slack.teamId, found.user.id);
    return found.user.id;
  } catch {
    // Not in that Slack workspace (users_not_found), or Slack is unreachable
    return null;
  }
}

/** The directory profile of a Slack account in a workspace */
async function personOf(w: SlackWorkspace, slackId: string) {
  const known = await prisma.person.findFirst({
    where: { workspaceId: w.id, active: true, handles: { path: ["slack", w.slack.teamId], equals: slackId } },
    select: personSelect,
  });
  if (known) return known;
  const info = await enterprise.slack
    .call<{ user?: { profile?: { email?: string } } }>(w.token, "users.info", { user: slackId })
    .catch((e) => console.error("[slack] users.info", e));
  const email = info?.user?.profile?.email;
  if (!email) return null;
  const person = await prisma.person.findFirst({
    where: { workspaceId: w.id, active: true, email: { equals: email, mode: "insensitive" } },
    select: personSelect,
  });
  if (person) await remember(person.id, person.handles, w.slack.teamId, slackId);
  return person;
}

// ---------- Reminders ----------

/** The Slack app of a workspace, when check-in reminders go through it */
export async function slackReminders(workspaceId: string): Promise<SlackWorkspace | null> {
  const ws = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { settings: true } });
  const teamId = (ws?.settings as WorkspaceSettings | undefined)?.slack?.teamId;
  if (!teamId || !slackApp()) return null;
  const [w] = await slackWorkspaces(teamId, workspaceId);
  return w?.slack.reminders ? w : null;
}

export interface SlackReminder {
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

/** The direct message reminding a person of their check-in */
export function reminderMessage(w: { id: string }, r: SlackReminder): { text: string; blocks: object[] } {
  const t = translator(r.locale, "notifications");
  const ts = translator(r.locale, "slack");
  const status = translator(r.locale, "actionStatus");
  const when = t("when", { date: formatters(r.locale).date(r.date), time: r.time });
  const first = r.name.split(" ")[0] ?? r.name;
  const blocks: object[] = [
    {
      type: "section",
      text: mrkdwn(
        `*${esc(t("email.title"))}*\n${esc(t("email.greeting", { name: first }))}\n${esc(t("email.intro", { team: r.teamName }))}`,
      ),
    },
    { type: "context", elements: [mrkdwn(`🗓️ ${esc(when)}`)] },
  ];
  if (r.sheets.length) blocks.push({ type: "section", text: mrkdwn(`*${esc(t("email.sheets"))}*\n${bullets(r.sheets)}`) });
  const planned = r.planned.map(plainItem).filter((p) => p.trim());
  if (planned.length) blocks.push({ type: "section", text: mrkdwn(`*${esc(t("email.planned"))}*\n${bullets(planned)}`) });
  const todo = r.actions.filter((a) => a.status !== "done").map((a) => `${plainItem(a.text)} (${status(a.status)})`);
  if (todo.length) blocks.push({ type: "section", text: mrkdwn(`*${esc(t("email.actions"))}*\n${bullets(todo)}`) });
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        style: "primary",
        action_id: CHECKIN_ACTION,
        text: plain(ts("fillIn"), 75),
        value: JSON.stringify({ w: w.id, m: r.meetingId }),
      },
      ...(r.checkInUrl ? [{ type: "button", action_id: "ronde.open", text: plain(ts("openRonde"), 75), url: r.checkInUrl }] : []),
    ],
  });
  return { text: t("email.subject", { team: r.teamName, date: formatters(r.locale).dateShort(r.date), time: r.time }), blocks };
}

/** Sends the reminder to a person by direct message; false when they are not found in Slack or it fails */
export async function remindInSlack(
  w: SlackWorkspace,
  person: { id: string; email: string; handles: unknown },
  r: SlackReminder,
): Promise<boolean> {
  const user = await slackIdOf(w, person);
  if (!user) return false;
  try {
    await enterprise.slack.call(w.token, "chat.postMessage", { channel: user, ...reminderMessage(w, r) });
    return true;
  } catch (e) {
    console.error(`[slack] reminder to ${person.email}`, e);
    return false;
  }
}

// ---------- The check-in form ----------

interface FormRef {
  /** Workspace, meeting, person, and the version of the check-in the form started from */
  w: string;
  m: string;
  p: string;
  since: number | null;
}

/** Everything a form needs, checked: the meeting of a workspace this Slack serves, the person taking part in it */
async function formContext(w: SlackWorkspace, slackId: string, meetingId: string) {
  const person = await personOf(w, slackId);
  if (!person) return null;
  const db = scoped(prisma, w.id);
  const meeting = await db.meeting.findFirst({
    where: { id: meetingId, archivedAt: null },
    select: { id: true, name: true, locale: true },
  });
  const seat = meeting
    ? await db.meetingParticipant.findFirst({ where: { meetingId, personId: person.id, active: true, role: { not: "observer" } } })
    : null;
  if (!meeting || !seat) return null;
  const locale = resolveLocale(person.locale, meeting.locale, w.locale);
  const rows = (await sectionsOf(db, meetingId)).map(toSection);
  return { w, db, person, meeting, locale, rows };
}

const linesOf = (value: string, input: SectionType): string[] =>
  input === "text"
    ? [value.trim()].filter(Boolean)
    : value
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

/** A modal that only says something (no form) */
const notice = (locale: Locale, text: string) => {
  const ts = translator(locale, "slack");
  return { type: "modal", title: plain(ts("title")), close: plain(ts("close")), blocks: [{ type: "section", text: mrkdwn(text) }] };
};

/** The "Fill in my check-in" button: opens the form, filled with the current check-in */
export async function openCheckIn(p: { teamId: string; userId: string; triggerId: string; value: string }): Promise<void> {
  let ref: { w?: unknown; m?: unknown };
  try {
    ref = JSON.parse(p.value);
  } catch {
    return;
  }
  if (typeof ref.w !== "string" || typeof ref.m !== "string") return;
  const [w] = await slackWorkspaces(p.teamId, ref.w);
  if (!w) return;
  const open = (view: object) => enterprise.slack.call(w.token, "views.open", { trigger_id: p.triggerId, view });
  const c = await formContext(w, p.userId, ref.m);
  if (!c) {
    const locale = resolveLocale(w.locale);
    return void (await open(notice(locale, esc(translator(locale, "slack")("notFound")))));
  }
  const ts = translator(c.locale, "slack");
  const [checkIns, session] = await Promise.all([
    loadCheckIns(c.db, c.meeting.id, c.rows),
    c.db.session.findFirst({ where: { meetingId: c.meeting.id, status: "current" }, select: { date: true, time: true } }),
  ]);
  const mine = checkIns[c.person.id];
  const items = mine ? itemsFromCheckIn(mine, c.rows) : {};
  const initial = (d: SectionDef) => (d.input === "text" ? (items[d.key] ?? []).join("\n\n") : (items[d.key] ?? []).join("\n"));
  // A check-in too long for Slack's fields could not be saved back whole: it is edited in Ronde
  if (c.rows.some((d) => initial(d).length > INPUT_MAX)) return void (await open(notice(c.locale, esc(ts("tooLong")))));
  const labels = resolveSections({ sections: c.rows }, c.locale);
  const when = session
    ? translator(c.locale, "notifications")("when", { date: formatters(c.locale).dateShort(session.date), time: session.time })
    : "";
  const view = {
    type: "modal",
    callback_id: CHECKIN_VIEW,
    title: plain(ts("title")),
    submit: plain(ts("save")),
    close: plain(ts("cancel")),
    private_metadata: JSON.stringify({ w: c.w.id, m: c.meeting.id, p: c.person.id, since: mine?.updatedAt ?? null } satisfies FormRef),
    blocks: [
      { type: "context", elements: [mrkdwn(esc([c.meeting.name, when].filter(Boolean).join(" · ")))] },
      ...c.rows.map((d, i) => {
        const value = initial(d);
        return {
          type: "input",
          block_id: `s:${d.key}`,
          optional: true,
          label: plain(labels[i]?.label ?? d.key, 2000),
          hint: plain(ts(`hint.${d.input}`), 2000),
          element: {
            type: "plain_text_input",
            action_id: "v",
            multiline: true,
            max_length: INPUT_MAX,
            ...(value ? { initial_value: value } : {}),
          },
        };
      }),
    ],
  };
  await open(view);
}

export type FormAnswer = { response_action: "errors"; errors: Record<string, string> } | { response_action: "update"; view: object };

/** The form sent: the check-in is saved like on the page, and the meeting's screens follow */
export async function submitCheckIn(p: {
  teamId: string;
  userId: string;
  metadata: string;
  values: Record<string, Record<string, { value?: string | null }>>;
}): Promise<FormAnswer> {
  let ref: Partial<FormRef> = {};
  try {
    ref = JSON.parse(p.metadata);
  } catch {}
  const [w] = typeof ref.w === "string" ? await slackWorkspaces(p.teamId, ref.w) : [];
  const c = w && typeof ref.m === "string" ? await formContext(w, p.userId, ref.m) : null;
  // Only the person the form was opened for can send it
  if (!c || c.person.id !== ref.p) {
    const locale = resolveLocale(w?.locale, env.defaultLocale());
    return { response_action: "update", view: notice(locale, esc(translator(locale, "slack")("notFound"))) };
  }
  const ts = translator(c.locale, "slack");
  const items: Record<string, string[]> = {};
  const errors: Record<string, string> = {};
  for (const d of c.rows) {
    const lines = linesOf(p.values[`s:${d.key}`]?.v?.value ?? "", d.input);
    if (lines.length > ITEMS_MAX) errors[`s:${d.key}`] = ts("tooMany", { max: ITEMS_MAX });
    else if (lines.some((l) => l.length > ITEM_MAX)) errors[`s:${d.key}`] = ts("itemTooLong", { max: ITEM_MAX });
    items[d.key] = lines;
  }
  if (Object.keys(errors).length) return { response_action: "errors", errors };
  const first = c.rows[0] ? `s:${c.rows[0].key}` : "";
  const changed = await c.db.$transaction(async (db) => {
    // Same turn-taking as the page: saves of one check-in wait for each other
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`checkin:${c.meeting.id}:${c.person.id}`}, 0))`;
    const head = await db.checkIn.findFirst({ where: { meetingId: c.meeting.id, personId: c.person.id }, select: { updatedAt: true } });
    if ((head?.updatedAt.getTime() ?? null) !== (ref.since ?? null)) return true;
    await saveCheckIn(db, { workspaceId: c.w.id, meetingId: c.meeting.id, personId: c.person.id }, checkInFromItems(items, c.rows), c.rows);
    return false;
  });
  if (changed)
    return first
      ? { response_action: "errors", errors: { [first]: ts("changed") } }
      : { response_action: "update", view: notice(c.locale, esc(ts("changed"))) };
  await publish(c.meeting.id, { kind: "state" });
  return { response_action: "update", view: notice(c.locale, `✅ ${esc(ts("saved", { team: c.meeting.name }))}`) };
}

// ---------- /ronde ----------

/** What "/ronde" answers (only to the person): their next sessions with the check-in to fill, their open actions */
export async function commandReply(teamId: string, slackId: string): Promise<object> {
  const base = env.appUrl();
  const blocks: object[] = [];
  let locale = env.defaultLocale();
  for (const w of await slackWorkspaces(teamId)) {
    const person = await personOf(w, slackId);
    if (!person) continue;
    locale = resolveLocale(person.locale, w.locale);
    const ts = translator(locale, "slack");
    const status = translator(locale, "actionStatus");
    const db = scoped(prisma, w.id);
    const seats = await db.meetingParticipant.findMany({
      where: { personId: person.id, active: true, role: { not: "observer" }, meeting: { archivedAt: null } },
      select: { meeting: { select: { id: true, name: true, locale: true } } },
      take: 20,
    });
    blocks.push({ type: "header", text: plain(w.name, 150) });
    for (const { meeting } of seats) {
      const rows = (await sectionsOf(db, meeting.id)).map(toSection);
      const [session, checkIns, last] = await Promise.all([
        db.session.findFirst({ where: { meetingId: meeting.id, status: "current" }, select: { date: true, time: true, startedAt: true } }),
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
      blocks.push({
        type: "section",
        text: mrkdwn(`*${esc(meeting.name)}* · ${esc(when)}\n${ready ? `✅ ${esc(ts("ready"))}` : `✏️ ${esc(ts("toFill"))}`}`),
        accessory: {
          type: "button",
          action_id: CHECKIN_ACTION,
          text: plain(ts("fillIn"), 75),
          value: JSON.stringify({ w: w.id, m: meeting.id }),
        },
      });
    }
    if (!seats.length) blocks.push({ type: "section", text: mrkdwn(esc(ts("noMeetings"))) });
    const actions = await db.action.findMany({
      where: { ownerId: person.id, status: { not: "done" }, meeting: { archivedAt: null } },
      orderBy: { createdAt: "asc" },
      select: { text: true, status: true },
      take: 11,
    });
    if (actions.length)
      blocks.push({
        type: "section",
        text: mrkdwn(`*${esc(ts("actions"))}*\n${bullets(actions.map((a) => `${plainItem(a.text)} (${status(a.status)})`))}`),
        ...(base
          ? { accessory: { type: "button", action_id: "ronde.open", text: plain(ts("openRonde"), 75), url: `${base}/w/${w.slug}/actions` } }
          : {}),
      });
    if (blocks.length >= 45) break;
  }
  const ts = translator(locale, "slack");
  if (!blocks.length) return { response_type: "ephemeral", text: ts("unknown") };
  return { response_type: "ephemeral", text: ts("summary"), blocks: blocks.slice(0, 50) };
}
