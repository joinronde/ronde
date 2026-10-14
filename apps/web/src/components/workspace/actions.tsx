"use client";

import { formatters, type Locale } from "@ronde/i18n";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheckBig,
  CircleDashed,
  Clapperboard,
  Columns3,
  Hourglass,
  List,
  ListTodo,
  type LucideIcon,
  PlayCircle,
  Search,
  Ticket,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { createTicketAction, setActionStatusAction } from "@/app/w/[ws]/actions";
import { FormAlert } from "@/components/auth/fields";
import { ExportCsv } from "@/components/export-csv";
import { EmptyHero } from "@/components/illustration";
import { PersonFace } from "@/components/person-face";
import { Select } from "@/components/select";
import type { ActionRow, ActionScope } from "@/lib/server/my-actions";
import { type ActionColumn, columnsOf, filterActions, isStuck, nextColumn } from "@/lib/shared/actions-board";
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
const LAYOUT_KEY = "ronde:actions-layout";
const COLUMN_ICONS: Record<ActionColumn, LucideIcon> = { open: CircleDashed, doing: PlayCircle, done: CircleCheckBig };

/** Follow-up actions across meetings, as a list or as a board, ticked off in one click or moved between columns */
export function ActionsView({ slug, view, hosts, me, actions, trackers }: Props) {
  const t = useTranslations("actions");
  const router = useRouter();
  const [moved, setMoved] = useState<Record<string, Status>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [meeting, setMeeting] = useState<string>("");
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState<"list" | "board">("list");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  // The list or the board: a choice of this browser, kept from one visit to the next
  useEffect(() => {
    try {
      if (localStorage.getItem(LAYOUT_KEY) === "board") setLayout("board");
    } catch {}
  }, []);
  const pickLayout = (next: "list" | "board") => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
    } catch {}
  };

  const rows = actions.map((a) => ({ ...a, status: moved[a.id] ?? a.status }));
  const meetings = [...new Map(rows.map((a) => [a.meetingId, { id: a.meetingId, name: a.meeting, color: a.color }])).values()];
  const shown = filterActions(rows, meeting || null, query);
  const columns = columnsOf(shown);
  const stuck = shown.filter(isStuck).length;

  const move = async (a: ActionRow, status: Status) => {
    if (a.status === status) return;
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

  const base = `/w/${slug}/actions`;
  const item = (a: ActionRow & { status: Status }) => ({
    a,
    slug,
    showOwner: view === "hosted" && a.owner.id !== me,
    busy: busy === a.id,
    onMove: (s: Status) => move(a, s),
    trackers,
    onError: setError,
  });
  return (
    <div className="page actions-page">
      <header className="page-head row">
        <div className="page-title-with-ico">
          <span className="page-ico" aria-hidden="true">
            <ListTodo size={22} strokeWidth={2} />
          </span>
          <div>
            <h1>{t("title")}</h1>
            <p className="muted">{view === "mine" ? t("introMine") : t("introHosted")}</p>
          </div>
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
            <UserRound size={16} strokeWidth={2} aria-hidden="true" />
            {t("mine")}
          </Link>
          <Link href={`${base}?view=hosted`} aria-current={view === "hosted" ? "page" : undefined}>
            <Clapperboard size={16} strokeWidth={2} aria-hidden="true" />
            {t("hosted")}
          </Link>
        </nav>
      )}
      <FormAlert>{error}</FormAlert>
      {rows.length === 0 ? (
        <EmptyHero art="actions" title={view === "mine" ? t("emptyMine") : t("emptyHosted")} hint={t("emptyHint")} />
      ) : (
        <>
          {/* At a glance: what is to do, in progress, done lately, and what waits too long */}
          <div className="act-kpis">
            {columns.map((c) => {
              const KpiIcon = COLUMN_ICONS[c.status];
              return (
                <div key={c.status} className={`act-kpi ${c.status}`}>
                  <span className="act-kpi-ico" aria-hidden="true">
                    <KpiIcon size={18} strokeWidth={2.2} />
                  </span>
                  <strong>{c.items.length}</strong>
                  <span>{t(`group.${c.status}`)}</span>
                </div>
              );
            })}
            <div className={`act-kpi stuck${stuck ? " on" : ""}`}>
              <span className="act-kpi-ico" aria-hidden="true">
                <Hourglass size={18} strokeWidth={2.2} />
              </span>
              <strong>{stuck}</strong>
              <span>{t("stuck")}</span>
            </div>
          </div>
          <div className="act-toolbar">
            <label className="search-input">
              <Search size={16} strokeWidth={2} aria-hidden="true" />
              <input
                type="search"
                value={query}
                placeholder={t("search")}
                aria-label={t("search")}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {meetings.length > 1 && (
              <Select className="compact act-filter" aria-label={t("filter")} value={meeting} onChange={(e) => setMeeting(e.target.value)}>
                <option value="">{t("allMeetings")}</option>
                {meetings.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            )}
            <span className="seg act-layout" role="group" aria-label={t("layout")}>
              <button type="button" aria-pressed={layout === "list"} onClick={() => pickLayout("list")}>
                <List size={16} strokeWidth={2} aria-hidden="true" /> {t("layoutList")}
              </button>
              <button type="button" aria-pressed={layout === "board"} onClick={() => pickLayout("board")}>
                <Columns3 size={16} strokeWidth={2} aria-hidden="true" /> {t("layoutBoard")}
              </button>
            </span>
          </div>
          {shown.length === 0 && <p className="empty-state">{t("noMatch")}</p>}
          {layout === "list" ? (
            columns.map(
              (g) =>
                g.items.length > 0 && (
                  <section key={g.status} className="act-group" aria-labelledby={`act-${g.status}`}>
                    <h2 id={`act-${g.status}`} className={`act-group-title ${g.status}`}>
                      {g.status === "done" ? t("group.doneLately") : t(`group.${g.status}`)} <span className="act-n">{g.items.length}</span>
                    </h2>
                    <ul className="act-list">
                      {g.items.map((a) => (
                        <ActionItem key={`${a.id}-${a.status}`} {...item(a)} />
                      ))}
                    </ul>
                  </section>
                ),
            )
          ) : (
            <div className="act-board">
              {columns.map((c) => {
                const ColIcon = COLUMN_ICONS[c.status];
                return (
                  <section
                    key={c.status}
                    className={`act-col ${c.status}${over === c.status && dragging ? " over" : ""}`}
                    aria-labelledby={`col-${c.status}`}
                    onDragOver={(e) => {
                      if (!dragging) return;
                      e.preventDefault();
                      setOver(c.status);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const a = rows.find((x) => x.id === dragging);
                      setDragging(null);
                      setOver(null);
                      if (a) void move(a, c.status);
                    }}
                  >
                    <h2 id={`col-${c.status}`} className="act-col-head">
                      <ColIcon size={16} strokeWidth={2.2} aria-hidden="true" />
                      {c.status === "done" ? t("group.doneLately") : t(`group.${c.status}`)}
                      <span className="act-n">{c.items.length}</span>
                    </h2>
                    <ul className="act-cards">
                      {c.items.map((a) => (
                        <ActionCard key={a.id} {...item(a)} dragging={dragging === a.id} onDrag={(on) => setDragging(on ? a.id : null)} />
                      ))}
                      {c.items.length === 0 && <li className="act-col-empty">{t("dropHere")}</li>}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** An action on the board: dragged to another column, or moved with its arrows (keyboard, touch screens) */
function ActionCard({
  a,
  slug,
  showOwner,
  busy,
  onMove,
  dragging,
  onDrag,
}: {
  a: ActionRow;
  slug: string;
  showOwner: boolean;
  busy: boolean;
  onMove: (s: Status) => void;
  trackers: Props["trackers"];
  onError: (error: string | null) => void;
  dragging: boolean;
  onDrag: (on: boolean) => void;
}) {
  const t = useTranslations("actions");
  const fmt = formatters(useLocale() as Locale);
  return (
    <li
      className={`act-card ${a.status}${dragging ? " dragging" : ""}${isStuck(a) ? " stuck" : ""}`}
      style={tint(a.color)}
      draggable={!busy}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", a.text);
        onDrag(true);
      }}
      onDragEnd={() => onDrag(false)}
    >
      <p className="act-text">{a.text}</p>
      <p className="act-meta">
        <Link href={`/w/${slug}/m/${a.meetingId}`} className="act-meeting">
          <span className="act-dot" aria-hidden="true" />
          {a.meeting}
        </Link>
        {a.originDate && <span className="hint">{fmt.dayMonth(a.originDate)}</span>}
        {isStuck(a) && <span className="st-pill act-late">{t("carried", { count: a.carried })}</span>}
        {a.ticket && (
          <a href={a.ticket.url} target="_blank" rel="noopener" className="act-ticket" title={t("openTicket")}>
            <Ticket size={13} strokeWidth={2} aria-hidden="true" /> {a.ticket.key}
          </a>
        )}
      </p>
      <div className="act-card-foot">
        {showOwner ? <PersonFace slug={slug} person={a.owner} title={a.owner.name} /> : <span />}
        <span className="act-card-moves">
          <button
            type="button"
            className="icon-btn"
            disabled={busy || a.status === "open"}
            aria-label={t("moveTo", { text: a.text, column: t(`group.${nextColumn(a.status, -1)}`) })}
            onClick={() => onMove(nextColumn(a.status, -1))}
          >
            <ChevronLeft size={14} strokeWidth={2.2} aria-hidden="true" className="flip-rtl" />
          </button>
          <button
            type="button"
            className="icon-btn"
            disabled={busy || a.status === "done"}
            aria-label={t("moveTo", { text: a.text, column: t(`group.${nextColumn(a.status, 1)}`) })}
            onClick={() => onMove(nextColumn(a.status, 1))}
          >
            <ChevronRight size={14} strokeWidth={2.2} aria-hidden="true" className="flip-rtl" />
          </button>
        </span>
      </div>
    </li>
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
              <Ticket size={13} strokeWidth={2} aria-hidden="true" /> {a.ticket.key}
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
