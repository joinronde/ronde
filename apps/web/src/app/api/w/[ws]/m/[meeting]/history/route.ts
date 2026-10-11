import { buildMinutes, minutesToMarkdown } from "@ronde/core/minutes";
import { parseRecord } from "@ronde/core/record";
import type { HistoryItem } from "@ronde/core/types";
import { isLocale, resolveLocale } from "@ronde/i18n";
import { NextResponse } from "next/server";
import { meetingRoute } from "@/lib/server/meeting/route";
import { wikiPagesOf, wikisOn } from "@/lib/server/wikis";

export const dynamic = "force-dynamic";

const PAGE = 20;
/** Comparable text: lower case, no accents */
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Archived sessions of the meeting, newest first, a page at a time (?before=<date>). With ?q=, the sessions
// whose minutes (in ?locale=, otherwise the meeting's language) or summary contain the words.
export const GET = meetingRoute("history.read", async (ctx, req) => {
  const params = new URL(req.url).searchParams;
  const before = params.get("before");
  const q = fold(params.get("q")?.trim() ?? "");
  const asked = params.get("locale");
  const locale = isLocale(asked) ? asked : resolveLocale(ctx.meeting.locale, ctx.ws.workspace.locale);
  const rows = await ctx.ws.db.session.findMany({
    where: { meetingId: ctx.meeting.id, status: "archived", ...(before ? { date: { lt: before } } : {}) },
    orderBy: { date: "desc" },
    // A search reads every session (a few years of weekly sessions at most)
    take: q ? 520 : PAGE + 1,
    select: { id: true, date: true, record: true, summary: true, archivedAt: true },
  });
  // Where each session's minutes went in the meeting's wiki (Team)
  const pages = wikisOn(ctx.ws.workspace)
    ? await wikiPagesOf(
        ctx.ws.db,
        ctx.meeting,
        rows.map((r) => r.id),
      )
    : new Map();
  const items: HistoryItem[] = [];
  for (const r of rows) {
    const record = parseRecord(r.record);
    if (!record) continue;
    const page = pages.get(r.id);
    const item: HistoryItem = {
      date: r.date,
      record,
      summary: r.summary,
      archivedAt: r.archivedAt?.getTime() ?? null,
      wiki: page ? { url: page.url, error: page.error, publishedAt: page.publishedAt } : null,
    };
    if (q && !fold(minutesToMarkdown(buildMinutes(record, locale, { summary: r.summary }))).includes(q)) continue;
    items.push(item);
  }
  const more = items.length > PAGE;
  return NextResponse.json({ items: items.slice(0, PAGE), more }, { headers: { "Cache-Control": "no-store" } });
});
