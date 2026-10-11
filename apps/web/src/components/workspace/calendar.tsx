"use client";

import { formatters, type Locale } from "@ronde/i18n";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { CalendarEvent } from "@/lib/server/calendar-view";
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

const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function EventChip({ e, slug }: { e: CalendarEvent; slug: string }) {
  const t = useTranslations("calendar");
  const tHolidays = useTranslations("holidays");
  return (
    <Link
      href={`/w/${slug}/m/${e.meetingId}`}
      className={`cal-event ${e.status}`}
      style={{ "--c": `var(--c${e.color % 6})` } as React.CSSProperties}
      title={`${e.time} · ${e.meeting} · ${e.holiday ? tHolidays("skipped", { name: e.holiday }) : t(`status.${e.status}`)}`}
    >
      <span className="cal-time">
        {e.status === "live" && <span className="cal-live" aria-hidden="true" />}
        {e.time}
      </span>
      <span className="cal-name">{e.meeting}</span>
      {e.holiday && <span className="cal-holiday">{e.holiday}</span>}
    </Link>
  );
}

/** The workspace calendar: a month of sessions, and the next ones beside it */
export function CalendarView({ slug, month, start, end, today, events, upcoming, prev, next }: Props) {
  const t = useTranslations("calendar");
  const locale = useLocale() as Locale;
  const fmt = formatters(locale);
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  const title = new Date(`${month}-01T12:00:00Z`).toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const weekdays = days
    .slice(0, 7)
    .map((d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" }));
  return (
    <div className="page calendar">
      <header className="page-head row">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted">{t("intro")}</p>
        </div>
        <CalendarLink personal />
      </header>
      <div className="cal-layout">
        <section className="panel cal-month" aria-labelledby="cal-title">
          <div className="cal-head">
            <h2 id="cal-title">{title.charAt(0).toUpperCase() + title.slice(1)}</h2>
            <nav className="controls" aria-label={t("months")}>
              <Link className="btn sm" href={`/w/${slug}/calendar?month=${prev}`} aria-label={t("previous")}>
                ←
              </Link>
              <Link className="btn sm" href={`/w/${slug}/calendar`}>
                {t("today")}
              </Link>
              <Link className="btn sm" href={`/w/${slug}/calendar?month=${next}`} aria-label={t("next")}>
                →
              </Link>
            </nav>
          </div>
          <div key={month} className="cal-grid" role="grid" aria-labelledby="cal-title">
            <div className="cal-row" role="row">
              {weekdays.map((w) => (
                <div key={w} className="cal-weekday" role="columnheader">
                  {w}
                </div>
              ))}
            </div>
            {Array.from({ length: days.length / 7 }, (_, row) => (
              <div key={days[row * 7]} className="cal-row" role="row">
                {days.slice(row * 7, row * 7 + 7).map((d) => {
                  const list = events.filter((e) => e.date === d);
                  const out = d.slice(0, 7) !== month;
                  return (
                    <div
                      key={d}
                      role="gridcell"
                      className={`cal-day${out ? " out" : ""}${d === today ? " today" : ""}`}
                      aria-label={fmt.date(d)}
                    >
                      <span className="cal-num">{Number(d.slice(8))}</span>
                      {list.map((e) => (
                        <EventChip key={`${e.meetingId}-${e.date}-${e.time}`} e={e} slug={slug} />
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
        <aside className="panel cal-next" aria-labelledby="cal-next-title">
          <h2 id="cal-next-title">{t("upcoming")}</h2>
          {upcoming.length ? (
            <ol className="cal-list">
              {upcoming.map((e) => (
                <li key={`${e.meetingId}-${e.date}-${e.time}`} style={{ "--c": `var(--c${e.color % 6})` } as React.CSSProperties}>
                  <Link href={`/w/${slug}/m/${e.meetingId}`}>
                    <strong>{e.meeting}</strong>
                    <span className="hint">{e.status === "live" ? t("status.live") : `${fmt.dateShort(e.date)} · ${e.time}`}</span>
                  </Link>
                  {e.attendance && (
                    <span className={`st-pill ${e.attendance === "yes" ? "st-done" : "st-open"}`}>{t(`attendance.${e.attendance}`)}</span>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p className="hint">{t("nothing")}</p>
          )}
        </aside>
      </div>
    </div>
  );
}
