"use client";

import { type CsvCell, percent, round2 } from "@ronde/core/csv";
import type { InsightsDTO } from "@ronde/editions/ee";
import { formatters, type Locale } from "@ronde/i18n";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ExportCsv } from "@/components/export-csv";

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/** Engagement as a coloured badge: low, middle, high */
function Score({ value }: { value: number | null }) {
  if (value === null) return <span className="hint">—</span>;
  const tone = value >= 70 ? "high" : value >= 45 ? "mid" : "low";
  return <span className={`score ${tone}`}>{value}</span>;
}

/** Engagement of each session, as a small line */
function Sparkline({ values }: { values: (number | null)[] }) {
  const points = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (points.length < 2) return null;
  const w = 90;
  const h = 24;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * w;
  const y = (v: number) => h - (v / 100) * h;
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={points.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")} />
    </svg>
  );
}

/** Sessions per week, with the attendance as a line */
function WeekChart({ weeks, label }: { weeks: InsightsDTO["weeks"]; label: string }) {
  const max = Math.max(1, ...weeks.map((w) => w.sessions));
  const W = 640;
  const H = 140;
  const bar = W / Math.max(1, weeks.length);
  const line = weeks
    .map((w, i) => (w.attendance === null ? null : `${(i * bar + bar / 2).toFixed(1)},${(H - w.attendance * (H - 10)).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");
  return (
    <svg className="week-chart" viewBox={`0 0 ${W} ${H + 4}`} role="img" aria-label={label} preserveAspectRatio="none">
      {weeks.map((w, i) => {
        const h = (w.sessions / max) * (H - 10);
        return <rect key={w.week} x={i * bar + bar * 0.18} y={H - h} width={bar * 0.64} height={h} rx="3" />;
      })}
      {line && <polyline points={line} />}
    </svg>
  );
}

export function InsightsView({
  slug,
  data,
  weeks,
  periods,
  children,
}: {
  slug: string;
  data: InsightsDTO;
  weeks: number;
  periods: number[];
  children?: React.ReactNode;
}) {
  const t = useTranslations("insights");
  const fmt = formatters(useLocale() as Locale);
  const k = data.totals;
  const cards: [string, string, string?][] = [
    [t("cards.engagement"), k.engagement === null ? "—" : String(k.engagement), t("cards.engagementHint")],
    [t("cards.sessions"), String(k.sessions), t("cards.meetings", { count: k.meetings })],
    [t("cards.attendance"), pct(k.attendance)],
    [t("cards.followThrough"), pct(k.followThrough), t("cards.followThroughHint")],
    [t("cards.onTime"), pct(k.onTime)],
    [t("cards.mood"), k.mood === null ? "—" : `${fmt.decimal(k.mood)} / 5`],
    [
      t("cards.actions"),
      t("cards.actionsValue", { done: k.actionsDone, created: k.actionsCreated }),
      k.medianDays === null ? undefined : t("cards.median", { days: Math.round(k.medianDays) }),
    ],
  ];
  // The table by meeting, as a spreadsheet: shares in percent, and the whole workspace on the last line
  const csvRows = (): CsvCell[][] => [
    [
      t("columns.meeting"),
      t("columns.engagement"),
      t("columns.sessions"),
      `${t("columns.attendance")} (%)`,
      `${t("columns.followThrough")} (%)`,
      `${t("columns.onTime")} (%)`,
      t("csv.participation"),
      t("columns.mood"),
      t("columns.openActions"),
    ],
    ...data.meetings.map((m) => [
      m.name,
      m.engagement === null ? null : Math.round(m.engagement),
      m.sessions,
      percent(m.attendance),
      percent(m.followThrough),
      percent(m.onTime),
      round2(m.participation),
      round2(m.mood),
      m.openActions,
    ]),
    [
      t("csv.total"),
      k.engagement === null ? null : Math.round(k.engagement),
      k.sessions,
      percent(k.attendance),
      percent(k.followThrough),
      percent(k.onTime),
      null,
      round2(k.mood),
      data.meetings.reduce((n, m) => n + m.openActions, 0),
    ],
  ];
  return (
    <div className="page insights">
      <header className="page-head row">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted">{t("intro", { from: fmt.dateShort(data.from), to: fmt.dateShort(data.to) })}</p>
        </div>
        <nav className="seg" aria-label={t("period")}>
          {periods.map((p) => (
            <Link
              key={p}
              href={`/w/${slug}/insights?weeks=${p}`}
              aria-current={p === weeks ? "page" : undefined}
              className={p === weeks ? "on" : undefined}
            >
              {t("weeks", { count: p })}
            </Link>
          ))}
        </nav>
      </header>
      <div className="kpis">
        {cards.map(([label, value, hint]) => (
          <div key={label} className="kpi">
            <span className="kpi-label">{label}</span>
            <strong className="kpi-value">{value}</strong>
            {hint && <span className="hint">{hint}</span>}
          </div>
        ))}
      </div>
      <section className="panel stack" aria-labelledby="weeks-title">
        <h2 id="weeks-title">{t("weekTitle")}</h2>
        <WeekChart weeks={data.weeks} label={t("weekLabel")} />
        <p className="hint">{t("weekLegend")}</p>
      </section>
      <section className="stack" aria-labelledby="meetings-title">
        <div className="panel-head">
          <h2 id="meetings-title">{t("meetingsTitle")}</h2>
          {data.meetings.length > 0 && <ExportCsv name={t("csv.fileName")} rows={csvRows} className="btn sm" />}
        </div>
        {data.meetings.length ? (
          <div className="table-wrap">
            <table className="audit-table insights-table">
              <thead>
                <tr>
                  <th scope="col">{t("columns.meeting")}</th>
                  <th scope="col">{t("columns.engagement")}</th>
                  <th scope="col">{t("columns.trend")}</th>
                  <th scope="col">{t("columns.sessions")}</th>
                  <th scope="col">{t("columns.attendance")}</th>
                  <th scope="col">{t("columns.followThrough")}</th>
                  <th scope="col">{t("columns.onTime")}</th>
                  <th scope="col">{t("columns.mood")}</th>
                  <th scope="col">{t("columns.openActions")}</th>
                </tr>
              </thead>
              <tbody>
                {data.meetings.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Link href={`/w/${slug}/m/${m.id}/stats`}>{m.name}</Link>
                    </td>
                    <td>
                      <Score value={m.engagement} />
                    </td>
                    <td>
                      <Sparkline values={m.trend} />
                    </td>
                    <td>{m.sessions}</td>
                    <td>{pct(m.attendance)}</td>
                    <td>{pct(m.followThrough)}</td>
                    <td>{pct(m.onTime)}</td>
                    <td>{m.mood === null ? "—" : fmt.decimal(m.mood)}</td>
                    <td>{m.openActions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="emptybox">{t("empty")}</div>
        )}
        <p className="hint">{t("engagementHow")}</p>
      </section>
      {children}
    </div>
  );
}
