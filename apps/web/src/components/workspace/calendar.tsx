"use client";

import * as Popover from "@radix-ui/react-popover";
import { formatters, type Locale } from "@ronde/i18n";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, LayoutGrid, List, Radio } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import type { CalendarEvent } from "@/lib/server/calendar-view";
import { byDay, dayCap, daysUntil, endTime } from "@/lib/shared/calendar";
import { addDays } from "@/lib/shared/schedule";
import { CalendarLink } from "../upcoming-sessions";

interface Props {
  slug: string;
  /** YYYY-MM */
  month: string;
  /** First and last day of the grid (whole weeks) */
  start: string;
  end: string;
  today: string;
  events: CalendarEvent[];
  upcoming: CalendarEvent[];
  prev: string;
  next: string;
}

const VIEW_KEY = "ronde:calendar-view";
/** Sessions a day's cell shows before folding the others into "+N" */
const PER_DAY = 3;
const tint = (color: number) => ({ "--c": `var(--c${color % 6})` }) as React.CSSProperties;
const keyOf = (e: CalendarEvent) => `${e.meetingId}-${e.date}-${e.time}`;

function EventChip({ e, slug }: { e: CalendarEvent; slug: string }) {
  const t = useTranslations("calendar");
  const tHolidays = useTranslations("holidays");
  return (
    <Link
      href={`/w/${slug}/m/${e.meetingId}`}
      className={`cal-event ${e.status}`}
      style={tint(e.color)}
      title={`${e.time}–${endTime(e.time, e.durationMin)} · ${e.meeting} · ${e.holiday ? tHolidays("skipped", { name: e.holiday }) : t(`status.${e.status}`)}`}
    >
      <span className="cal-time">
        {e.status === "live" && <span className="cal-live" aria-hidden="true" />}
        {e.time}
      </span>
      <span className="cal-name">
        {e.icon && (
          <span className="cal-icon" aria-hidden="true">
            {e.icon}
          </span>
        )}
        {e.meeting}
      </span>
      {e.holiday && <span className="cal-holiday">{e.holiday}</span>}
    </Link>
  );
}

