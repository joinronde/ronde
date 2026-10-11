"use client";

import { formatters, type Locale } from "@ronde/i18n";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { createTicketAction, setActionStatusAction } from "@/app/w/[ws]/actions";
import { FormAlert } from "@/components/auth/fields";
import { ExportCsv } from "@/components/export-csv";
import { PersonFace } from "@/components/person-face";
import type { ActionRow, ActionScope } from "@/lib/server/my-actions";
import { NewTab } from "../shell/new-tab";
import { Menu } from "./menu";

type Status = ActionRow["status"];

interface Props {
  slug: string;
  view: ActionScope;
  /** The person runs meetings: they also follow the actions of those meetings */
  hosts: boolean;
  me: string;
  actions: ActionRow[];
  /** Issue trackers where an action can become a ticket (Team) */
  trackers: { id: string; name: string; kind: string }[];
}

const tint = (color: number) => ({ "--c": `var(--c${color % 6})` }) as React.CSSProperties;

/** Follow-up actions across meetings, in progress first, ticked off in one click */
export function ActionsView({ slug, view, hosts, me, actions, trackers }: Props) {
  const t = useTranslations("actions");
  const router = useRouter();
  const [moved, setMoved] = useState<Record<string, Status>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meeting, setMeeting] = useState<string | null>(null);

  const rows = actions.map((a) => ({ ...a, status: moved[a.id] ?? a.status }));
  const meetings = [...new Map(rows.map((a) => [a.meetingId, { id: a.meetingId, name: a.meeting, color: a.color }])).values()];
  const shown = rows.filter((a) => !meeting || a.meetingId === meeting);

  const move = async (a: ActionRow, status: Status) => {
    setMoved((m) => ({ ...m, [a.id]: status }));
    setBusy(a.id);
    const res = await setActionStatusAction(slug, a.id, status);
    setBusy(null);
    if (!res.ok) {
      setMoved((m) => ({ ...m, [a.id]: a.status }));
      return setError(res.error);
    }
    setError(null);
    router.refresh();
  };

  const groups = (["doing", "open", "done"] as const).map((status) => ({ status, items: shown.filter((a) => a.status === status) }));
  const base = `/w/${slug}/actions`;
  return (
    <div className="page actions-page">
      <header className="page-head row">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted">{view === "mine" ? t("introMine") : t("introHosted")}</p>
        </div>
        {rows.length > 0 && (
          <div className="page-head-actions">
            {/* The file holds every action of the view, also those done before the two weeks the page keeps */}
            <ExportCsv
              name={t("csv.fileName")}
              href={`/api/w/${slug}/actions/export?${new URLSearchParams({ view, ...(meeting ? { meeting } : {}) })}`}
              title={t("csv.hint")}
            />
          </div>
        )}
      </header>
      {hosts && (
        <nav className="tabs settings-tabs" aria-label={t("views")}>
          <Link href={base} aria-current={view === "mine" ? "page" : undefined}>
            {t("mine")}
          </Link>
          <Link href={`${base}?view=hosted`} aria-current={view === "hosted" ? "page" : undefined}>
            {t("hosted")}
          </Link>
        </nav>
      )}
      <FormAlert>{error}</FormAlert>
      {rows.length === 0 ? (
        <div className="empty-state act-empty">
          <span className="act-empty-mark" aria-hidden="true">
            <CheckMark />
          </span>
          <p>{view === "mine" ? t("emptyMine") : t("emptyHosted")}</p>
          <p className="hint">{t("emptyHint")}</p>
        </div>
      ) : (
        <>
          <div className="act-bar">
            <p className="act-summary" aria-live="polite">
              {groups
                .filter((g) => g.items.length)
                .map((g) => (
                  <span key={g.status} className={`act-count ${g.status}`}>
                    {t(`count.${g.status}`, { count: g.items.length })}
                  </span>
                ))}
            </p>
            {meetings.length > 1 && (
              <div className="chips" role="group" aria-label={t("filter")}>
                <button type="button" className="chip" aria-pressed={!meeting} onClick={() => setMeeting(null)}>
                  {t("all")}
                </button>
                {meetings.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="chip act-chip"
                    style={tint(m.color)}
                    aria-pressed={meeting === m.id}
                    onClick={() => setMeeting(meeting === m.id ? null : m.id)}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          {groups.map(
            (g) =>
              g.items.length > 0 && (
                <section key={g.status} className="act-group" aria-labelledby={`act-${g.status}`}>
                  <h2 id={`act-${g.status}`}>
                    {t(`group.${g.status}`)} <span className="hint">{g.items.length}</span>
                  </h2>
                  <ul className="act-list">
                    {g.items.map((a) => (
                      <ActionItem
                        key={`${a.id}-${a.status}`}
                        a={a}
                        slug={slug}
                        showOwner={view === "hosted" && a.owner.id !== me}
                        busy={busy === a.id}
                        onMove={(s) => move(a, s)}
                        trackers={trackers}
                        onError={setError}
                      />
                    ))}
                  </ul>
                </section>
              ),
          )}
        </>
      )}
    </div>
  );
}

function CheckMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ActionItem({
  a,
  slug,
  showOwner,
  busy,
  onMove,
  trackers,
  onError,
}: {
  a: ActionRow;
  slug: string;
  showOwner: boolean;
  busy: boolean;
  onMove: (s: Status) => void;
  trackers: Props["trackers"];
  onError: (error: string | null) => void;
}) {
  const t = useTranslations("actions");
  const fmt = formatters(useLocale() as Locale);
  const router = useRouter();
  const done = a.status === "done";
  const [ticketing, setTicketing] = useState(false);
  const ticket = async (trackerId: string) => {
    setTicketing(true);
    const res = await createTicketAction(slug, a.id, trackerId);
    setTicketing(false);
    if (!res.ok) return onError(res.error);
    onError(null);
    router.refresh();
  };
  return (
    <li className={`act-row ${a.status}`} style={tint(a.color)}>
      <button
        type="button"
        className="act-check"
        aria-pressed={done}
        aria-label={done ? t("reopen", { text: a.text }) : t("markDone", { text: a.text })}
        title={done ? t("reopenShort") : t("markDoneShort")}
        disabled={busy}
        onClick={() => onMove(done ? "open" : "done")}
      >
        <CheckMark />
      </button>
      <div className="act-body">
        <p className="act-text">{a.text}</p>
        <p className="act-meta">
          <Link href={`/w/${slug}/m/${a.meetingId}`} className="act-meeting">
            <span className="act-dot" aria-hidden="true" />
            {a.meeting}
          </Link>
          {a.originDate && <span className="hint">{t("from", { date: fmt.dayMonth(a.originDate) })}</span>}
          {a.carried >= 2 && <span className="st-pill act-late">{t("carried", { count: a.carried })}</span>}
          {a.ticket && (
            <a href={a.ticket.url} target="_blank" rel="noopener" className="act-ticket" title={t("openTicket")}>
              🎫 {a.ticket.key}
              <NewTab />
            </a>
          )}
        </p>
      </div>
      {(showOwner || !done) && (
        <div className="act-side">
          {showOwner && (
            <span className="act-owner" title={a.owner.name}>
              <PersonFace slug={slug} person={a.owner} />
              <span className="act-owner-name">{a.owner.name}</span>
            </span>
          )}
          {!done && !a.ticket && trackers.length > 0 && (
            <Menu
              label={t("ticketFor", { text: a.text })}
              className="act-ticket-menu"
              onOpen={trackers.length === 1 ? () => void ticket(trackers[0]!.id) : undefined}
              button={<span className="btn sm ghost">{ticketing ? t("ticketing") : t("ticket")}</span>}
            >
              {(close) =>
                trackers.length === 1 ? (
                  <p className="hint menu-note">{t("ticketing")}</p>
                ) : (
                  <>
                    <p className="hint menu-note">{t("ticketWhere")}</p>
                    {trackers.map((tr) => (
                      <button
                        key={tr.id}
                        type="button"
                        className="menu-item"
                        onClick={() => {
                          close();
                          void ticket(tr.id);
                        }}
                      >
                        {tr.name}
                      </button>
                    ))}
                  </>
                )
              }
            </Menu>
          )}
          {!done && (
            <button
              type="button"
              className={`btn sm act-doing${a.status === "doing" ? " on" : ""}`}
              aria-pressed={a.status === "doing"}
              disabled={busy}
              onClick={() => onMove(a.status === "doing" ? "open" : "doing")}
            >
              {a.status === "doing" ? t("inProgress") : t("start")}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
