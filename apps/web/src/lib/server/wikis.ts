import "server-only";
import { buildMinutes, minutesToMarkdown } from "@ronde/core/minutes";
import { parseRecord } from "@ronde/core/record";
import { type Prisma, prisma, scoped } from "@ronde/db";
import type { WikiAccess, WikiKind } from "@ronde/editions/ee";
import { resolveLocale, translator } from "@ronde/i18n";
import { z } from "zod";
import { enterprise } from "@/ee-bridge";
import { readWikiError, wikiErrorOf } from "@/lib/shared/wiki-error";
import { audit } from "./audit";
import type { WorkspaceContext } from "./authz";
import { publish } from "./bus";
import { AccessError, OpError } from "./errors";
import { featureOn, type PlanScope } from "./license";
import { requestLocale } from "./locale";
import type { MeetingCtx } from "./meeting/context";
import { outboundFetch } from "./outbound";
import { publicUrl } from "./public-url";
import { canEncrypt, decryptSecret, encryptSecret } from "./secrets";

// Wikis (Team): the minutes of each archived session become a page in Notion or in Confluence, replaced when
// the host edits the summary or publishes again

export const wikisOn = (ws: PlanScope) => featureOn("integrations.wikis", ws);

export const WIKI_KINDS = ["notion", "confluence"] as const;

/** A Notion page id, alone or at the end of the page's address (32 hexadecimal digits, dashes or not) */
const notionPage = (v: string) => /[0-9a-f]{32}(?:[?#].*)?$/i.test(v.replace(/-/g, ""));
const atlassianCloud = (site: string) => {
  try {
    return new URL(site).hostname.endsWith(".atlassian.net");
  } catch {
    return false;
  }
};

/** What each wiki needs to know where pages go */
const CONFIG: Record<WikiKind, z.ZodType<Record<string, string>>> = {
  notion: z.object({ parent: z.string().trim().max(500).refine(notionPage, "the parent page address") }),
  confluence: z
    .object({
      site: z.string().trim().url().max(200),
      space: z
        .string()
        .trim()
        .regex(/^~?[A-Za-z0-9_-]{1,255}$/, "the space key"),
      parent: z
        .string()
        .trim()
        .max(500)
        .default("")
        .refine((v) => !v || /\d/.test(v), "the parent page"),
      email: z.string().trim().max(200).default(""),
    })
    // Confluence Cloud signs in with the account's email and an API token; a Data Center with a token alone
    .refine((c) => !atlassianCloud(c.site) || z.string().email().safeParse(c.email).success, {
      message: "the email of the account",
      path: ["email"],
    }),
};

export interface WikiView {
  id: string;
  kind: WikiKind;
  name: string;
  config: Record<string, string>;
}

export interface WikiInput {
  id?: string;
  kind: WikiKind;
  name: string;
  config: Record<string, string>;
  /** Empty: keep the saved token */
  token?: string;
}

/** Where a session's minutes were published, for its history */
export interface WikiPageView {
  wiki: string;
  kind: WikiKind;
  url: string;
  error: string;
  publishedAt: number;
}

export async function listWikis(ctx: WorkspaceContext): Promise<WikiView[]> {
  const rows = await ctx.db.wiki.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, config: r.config as Record<string, string> }));
}

export async function saveWiki(ctx: WorkspaceContext, input: WikiInput): Promise<{ id: string }> {
  if (!WIKI_KINDS.includes(input.kind)) throw new OpError("invalidRequest");
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new OpError("nameRequired");
  const config = CONFIG[input.kind].safeParse(input.config);
  if (!config.success) throw new OpError("connectorInvalid", { detail: config.error.issues[0]?.message ?? "" });
  const existing = input.id ? await ctx.db.wiki.findFirst({ where: { id: input.id } }) : null;
  if (input.id && !existing) throw new OpError("notFound");
  const token = input.token?.trim();
  if (!token && !existing?.secret) throw new OpError("connectorSecretRequired");
  if (token && !canEncrypt()) throw new OpError("encryptionNotConfigured");
  const data = {
    name,
    config: config.data as Prisma.InputJsonObject,
    ...(token ? { secret: encryptSecret(token.slice(0, 500)) } : {}),
  };
  const row = existing
    ? await ctx.db.wiki.update({ where: { id: existing.id }, data })
    : await ctx.db.wiki.create({ data: { ...data, workspaceId: ctx.workspace.id, kind: input.kind } });
  await audit(ctx, ctx.db, {
    action: existing ? "wikis.update" : "wikis.add",
    targetType: "wiki",
    targetId: row.id,
    data: { kind: input.kind },
  });
  return { id: row.id };
}

/** Removes a wiki: meetings stop publishing there, the pages already published stay in it */
export async function deleteWiki(ctx: WorkspaceContext, id: string): Promise<void> {
  await ctx.db.meeting.updateMany({ where: { wikiId: id }, data: { wikiId: null } });
  await ctx.db.wiki.deleteMany({ where: { id } });
  await audit(ctx, ctx.db, { action: "wikis.delete", targetType: "wiki", targetId: id });
}

const access = (row: { kind: WikiKind; config: unknown; secret: string }): WikiAccess => ({
  kind: row.kind,
  config: row.config as Record<string, string>,
  token: decryptSecret(row.secret),
  fetch: outboundFetch,
});

