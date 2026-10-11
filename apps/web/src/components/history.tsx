"use client";

import { buildMinutes, type MinutesDoc, minutesToMarkdown } from "@ronde/core/minutes";
import type { HistoryItem } from "@ronde/core/types";
import { ago, MOODS, mmssPlain } from "@ronde/core/util";
import { formatters } from "@ronde/i18n";
import { MdEditor } from "@ronde/ui/md-editor";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { publishMinutesAction } from "@/app/w/[ws]/actions";
import { FormAlert } from "@/components/auth/fields";
import { Select } from "@/components/select";
import { withBasePath } from "@/lib/shared/base-path";
import { readWikiError } from "@/lib/shared/wiki-error";
import { copyText, downloadBlob, LoadError, Modal } from "./common";
import { MinutesView } from "./minutes-view";
import { markdownToPdf } from "./pdf";
import { useRonde } from "./ronde-provider";
import { Icon } from "./shell/icons";
import { NewTab } from "./shell/new-tab";

interface Page {
  items: HistoryItem[];
  more: boolean;
}

/**
 * Archived sessions, newest first, a page at a time. The minutes are built from each record in the language
 * picked here; the server searches every session.
 */
export function HistoryView() {
  const t = useTranslations("history");
  const { s, api, historyRev, toast } = useRonde();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const lang = s.settings.locale;
  const [copyBox, setCopyBox] = useState<string | null>(null);
  const [editing, setEditing] = useState<HistoryItem | null>(null);
  const [suggesting, setSuggesting] = useState<HistoryItem | null>(null);
  const [retry, setRetry] = useState(0);

  // The search waits for a pause in typing
  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim().length >= 2 ? q.trim() : ""), 300);
    return () => clearTimeout(id);
  }, [q]);

  const fetchPage = useCallback(
    async (before?: string): Promise<Page> => {
      const params = new URLSearchParams({ locale: lang });
      if (before) params.set("before", before);
      if (query) params.set("q", query);
      const r = await fetch(api(`/history?${params}`), { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      return (await r.json()) as Page;
    },
    [api, lang, query],
  );

  // First page, again after an archive or an edited summary (historyRev)
  useEffect(() => {
    let live = true;
    setError(false);
    fetchPage()
      .then((p) => {
        if (!live) return;
        setItems(p.items);
        setMore(p.more);
        setOpen((o) => o ?? p.items[0]?.date ?? null);
      })
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [fetchPage, historyRev, retry]);

  const loadMore = async () => {
    if (!items?.length) return;
    setLoadingMore(true);
    try {
      const p = await fetchPage(items[items.length - 1]!.date);
      setItems([...items, ...p.items]);
      setMore(p.more);
    } catch {
      toast(t("loadFailed"));
    }
    setLoadingMore(false);
  };

  const docs = useMemo(
    () => new Map((items ?? []).map((h) => [h.date, buildMinutes(h.record, lang, { summary: h.summary })])),
    [items, lang],
  );

  if (error) return <LoadError onRetry={() => setRetry((n) => n + 1)} />;
  if (!items) return <p className="loading">{t("loading")}</p>;
  if (!items.length && !query) return <div className="emptybox">{t("empty")}</div>;
  return (
    <div className="hist">
      <div className="hist-bar">
        <input
          type="search"
          placeholder={t("searchPlaceholder")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label={t("searchLabel")}
        />
        <span className="hint" role="status">
          {query ? t("found", { count: items.length }) : t("meetings", { count: items.length })}
        </span>
      </div>
      {!items.length && <div className="emptybox">{t("noMatch", { query })}</div>}
      {items.map((h) => (
        <HistCard
          key={h.date}
          h={h}
          doc={docs.get(h.date)!}
          open={open === h.date || (!!query && items.length === 1)}
          query={query}
          onToggle={() => setOpen(open === h.date ? "" : h.date)}
          onEdit={s.viewer.isHost ? () => setEditing(h) : undefined}
          onSuggest={s.ai ? () => setSuggesting(h) : undefined}
          onCopy={async () => {
            const md = minutesToMarkdown(docs.get(h.date)!);
            if (await copyText(md)) toast(t("copied"));
            else setCopyBox(md);
          }}
          onPdf={async () => {
            try {
              downloadBlob(
                `${t("fileName")}-${h.date}.pdf`,
                await markdownToPdf(minutesToMarkdown(docs.get(h.date)!), s.brand.logo && withBasePath(s.brand.logo)),
              );
            } catch {
              toast(t("pdfFailed"));
            }
          }}
        />
      ))}
      {more && (
        <div className="controls" style={{ justifyContent: "center" }}>
          <button type="button" className="btn" disabled={loadingMore} aria-busy={loadingMore} onClick={() => void loadMore()}>
            {t("loadMore")}
          </button>
        </div>
      )}
      {copyBox !== null && (
        <Modal onClose={() => setCopyBox(null)} labelledBy="copyBoxTitle">
          <h3 id="copyBoxTitle">{t("minutes")}</h3>
          <p className="hint">{t("copyManually")}</p>
          <textarea className="minutes-area" readOnly value={copyBox} onFocus={(e) => e.target.select()} />
          <div className="controls">
            <span className="sep" />
            <button type="button" className="btn" onClick={() => setCopyBox(null)}>
              {t("close")}
            </button>
          </div>
        </Modal>
      )}
      {editing && <SummaryEditor item={editing} onClose={() => setEditing(null)} />}
      {suggesting && <ActionSuggestions item={suggesting} onClose={() => setSuggesting(null)} />}
    </div>
  );
}

function HistCard({
  h,
  doc,
  open,
  query,
  onToggle,
  onEdit,
  onSuggest,
  onCopy,
  onPdf,
}: {
  h: HistoryItem;
  doc: MinutesDoc;
  open: boolean;
  query: string;
  onToggle: () => void;
  onEdit?: () => void;
  /** The AI assistant suggests follow-up actions from these minutes */
  onSuggest?: () => void;
  onCopy: () => void;
  onPdf: () => void;
}) {
  const t = useTranslations("history");
  const tMoods = useTranslations("moods");
  const locale = useLocale();
  const fmt = formatters(locale);
  const { now } = useRonde();
  const r = h.record;
  const blockerKeys = new Set(r.sections.filter((x) => x.role === "blocker").map((x) => x.key));
  const blockers = Object.values(r.checkIns).reduce((a, c) => a + c.items.filter((i) => blockerKeys.has(i.section)).length, 0);
  const acts = r.actions.filter((a) => a.status !== "done").length;
  const mood = r.mood?.avg != null ? MOODS[Math.min(4, Math.max(0, Math.round(r.mood.avg) - 1))] : null;
  const absent = r.absent.map((a) => a.name);
  return (
    <div className={"hcard" + (open ? " open" : "")}>
      <button type="button" className="hhead" aria-expanded={open} onClick={onToggle}>
        <span className="hdate">
          <span className="d">{fmt.dateShort(h.date)}</span>
          <span className="ago" suppressHydrationWarning>
            {ago(h.date, now(), locale)}
          </span>
        </span>
        <span className="hchips">
          <span className="hchip" title={t("duration")}>
            <Icon name="clock" size={14} />
            {mmssPlain(r.durationMs)}
          </span>
          <span className="hchip" title={absent.length ? t("absentList", { names: absent.join(", ") }) : t("participants")}>
            <Icon name="people" size={14} />
            {r.participants.length}
            {absent.length ? <span className="muted"> · {t("absentShort", { count: absent.length })}</span> : null}
          </span>
          {h.summary && (
            <span className="hchip" title={t("withSummary")}>
              <Icon name="note" size={14} />
              <span className="sr-only">{t("withSummary")}</span>
            </span>
          )}
          {blockers > 0 && (
            <span className="hchip warn" title={t("blockersHint")}>
              <Icon name="alert" size={14} />
              {t("blockers", { count: blockers })}
            </span>
          )}
          {acts > 0 && (
            <span className="hchip" title={t("actionsHint")}>
              <Icon name="todo" size={14} />
              {t("actions", { count: acts })}
            </span>
          )}
          {mood && (
            <span className="hchip" title={t("moodHint", { mood: tMoods(mood.key).toLowerCase(), avg: fmt.decimal(r.mood!.avg!) })}>
              <span aria-hidden="true">{mood.e}</span>
              {t("moodShort", { avg: fmt.decimal(r.mood!.avg!) })}
            </span>
          )}
        </span>
        <span className="hchev" aria-hidden="true">
          ›
        </span>
      </button>
      {open && (
        <div className="hbody">
          <div className="minutes-tools">
            {onEdit && (
              <button type="button" className="btn sm" onClick={onEdit}>
                {h.summary ? t("editSummary") : t("addSummary")}
              </button>
            )}
            {onSuggest && (
              <button type="button" className="btn sm ai-btn" onClick={onSuggest}>
                <Icon name="sparkles" size={15} /> {t("suggestActions")}
              </button>
            )}
            <button type="button" className="btn sm" onClick={onCopy}>
              {t("copyText")}
            </button>
            <button
              type="button"
              className="btn sm"
              onClick={() =>
                downloadBlob(`${t("fileName")}-${h.date}.md`, new Blob([minutesToMarkdown(doc)], { type: "text/markdown;charset=utf-8" }))
              }
            >
              Markdown
            </button>
            <button type="button" className="btn sm primary" onClick={onPdf}>
              PDF
            </button>
            <WikiTools h={h} />
          </div>
          <MinutesView doc={doc} id={h.date} query={query} />
          <TranscriptView date={h.date} />
        </div>
      )}
    </div>
  );
}

/** The session's page in the meeting's wiki (Team): published, to publish, or failed and to try again */
function WikiTools({ h }: { h: HistoryItem }) {
  const t = useTranslations("wikis");
  const { s, toast } = useRonde();
  const [busy, setBusy] = useState(false);
  const wiki = s.wikis?.current;
  if (!wiki) return null;
  const page = h.wiki;
  const send = async () => {
    setBusy(true);
    const res = await publishMinutesAction(s.context.workspace.slug, s.context.meetingId, h.date);
    setBusy(false);
    toast(res.ok ? t("history.done", { name: wiki.name }) : res.error, res.ok ? "ok" : "error");
  };
  return (
    <span className="wiki-tools">
      {page?.url && (
        <a className="btn sm" href={page.url} target="_blank" rel="noopener">
          {t("history.open", { name: wiki.name })}
          <NewTab />
        </a>
      )}
      <button type="button" className="btn sm" disabled={busy} aria-busy={busy} onClick={() => void send()}>
        {busy
          ? t("history.publishing")
          : page?.url
            ? t("history.update")
            : page?.error
              ? t("history.retry")
              : t("history.publish", { name: wiki.name })}
      </button>
      {page?.error && (
        <span className="wiki-failed" role="status">
          <Icon name="alert" size={14} />{" "}
          {t("history.failed", { error: t(`errors.${readWikiError(page.error).code}`, { detail: readWikiError(page.error).detail }) })}
        </span>
      )}
    </span>
  );
}

/** Summary of an archived session: the only part of the minutes written by hand, with the host notes */
function SummaryEditor({ item, onClose }: { item: HistoryItem; onClose: () => void }) {
  const t = useTranslations("history");
  const { rpc, s, api } = useRonde();
  const fmt = formatters(useLocale());
  const [text, setText] = useState(item.summary ?? "");
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const draft = async () => {
    setDrafting(true);
    setAiError(null);
    const res = await askAi(api, "summary", item.date);
    setDrafting(false);
    if ("error" in res) return setAiError(res.error);
    // What was already written is kept, the draft comes after it
    setText((current) => (current.trim() ? `${current.trim()}\n\n${res.summary}` : (res.summary ?? "")));
  };
  return (
    <Modal onClose={onClose} labelledBy="summaryTitle">
      <h3 id="summaryTitle">{t("summaryOf", { date: fmt.dateShort(item.date) })}</h3>
      <p className="hint">{t("summaryHint")}</p>
      {s.ai && (
        <div className="ai-row">
          <button type="button" className="btn sm ai-btn" onClick={() => void draft()} disabled={drafting} aria-busy={drafting}>
            <Icon name="sparkles" size={15} /> {drafting ? t("aiDrafting") : t("aiDraft")}
          </button>
          <span className="hint">{t("aiReview")}</span>
        </div>
      )}
      <FormAlert>{aiError}</FormAlert>
      <MdEditor id="historySummary" label={t("summary")} className="minutes-area" value={text} onChange={setText} />
      <div className="controls">
        <span className="sep" />
        <button type="button" className="btn" onClick={onClose}>
          {t("cancel")}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={busy}
          aria-busy={busy}
          onClick={async () => {
            setBusy(true);
            if (await rpc({ op: "history.summary", date: item.date, summary: text }, t("summarySaved"))) onClose();
            setBusy(false);
          }}
        >
          {t("save")}
        </button>
      </div>
    </Modal>
  );
}

type AiAnswer = { summary?: string; actions?: { text: string; ownerId: string | null }[] } | { error: string };

/** Asks the AI assistant about the minutes of an archived session */
async function askAi(api: (path: string) => string, task: "summary" | "actions", date: string): Promise<AiAnswer> {
  try {
    const res = await fetch(api("/ai"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, date }),
    });
    const body = (await res.json().catch(() => ({}))) as AiAnswer & { error?: string };
    return res.ok ? body : { error: body.error ?? "" };
  } catch {
    return { error: "" };
  }
}

/** Follow-up actions the AI assistant reads in the minutes: the host picks an owner and adds the ones to keep */
function ActionSuggestions({ item, onClose }: { item: HistoryItem; onClose: () => void }) {
  const t = useTranslations("history");
  const { s, api, rpc } = useRonde();
  const fmt = formatters(useLocale());
  const people = s.members.filter((m) => m.active && m.role !== "observer");
  const [list, setList] = useState<{ text: string; ownerId: string; added: boolean }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Asked once per opening: each request goes to the provider
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void askAi(api, "actions", item.date).then((res) => {
      if ("error" in res) return setError(res.error || t("aiFailed"));
      setList((res.actions ?? []).map((a) => ({ text: a.text, ownerId: a.ownerId ?? "", added: false })));
    });
  }, [api, item.date, t]);
  const add = async (i: number) => {
    const a = list![i]!;
    if (await rpc({ op: "action.add", text: a.text, ownerId: a.ownerId, originText: null }, t("aiAdded")))
      setList((l) => l!.map((x, k) => (k === i ? { ...x, added: true } : x)));
  };
  return (
    <Modal onClose={onClose} labelledBy="suggestTitle">
      <h3 id="suggestTitle">
        <Icon name="sparkles" size={15} /> {t("suggestOf", { date: fmt.dateShort(item.date) })}
      </h3>
      <FormAlert>{error}</FormAlert>
      {!list && !error && (
        <div className="ai-thinking" role="status">
          <span className="ai-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          {t("aiReading")}
        </div>
      )}
      {list && !list.length && <p className="hint">{t("aiNone")}</p>}
      {list && list.length > 0 && (
        <ul className="ai-list">
          {list.map((a, i) => (
            <li key={`${i}-${a.text}`} className={a.added ? "added" : undefined} style={{ "--i": i } as React.CSSProperties}>
              <p>{a.text}</p>
              <div className="ai-list-row">
                <Select
                  className="compact"
                  aria-label={t("aiOwner", { text: a.text })}
                  value={a.ownerId}
                  disabled={a.added}
                  onChange={(e) => setList((l) => l!.map((x, k) => (k === i ? { ...x, ownerId: e.target.value } : x)))}
                >
                  <option value="">{t("aiPickOwner")}</option>
                  {people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <button type="button" className="btn sm primary" disabled={a.added || !a.ownerId} onClick={() => void add(i)}>
                  {a.added ? `✓ ${t("aiAddedShort")}` : t("aiAdd")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="hint">{t("aiReview")}</p>
      <div className="controls">
        <span className="sep" />
        <button type="button" className="btn" onClick={onClose}>
          {t("close")}
        </button>
      </div>
    </Modal>
  );
}

type Line = { at: number; speaker: string | null; speakerId: string | null; text: string };

/** What was said during a session, turn by turn, when it was recorded */
function TranscriptView({ date }: { date: string }) {
  const t = useTranslations("transcript");
  const { api } = useRonde();
  const fmt = useFormatter();
  const [lines, setLines] = useState<Line[] | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(api(`/transcript?date=${date}`), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { lines: [] }))
      .then((b: { lines: Line[] }) => alive && setLines(b.lines))
      .catch(() => alive && setLines([]));
    return () => {
      alive = false;
    };
  }, [api, date]);
  if (!lines?.length) return null;
  return (
    <section className="transcript" aria-label={t("title")}>
      <button type="button" className="btn sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="mic" size={15} />
        {open ? t("hide") : t("show")}
      </button>
      {open && (
        <ol className="transcript-lines">
          {lines.map((l) => (
            <li key={`${l.at}-${l.speakerId ?? ""}`}>
              <span className="transcript-who">
                <strong>{l.speaker ?? t("others")}</strong>
                <span className="hint">{fmt.dateTime(l.at, { timeStyle: "short" })}</span>
              </span>
              <p>{l.text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
