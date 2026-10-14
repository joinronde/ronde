"use client";

import { formatters, type Locale } from "@ronde/i18n";
import { CalendarDays, Gavel, MessagesSquare, Scale, ScrollText, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ExportCsv } from "@/components/export-csv";
import { EmptyHero } from "@/components/illustration";
import { Select } from "@/components/select";
import { ShowMore, useShowMore } from "@/components/show-more";
import type { WorkspaceDecision } from "@/lib/server/overview";
import { DECISION_PERIODS, type DecisionPeriod, decisionMonths, periodStart } from "@/lib/shared/decisions";
import { limitGroups } from "@/lib/shared/show-more";

const tint = (color: number) => ({ "--c": `var(--c${color % 6})` }) as React.CSSProperties;

/** Every decision of the workspace, newest first, by month: what was decided, in which meeting, when, during whose turn */
export function DecisionsView({
  slug,
  query,
  decisions,
  today,
}: {
  slug: string;
  query: string;
  decisions: WorkspaceDecision[];
  today: string;
}) {
  const t = useTranslations("decisionsPage");
  const locale = useLocale() as Locale;
  const fmt = formatters(locale);
  const router = useRouter();
  const path = usePathname();
  const [q, setQ] = useState(query);
  const [meeting, setMeeting] = useState("");
  const [period, setPeriod] = useState<DecisionPeriod>("all");

  // The search runs on the server once typing pauses
  useEffect(() => {
    if (q === query) return;
    const timer = setTimeout(() => router.replace(q.trim() ? `${path}?q=${encodeURIComponent(q.trim())}` : path, { scroll: false }), 300);
    return () => clearTimeout(timer);
  }, [q, query, path, router]);

  const meetings = [...new Map(decisions.map((d) => [d.meetingId, { id: d.meetingId, name: d.meeting, color: d.color }])).values()];
  const allMonths = decisionMonths(decisions, meeting || null, period, today);
  // A month at a time on screen: the first decisions, then more on demand (the filters start again from the top)
  const page = useShowMore();
  // Back to the first ones when the filters change
  useEffect(() => page.reset(), [meeting, period, query]);
  const { groups: months, hidden } = limitGroups(allMonths, page.limit);
  const totalOf = (key: string) => allMonths.find((m) => m.key === key)?.items.length ?? 0;
  const shownCount = allMonths.reduce((n, m) => n + m.items.length, 0);
  const lastMonth = periodStart("30", today)!;
  const monthName = (key: string) => {
    const s = new Date(`${key}-01T12:00:00Z`).toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  return (
    <div className="page decisions-page">
      <header className="page-head row">
        <div className="page-title-with-ico">
          <span className="page-ico" aria-hidden="true">
            <Scale size={22} strokeWidth={2} />
          </span>
          <div>
            <h1>{t("title")}</h1>
            <p className="muted">{t("intro")}</p>
          </div>
        </div>
        {shownCount > 0 && (
          <div className="page-head-actions">
            <ExportCsv
              name={t("csv.fileName")}
              href={`/api/w/${slug}/decisions/export?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(meeting ? { meeting } : {}) })}`}
            />
          </div>
        )}
      </header>
      {decisions.length > 0 && (
        <div className="act-kpis dc-kpis">
          <div className="act-kpi open">
            <span className="act-kpi-ico" aria-hidden="true">
              <Gavel size={18} strokeWidth={2.2} />
            </span>
            <strong>{decisions.length}</strong>
            <span>{t("kpiTotal")}</span>
          </div>
          <div className="act-kpi done">
            <span className="act-kpi-ico" aria-hidden="true">
              <CalendarDays size={18} strokeWidth={2.2} />
            </span>
            <strong>{decisions.filter((d) => d.date >= lastMonth).length}</strong>
            <span>{t("kpiMonth")}</span>
          </div>
          <div className="act-kpi doing">
            <span className="act-kpi-ico" aria-hidden="true">
              <MessagesSquare size={18} strokeWidth={2.2} />
            </span>
            <strong>{meetings.length}</strong>
            <span>{t("kpiMeetings")}</span>
          </div>
        </div>
      )}
      <div className="act-toolbar">
        <label className="search-input">
          <Search size={16} strokeWidth={2} aria-hidden="true" />
          <input type="search" placeholder={t("search")} aria-label={t("search")} value={q} onChange={(e) => setQ(e.target.value)} />
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
        <span className="seg dc-periods" role="group" aria-label={t("period")}>
          {DECISION_PERIODS.map((p) => (
            <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>
              {t(`periods.${p}`)}
            </button>
          ))}
        </span>
      </div>
      {months.length ? (
        <div className="dc-timeline">
          {months.map((mo) => (
            <section key={mo.key} className="dc-month" aria-labelledby={`dc-${mo.key}`}>
              <h2 id={`dc-${mo.key}`} className="dc-month-title">
                {monthName(mo.key)} <span className="act-n">{totalOf(mo.key)}</span>
              </h2>
              <ol className="dc-list">
                {mo.items.map((d, i) => (
                  <li key={`${d.meetingId}-${d.date}-${i}`} style={tint(d.color)}>
                    <span className="dc-dot" aria-hidden="true" />
                    <div className="dc-body">
                      <span className="dc-ico" aria-hidden="true">
                        <Gavel size={16} strokeWidth={2.2} />
                      </span>
                      <div className="dc-main">
                        <p className="dc-text">{d.text}</p>
                        <p className="dc-meta">
                          <Link href={`/w/${slug}/m/${d.meetingId}/decisions`} className="act-meeting" title={t("openLog")}>
                            <span className="act-dot" aria-hidden="true" />
                            {d.meeting}
                          </Link>
                          <span className="dc-when">
                            <CalendarDays size={13} strokeWidth={2} aria-hidden="true" /> {fmt.dateShort(d.date)}
                          </span>
                          {d.context && (
                            <span className="dc-where">
                              <ScrollText size={13} strokeWidth={2} aria-hidden="true" /> {t("during", { context: d.context })}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
          <ShowMore hidden={hidden} step={page.step} onMore={page.more} />
        </div>
      ) : (
        <EmptyHero
          art={query ? "search" : "decisions"}
          title={query ? t("noMatch", { query }) : decisions.length ? t("noneInPeriod") : t("empty")}
          hint={!query && !decisions.length ? t("emptyHint") : undefined}
        />
      )}
    </div>
  );
}