/** Checks a wiki's token and destination; a refusal is thrown in the person's language */
export async function testWiki(ctx: WorkspaceContext, id: string): Promise<void> {
  const row = await ctx.db.wiki.findFirst({ where: { id } });
  if (!row) throw new OpError("notFound");
  const res = await enterprise.wikis.test(access(row));
  if (!res.ok) throw await wikiFailed(`${res.code}${res.detail ? `:${res.detail}` : ""}`);
}

/** The error of a wiki's refusal, in the language of the request */
export async function wikiFailed(stored: string): Promise<OpError> {
  const { code, detail } = readWikiError(stored);
  return new OpError("wikiFailed", { detail: translator(await requestLocale(), "wikis")(`errors.${code}`, { detail }) });
}

/** The wiki where a meeting publishes its minutes at each archive (null: none) */
export async function setMeetingWiki(m: MeetingCtx, wikiId: string | null): Promise<void> {
  if (!wikisOn(m.ws.workspace)) throw new AccessError(403, "featureNotInPlan");
  if (!m.can("meeting.configure")) throw new AccessError(403, "accessDenied");
  if (wikiId && !(await m.ws.db.wiki.findFirst({ where: { id: wikiId }, select: { id: true } }))) throw new OpError("notFound");
  const meetingId = m.meeting.id;
  await m.ws.db.meeting.update({ where: { id: meetingId }, data: { wikiId } });
  await audit(m.ws, m.ws.db, { action: "wikis.meeting", targetType: "meeting", targetId: meetingId, meetingId, data: { wikiId } });
  await publish(meetingId, { kind: "state" });
}

/**
 * Publishes the minutes of an archived session to its meeting's wiki, or updates the page published before.
 * `onlyUpdate`: only when a page exists already (the host edited the summary). Failures are kept on the page's
 * row, for the history to show; returns the page, or null when the meeting publishes nowhere.
 */
export async function publishSession(sessionId: string, { onlyUpdate = false } = {}): Promise<WikiPageView | null> {
  const s = await prisma.session.findFirst({
    // A draft of the minutes goes nowhere until it is published
    where: { id: sessionId, status: "archived", minutesPublishedAt: { not: null } },
    select: {
      id: true,
      date: true,
      summary: true,
      record: true,
      workspaceId: true,
      meeting: {
        select: {
          id: true,
          name: true,
          locale: true,
          wikiId: true,
          sample: true,
          workspace: { select: { slug: true, locale: true, plan: true } },
        },
      },
    },
  });
  const record = parseRecord(s?.record);
  // A sample meeting sends nothing anywhere
  if (!s || !record || !s.meeting.wikiId || s.meeting.sample || !wikisOn(s.meeting.workspace)) return null;
  const db = scoped(prisma, s.workspaceId);
  const wiki = await db.wiki.findFirst({ where: { id: s.meeting.wikiId } });
  if (!wiki) return null;
  const existing = await db.wikiPage.findUnique({ where: { sessionId_wikiId: { sessionId: s.id, wikiId: wiki.id } } });
  if (onlyUpdate && !existing?.pageId) return null;
  const locale = resolveLocale(s.meeting.locale, s.meeting.workspace.locale);
  // The page is named by its date first, so that a wiki listing its pages by name keeps them in order
  const markdown = minutesToMarkdown(buildMinutes(record, locale, { summary: s.summary }))
    .split("\n")
    .slice(1)
    .join("\n")
    .trim();
  const doc = {
    title: `${s.date} · ${s.meeting.name}`,
    markdown,
    link: {
      label: translator(locale, "wikis")("openInRonde"),
      url: await publicUrl(`/w/${s.meeting.workspace.slug}/m/${s.meeting.id}/history`),
    },
  };
  const where = { sessionId_wikiId: { sessionId: s.id, wikiId: wiki.id } };
  try {
    const page = await enterprise.wikis.publish(access(wiki), doc, existing?.pageId ? { id: existing.pageId, url: existing.url } : null);
    const data = { pageId: page.id, url: page.url, error: "", publishedAt: new Date() };
    await db.wikiPage.upsert({ where, update: data, create: { ...data, workspaceId: s.workspaceId, wikiId: wiki.id, sessionId: s.id } });
    return { wiki: wiki.name, kind: wiki.kind, url: page.url, error: "", publishedAt: data.publishedAt.getTime() };
  } catch (e) {
    // Kept as a code the history translates, with what the wiki said
    const error = wikiErrorOf(e);
    console.error(`[wikis] publishing session ${s.id} to ${wiki.kind} failed`, e);
    await db.wikiPage.upsert({ where, update: { error }, create: { error, workspaceId: s.workspaceId, wikiId: wiki.id, sessionId: s.id } });
    return { wiki: wiki.name, kind: wiki.kind, url: existing?.url ?? "", error, publishedAt: existing?.publishedAt.getTime() ?? 0 };
  } finally {
    await publish(s.meeting.id, { kind: "history" });
  }
}

/** The pages of these sessions in the meeting's wiki, by session id */
export async function wikiPagesOf(
  db: WorkspaceContext["db"],
  meeting: { wikiId: string | null },
  sessionIds: string[],
): Promise<Map<string, WikiPageView>> {
  if (!meeting.wikiId || !sessionIds.length) return new Map();
  const pages = await db.wikiPage.findMany({
    where: { wikiId: meeting.wikiId, sessionId: { in: sessionIds } },
    include: { wiki: { select: { name: true, kind: true } } },
  });
  return new Map(
    pages.map((p) => [
      p.sessionId,
      { wiki: p.wiki.name, kind: p.wiki.kind, url: p.url, error: p.error, publishedAt: p.publishedAt.getTime() },
    ]),
  );
}
