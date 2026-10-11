"use client";

import { formatters, type Locale } from "@ronde/i18n";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ExportCsv } from "@/components/export-csv";
import type { WorkspaceDecision } from "@/lib/server/overview";

const tint = (color: number) => ({ "--c": `var(--c${color % 6})` }) as React.CSSProperties;

/** Every decision of the workspace, newest first, by month: what was decided, where, when */
export function DecisionsView({ slug, query, decisions }: { slug: string; query: string; decisions: WorkspaceDecision[] }) {
  const t = useTranslations("decisionsPage");
  const locale = useLocale() as Locale;
  const fmt = formatters(locale);
  const router = useRouter();
  const path = usePathname();
  const [q, setQ] = useState(query);
  const [meeting, setMeeting] = useState<string | null>(null);

  // The search runs on the server once typing pauses
  useEffect(() => {
    if (q === query) return;
    const timer = setTimeout(() => router.replace(q.trim() ? `${path}?q=${encodeURIComponent(q.trim())}` : path, { scroll: false }), 300);
    return () => clearTimeout(timer);
  }, [q, query, path, router]);

  const meetings = [...new Map(decisions.map((d) => [d.meetingId, { id: d.meetingId, name: d.meeting, color: d.color }])).values()];
  const shown = decisions.filter((d) => !meeting || d.meetingId === meeting);
  const months: { key: string; items: WorkspaceDecision[] }[] = [];
  for (const d of shown) {
    const key = d.date.slice(0, 7);
    const last = months[months.length - 1];
    if (last?.key === key) last.items.push(d);
    else months.push({ key, items: [d] });
  }
  const monthName = (key: string) => {
    const s = new Date(`${key}-01T12:00:00Z`).toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  return (
    <div className="page decisions-page">
      <header className="page-head row">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted">{t("intro")}</p>
        </div>
        {shown.length > 0 && (
          <div className="page-head-actions">
            <ExportCsv
              name={t("csv.fileName")}
              href={`/api/w/${slug}/decisions/export?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(meeting ? { meeting } : {}) })}`}
            />
          </div>
        )}
      </header>
      <div className="mt-bar">
        {meetings.length > 1 ? (
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
        ) : (
          <span />
        )}
        <input
          type="search"
          className="mt-search"
          placeholder={t("search")}
          aria-label={t("search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {months.length ? (
        <div className="dc-timeline">
          {months.map((mo) => (
            <section key={mo.key} className="dc-month" aria-labelledby={`dc-${mo.key}`}>
              <h2 id={`dc-${mo.key}`}>
                {monthName(mo.key)} <span className="hint">{t("count", { count: mo.items.length })}</span>
              </h2>
              <ol className="dc-list">
                {mo.items.map((d, i) => (
                  <li key={`${d.meetingId}-${d.date}-${i}`} style={tint(d.color)}>
                    <span className="dc-dot" aria-hidden="true" />
                    <div className="dc-body">
                      <p className="dc-text">{d.text}</p>
                      <p className="dc-meta">
                        <Link href={`/w/${slug}/m/${d.meetingId}/decisions`} className="act-meeting">
                          <span className="act-dot" aria-hidden="true" />
                          {d.meeting}
                        </Link>
                        <span className="hint">{fmt.dateShort(d.date)}</span>
                        {d.context && <span className="hint">{d.context}</span>}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p>{query ? t("noMatch", { query }) : t("empty")}</p>
          {!query && <p className="hint">{t("emptyHint")}</p>}
        </div>
      )}
    </div>
  );
}