/** A date as a tile: the day's number big, its weekday and month small */
function DateTile({ date, today }: { date: string; today: string }) {
  const locale = useLocale();
  const d = new Date(`${date}T12:00:00Z`);
  return (
    <span className={`cal-tile${date === today ? " today" : ""}`} aria-hidden="true">
      <span className="cal-tile-wd">{d.toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" })}</span>
      <strong>{d.getUTCDate()}</strong>
      <span className="cal-tile-mo">{d.toLocaleDateString(locale, { month: "short", timeZone: "UTC" })}</span>
    </span>
  );
}

/** The workspace calendar: a month of sessions or their agenda, the next ones beside it */
export function CalendarView({ slug, month, start, end, today, events, upcoming, prev, next }: Props) {
  const t = useTranslations("calendar");
  const locale = useLocale() as Locale;
  const fmt = formatters(locale);
  const [view, setView] = useState<"month" | "agenda">("month");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // The month or the agenda: a choice of this browser
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === "agenda") setView("agenda");
    } catch {}
  }, []);
  const pick = (v: "month" | "agenda") => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {}
  };
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  const title = new Date(`${month}-01T12:00:00Z`).toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const weekdays = days
    .slice(0, 7)
    .map((d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" }));
  // The meetings of the month, each a chip of the legend that hides or shows its sessions
  const meetings = [
    ...new Map(events.map((e) => [e.meetingId, { id: e.meetingId, name: e.meeting, color: e.color, icon: e.icon }])).values(),
  ];
  const shown = events.filter((e) => !hidden.has(e.meetingId));
  const toggle = (id: string) =>
    setHidden((h) => {
      const n = new Set(h);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const agenda = byDay(shown.filter((e) => e.date.slice(0, 7) === month));
  return (
    <div className="page calendar">
      <header className="page-head row">
        <div className="page-title-with-ico">
          <span className="page-ico" aria-hidden="true">
            <CalendarDays size={22} strokeWidth={2} />
          </span>
          <div>
            <h1>{t("title")}</h1>
            <p className="muted">{t("intro")}</p>
          </div>
        </div>
        <CalendarLink personal />
      </header>
      <div className="cal-layout">
        <section className="panel cal-month" aria-labelledby="cal-title">
          <div className="cal-head">
            <nav className="cal-nav" aria-label={t("months")}>
              <Link className="cal-arrow" href={`/w/${slug}/calendar?month=${prev}`} aria-label={t("previous")}>
                <ChevronLeft size={18} strokeWidth={2.2} aria-hidden="true" className="flip-rtl" />
              </Link>
              <h2 id="cal-title">{title.charAt(0).toUpperCase() + title.slice(1)}</h2>
              <Link className="cal-arrow" href={`/w/${slug}/calendar?month=${next}`} aria-label={t("next")}>
                <ChevronRight size={18} strokeWidth={2.2} aria-hidden="true" className="flip-rtl" />
              </Link>
            </nav>
            <span className="cal-tools">
              {month !== today.slice(0, 7) && (
                <Link className="btn sm" href={`/w/${slug}/calendar`}>
                  {t("today")}
                </Link>
              )}
              <span className="seg" role="group" aria-label={t("view")}>
                <button type="button" aria-pressed={view === "month"} onClick={() => pick("month")}>
                  <LayoutGrid size={15} strokeWidth={2} aria-hidden="true" /> {t("viewMonth")}
                </button>
                <button type="button" aria-pressed={view === "agenda"} onClick={() => pick("agenda")}>
                  <List size={15} strokeWidth={2} aria-hidden="true" /> {t("viewAgenda")}
                </button>
              </span>
            </span>
          </div>
          {meetings.length > 1 && (
            <div className="cal-legend" role="group" aria-label={t("legend")}>
              {meetings.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="cal-legend-chip"
                  style={tint(m.color)}
                  aria-pressed={!hidden.has(m.id)}
                  title={hidden.has(m.id) ? t("showMeeting", { name: m.name }) : t("hideMeeting", { name: m.name })}
                  onClick={() => toggle(m.id)}
                >
                  <span className="cal-legend-dot" aria-hidden="true" />
                  {m.name}
                </button>
              ))}
            </div>
          )}
          {view === "month" ? (
            <div key={month} className="cal-grid" role="grid" aria-labelledby="cal-title">
              <div className="cal-row" role="row">
                {weekdays.map((w, i) => (
                  <div key={w} className={`cal-weekday${i >= 5 ? " weekend" : ""}`} role="columnheader">
                    {w}
                  </div>
                ))}
              </div>
              {Array.from({ length: days.length / 7 }, (_, row) => (
                <div key={days[row * 7]} className="cal-row" role="row">
                  {days.slice(row * 7, row * 7 + 7).map((d, i) => {
                    const list = shown.filter((e) => e.date === d);
                    const { shown: fit, more } = dayCap(list, PER_DAY);
                    const out = d.slice(0, 7) !== month;
                    return (
                      <div
                        key={d}
                        role="gridcell"
                        className={`cal-day${out ? " out" : ""}${d === today ? " today" : ""}${d < today ? " past" : ""}${i >= 5 ? " weekend" : ""}`}
                        aria-label={fmt.date(d)}
                      >
                        <span className="cal-num">{Number(d.slice(8))}</span>
                        {fit.map((e) => (
                          <EventChip key={keyOf(e)} e={e} slug={slug} />
                        ))}
                        {more > 0 && (
                          <Popover.Root>
                            <Popover.Trigger asChild>
                              <button type="button" className="cal-more">
                                {t("more", { count: more })}
                              </button>
                            </Popover.Trigger>
                            <Popover.Portal>
                              <Popover.Content className="cal-pop" sideOffset={6} collisionPadding={12}>
                                <strong className="cal-pop-title">{fmt.dateShort(d)}</strong>
                                {list.map((e) => (
                                  <EventChip key={keyOf(e)} e={e} slug={slug} />
                                ))}
                              </Popover.Content>
                            </Popover.Portal>
                          </Popover.Root>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : agenda.length ? (
            <ol className="cal-agenda">
              {agenda.map((day) => (
                <li key={day.date} className={`cal-agenda-day${day.date < today ? " past" : ""}`}>
                  <DateTile date={day.date} today={today} />
                  <ul>
                    {day.items.map((e) => (
                      <li key={keyOf(e)} className={`cal-agenda-item ${e.status}`} style={tint(e.color)}>
                        <span className="cal-agenda-time">
                          <Clock size={13} strokeWidth={2} aria-hidden="true" />
                          {e.time}–{endTime(e.time, e.durationMin)}
                        </span>
                        <Link href={`/w/${slug}/m/${e.meetingId}`} className="cal-agenda-name">
                          {e.icon && <span aria-hidden="true">{e.icon}</span>}
                          {e.meeting}
                        </Link>
                        <span className={`cal-status ${e.status}`}>
                          {e.status === "live" && <Radio size={12} strokeWidth={2.4} aria-hidden="true" />}
                          {e.holiday ?? t(`status.${e.status}`)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty-state">{t("nothingThisMonth")}</p>
          )}
        </section>
        <aside className="panel cal-next" aria-labelledby="cal-next-title">
          <h2 id="cal-next-title">{t("upcoming")}</h2>
          {upcoming.length ? (
            <ol className="cal-list">
              {upcoming.map((e) => {
                const inDays = daysUntil(e.date, today);
                return (
                  <li key={keyOf(e)} style={tint(e.color)}>
                    <DateTile date={e.date} today={today} />
                    <Link href={`/w/${slug}/m/${e.meetingId}`}>
                      <strong>
                        {e.icon && <span aria-hidden="true">{e.icon} </span>}
                        {e.meeting}
                      </strong>
                      <span className="hint">
                        {e.status === "live"
                          ? t("status.live")
                          : `${e.time} · ${inDays === 0 ? t("todayShort") : inDays === 1 ? t("tomorrow") : t("inDays", { count: inDays })}`}
                      </span>
                    </Link>
                    {e.attendance && (
                      <span className={`st-pill ${e.attendance === "yes" ? "st-done" : "st-open"}`}>{t(`attendance.${e.attendance}`)}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="hint">{t("nothing")}</p>
          )}
        </aside>
      </div>
    </div>
  );
}
