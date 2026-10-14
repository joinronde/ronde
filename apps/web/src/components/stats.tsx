"use client";

import type { StatsDTO } from "@ronde/core/stats";
import { first, fmtMinutes, mmssPlain, moodEmoji } from "@ronde/core/util";
import { formatters } from "@ronde/i18n";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CSV_COLUMNS, niceStep, presence, sessionsCsv, statsKpis } from "@/lib/shared/stats";
import { LoadError } from "./common";
import { ExportCsv } from "./export-csv";
import { EmptyHero } from "./illustration";
import { useRonde } from "./ronde-provider";
import { Avatar } from "./stage";

interface Bar {
  label: string;
  value: number;
  tip: string;
}

/** Single-series vertical bar chart, with an optional reference line */
function Columns({
  data,
  refValue,
  refLabel,
  fmt,
  label,
  max: fixedMax,
}: {
  data: Bar[];
  refValue?: number;
  refLabel?: string;
  fmt: (v: number) => string;
  label: string;
  max?: number;
}) {
  const W = 640,
    H = 230,
    L = 36,
    R = 14,
    T = 18,
    B = 28;
  const iw = W - L - R,
    ih = H - T - B;
  const raw = Math.max(1, refValue ?? 0, ...data.map((d) => d.value)) * 1.05;
  // Fixed scale (percentages: 0 to 100), otherwise rounded up above the largest value
  const step = fixedMax ? fixedMax / 4 : niceStep(raw);
  const max = fixedMax ?? step * Math.ceil(raw / step);
  const y = (v: number) => T + ih - (v / max) * ih;
  const band = iw / Math.max(1, data.length);
  const bw = Math.min(24, band * 0.55);
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const last = data[data.length - 1];
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="ch-grid" x1={L} x2={W - R} y1={y(t)} y2={y(t)} />
          <text className="ch-t" x={L - 6} y={y(t) + 4} textAnchor="end">
            {fmt(t)}
          </text>
        </g>
      ))}
      {data.map((d, i) => {
        const cx = L + band * i + band / 2,
          x = cx - bw / 2,
          top = y(d.value),
          h = Math.max(0, T + ih - top),
          r = Math.min(4, h);
        return (
          <g className="ch-g" key={i}>
            <rect className="ch-hit" x={L + band * i} y={T} width={band} height={ih} data-chart-tip={d.tip} />
            {h > 0 && (
              <path
                className="ch-bar"
                pointerEvents="none"
                d={`M${x},${T + ih} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${T + ih} Z`}
              />
            )}
            <text className="ch-t" x={cx} y={H - 8} textAnchor="middle">
              {d.label}
            </text>
          </g>
        );
      })}
      <line className="ch-base" x1={L} x2={W - R} y1={T + ih} y2={T + ih} />
      {refValue !== undefined && (
        <>
          <line className="ch-ref" x1={L} x2={W - R} y1={y(refValue)} y2={y(refValue)} />
          <text className="ch-t" x={W - R} y={y(refValue) - 6} textAnchor="end">
            {refLabel}
          </text>
        </>
      )}
      {last && (
        <text className="ch-v" x={L + band * (data.length - 1) + band / 2} y={y(last.value) - 7} textAnchor="middle">
          {fmt(last.value)}
        </text>
      )}
    </svg>
  );
}

function Spark({ vals }: { vals: number[] }) {
  const W = 120,
    H = 28,
    P = 5,
    max = Math.max(1, ...vals),
    n = vals.length;
  const x = (i: number) => P + (W - 2 * P) * (n < 2 ? 0 : i / (n - 1));
  const y = (v: number) => H - P - (v / max) * (H - 2 * P);
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <polygon className="ch-area" points={`${P},${H - P} ${pts} ${x(n - 1)},${H - P}`} />
      <polyline className="ch-line" points={pts} />
      <circle className="ch-dot" cx={x(n - 1)} cy={y(vals[n - 1] ?? 0)} r={4} />
    </svg>
  );
}

/** Shared tooltip for elements carrying data-chart-tip (its own: the app-wide one leaves them alone) */
function useTooltip() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  useEffect(() => {
    const over = (e: PointerEvent) => {
      const t = (e.target as Element).closest?.("[data-chart-tip]") as HTMLElement | SVGElement | null;
      setTip(t ? { text: t.getAttribute("data-chart-tip") ?? "", x: e.clientX, y: e.clientY } : null);
    };
    window.addEventListener("pointermove", over);
    return () => window.removeEventListener("pointermove", over);
  }, []);
  return tip;
}

export function StatsView() {
  const t = useTranslations("stats");
  const tStatus = useTranslations("actionStatus");
  const locale = useLocale();
  const fmt = formatters(locale);
  const fmtDay = fmt.dayMonth;
  const fmtShort = fmt.dateShort;
  const { s, api, historyRev } = useRonde();
  const tip = useTooltip();
  const [st, setSt] = useState<StatsDTO | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  // Computed by the server; again after each archive
  useEffect(() => {
    let live = true;
    setError(false);
    fetch(api("/stats"), { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<StatsDTO>) : Promise.reject(new Error(String(r.status)))))
      .then((x) => live && setSt(x))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [api, historyRev, retry]);
  if (error) return <LoadError onRetry={() => setRetry((n) => n + 1)} />;
  if (!st) return <p className="loading">{t("loading")}</p>;
  const H = st.sessions;
  if (!H.length) return <EmptyHero art="stats" title={t("empty")} />;

  const target = s.settings.targetMin;
  const lim = s.settings.speakSec * 1000;
  const { avgDur, avgS, pdKnown, pdTotal, pdRate, avgPres, ratingVotes, ratingAvg } = statsKpis(st);

  // Planned → done, attendance, timekeeping, exchanges
  const pdData: Bar[] = pdKnown.map((x) => ({
    label: fmtDay(x.date),
    value: Math.round((x.done / x.planned) * 100),
    tip: `${fmtShort(x.date)}\n${t("plannedDoneTip", { done: x.done, planned: x.planned })}`,
  }));
  const presData: Bar[] = H.map((h) => ({
    label: fmtDay(h.date),
    value: Math.round(presence(h) * 100),
    tip: `${fmtShort(h.date)}\n${t("presentTip", { count: h.present })}${h.absent ? ` · ${t("absentTip", { names: h.absentNames.join(", ") })}` : ""}`,
  }));
  const ot = st.onTime;
  const exData: Bar[] = H.map((h) => ({
    label: fmtDay(h.date),
    value: h.questions + h.hands + h.kudos,
    tip: `${fmtShort(h.date)}\n${t("exchangesTip", { questions: h.questions, hands: h.hands, kudos: h.kudos, answers: h.answers })}`,
  }));
  const pct = (v: number | null) => (v === null ? "–" : fmt.percent(v));
  const durData: Bar[] = H.map((h) => ({
    label: fmtDay(h.date),
    value: h.durationMs / 60000,
    tip: `${fmtShort(h.date)}\n${t("durationTip", { duration: mmssPlain(h.durationMs) })}`,
  }));
  const blkData: Bar[] = H.map((h) => ({
    label: fmtDay(h.date),
    value: h.blockers,
    tip: `${fmtShort(h.date)}\n${t("blockersTip", { count: h.blockers })}`,
  }));
  const moodData: Bar[] = H.filter((h) => h.mood != null).map((h) => ({
    label: fmtDay(h.date),
    value: h.mood!,
    tip: `${fmtShort(h.date)}\n${moodEmoji(h.mood)} ${t("moodTip", { avg: fmt.decimal(h.mood!), count: h.moodVotes })}`,
  }));
  const ratingData: Bar[] = H.filter((h) => h.rating != null).map((h) => ({
    label: fmtDay(h.date),
    value: h.rating!,
    tip: `${fmtShort(h.date)}\n${t("ratingTip", { avg: fmt.decimal(h.rating!), count: h.ratingVotes })}`,
  }));
  const people = st.speaking;
  const pmax = Math.max(lim * 1.4, ...people.map((p) => p.avgMs));
  const ah = st.actions;
  return (
    <>
      <div className="controls" style={{ justifyContent: "flex-end", marginBottom: 8 }}>
        <ExportCsv
          name={t("fileName")}
          rows={() => sessionsCsv(st, [t("date"), ...CSV_COLUMNS.map((c) => t(`csv.${c}`))])}
          className="btn sm"
        />
      </div>
      <div className="kpis">
        <div className="kpi">
          <div className="l">{t("kpi.archived")}</div>
          <div className="v">{H.length}</div>
          <div className="d">{t("kpi.since", { date: fmtDay(H[0]!.date) })}</div>
        </div>
        <div className="kpi">
          <div className="l">{t("kpi.avgDuration")}</div>
          <div className="v">{fmtMinutes(Math.round(avgDur / 60000), locale)}</div>
          <div className="d">{t("kpi.target", { target: fmtMinutes(target, locale) })}</div>
        </div>
        <div className="kpi">
          <div className="l">{t("kpi.avgSpeaking")}</div>
          <div className="v">{mmssPlain(avgS)}</div>
          <div className="d">{t("kpi.speakingTarget", { target: mmssPlain(lim) })}</div>
        </div>
        <div className="kpi">
          <div className="l">{t("kpi.actions")}</div>
          <div className="v">{t("kpi.open", { count: ah.open })}</div>
          <div className="d">
            {t("kpi.resolved", { count: ah.resolved })}
            {ah.medianDays !== null ? ` · ${t("kpi.median", { days: Math.round(ah.medianDays) })}` : ""}
          </div>
        </div>
        <div className="kpi" data-chart-tip={t("kpi.plannedDoneHint")}>
          <div className="l">{t("kpi.plannedDone")}</div>
          <div className="v">{pct(pdRate)}</div>
          <div className="d">{pdTotal ? t("kpi.ofPlanned", { count: pdTotal }) : t("kpi.afterTwo")}</div>
        </div>
        <div className="kpi">
          <div className="l">{t("kpi.attendance")}</div>
          <div className="v">{pct(avgPres)}</div>
          <div className="d">{t("kpi.perMeeting")}</div>
        </div>
        <div className="kpi">
          <div className="l">{t("kpi.onTime")}</div>
          <div className="v">{pct(ot.total ? ot.ok / ot.total : null)}</div>
          <div className="d">{ot.total - ot.ok ? t("kpi.avgOverrun", { over: mmssPlain(ot.overMs) }) : t("kpi.noOverrun")}</div>
        </div>
        {ratingAvg !== null && (
          <div className="kpi">
            <div className="l">{t("kpi.rating")}</div>
            <div className="v">{fmt.decimal(ratingAvg)}</div>
            <div className="d">{t("kpi.ratingSub", { count: ratingVotes })}</div>
          </div>
        )}
        <div className="kpi">
          <div className="l">{t("kpi.stale")}</div>
          <div className="v">{ah.stale.length}</div>
          <div className="d">{t("kpi.staleHint")}</div>
        </div>
      </div>
      <div className="charts">
        <div className="panel">
          <h3>{t("charts.duration")}</h3>
          <Columns
            data={durData}
            refValue={target}
            refLabel={t("kpi.target", { target: fmtMinutes(target, locale) })}
            fmt={(v) => String(Math.round(v))}
            label={t("charts.durationLabel")}
          />
          <details className="dt">
            <summary>{t("seeData")}</summary>
            <div className="tbl-wrap">
              <table className="data">
                <tbody>
                  <tr>
                    <th>{t("date")}</th>
                    <th>{t("durationColumn")}</th>
                  </tr>
                  {H.map((h) => (
                    <tr key={h.date}>
                      <td>{fmtShort(h.date)}</td>
                      <td className="num">{mmssPlain(h.durationMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
        <div className="panel">
          <h3>{t("charts.plannedDone")}</h3>
          {pdData.length ? (
            <Columns data={pdData} max={100} fmt={(v) => String(Math.round(v))} label={t("charts.plannedDoneLabel")} />
          ) : (
            <p className="muted">{t("charts.needTwo")}</p>
          )}
          <p className="hint" style={{ marginTop: 6 }}>
            {t("charts.plannedDoneHint")}
          </p>
        </div>
        <div className="panel">
          <h3>{t("charts.attendance")}</h3>
          <Columns data={presData} max={100} fmt={(v) => String(Math.round(v))} label={t("charts.attendanceLabel")} />
        </div>
        <div className="panel">
          <h3>{t("charts.exchanges")}</h3>
          {exData.some((d) => d.value) ? (
            <Columns data={exData} fmt={(v) => String(v)} label={t("charts.exchangesLabel")} />
          ) : (
            <p className="muted">{t("charts.noExchanges")}</p>
          )}
          <p className="hint" style={{ marginTop: 6 }}>
            {t("charts.exchangesHint")}
          </p>
        </div>
        <div className="panel">
          <h3>{t("charts.blockers")}</h3>
          <Columns data={blkData} fmt={(v) => String(v)} label={t("charts.blockersLabel")} />
          <details className="dt">
            <summary>{t("seeData")}</summary>
            <div className="tbl-wrap">
              <table className="data">
                <tbody>
                  <tr>
                    <th>{t("date")}</th>
                    <th>{t("blockersColumn")}</th>
                  </tr>
                  {blkData.map((d, i) => (
                    <tr key={i}>
                      <td>{d.label}</td>
                      <td className="num">{d.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
        {moodData.length > 0 && (
          <div className="panel">
            <h3>{t("charts.mood")}</h3>
            <Columns data={moodData} fmt={(v) => (Number.isInteger(v) ? String(v) : fmt.decimal(v))} label={t("charts.moodLabel")} />
            <p className="hint" style={{ marginTop: 6 }}>
              {t("charts.moodHint")}
            </p>
          </div>
        )}
        {ratingData.length > 0 && (
          <div className="panel">
            <h3>{t("charts.rating")}</h3>
            <Columns data={ratingData} fmt={(v) => (Number.isInteger(v) ? String(v) : fmt.decimal(v))} label={t("charts.ratingLabel")} />
            <p className="hint" style={{ marginTop: 6 }}>
              {t("charts.ratingHint")}
            </p>
          </div>
        )}
        <div className="panel">
          <h3>{t("charts.speaking")}</h3>
          <ul className="bars" style={{ fontSize: 13.5 }}>
            {people.map((p) => (
              <li key={p.id} data-chart-tip={`${p.name}\n${t("charts.speakingTip", { avg: mmssPlain(p.avgMs), count: p.turns })}`}>
                <span>{first(p.name)}</span>
                <span className="bar">
                  <i style={{ width: ((p.avgMs / pmax) * 100).toFixed(1) + "%" }} />
                  <b style={{ insetInlineStart: ((lim / pmax) * 100).toFixed(1) + "%" }} />
                </span>
                <span className="v">{mmssPlain(p.avgMs)}</span>
              </li>
            ))}
          </ul>
          <p className="hint" style={{ marginTop: 6 }}>
            {t("charts.speakingHint", { target: mmssPlain(lim) })}
          </p>
        </div>
        <div className="panel">
          <h3>{t("recurring.title")}</h3>
          {st.recurring.length ? (
            st.recurring.map((g, i) => (
              <div className="item" key={i}>
                <Avatar id={g.personId} sm />
                <div className="body">
                  {g.text}
                  <div className="meta">
                    {first(g.name)} · {t("recurring.times", { count: g.dates.length, dates: g.dates.map(fmtDay).join(", ") })}
                  </div>
                </div>
                {g.withAction ? (
                  <span className="st-pill st-doing">{t("recurring.withAction")}</span>
                ) : (
                  <span className="st-pill st-open">{t("recurring.withoutAction")}</span>
                )}
              </div>
            ))
          ) : (
            <p className="muted">{t("recurring.none")}</p>
          )}
        </div>
      </div>
      {ah.stale.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <h3>{t("kpi.stale")}</h3>
          {ah.stale.map((a) => (
            <div className="item" key={a.id}>
              <Avatar id={a.ownerId} sm />
              <div className="body">
                {a.text}
                <div className="meta">
                  {first(a.ownerName)} · {t("staleSince", { days: a.days })}
                  {a.originDate ? ` ${t("fromMeeting", { date: fmtDay(a.originDate) })}` : ""}
                </div>
              </div>
              <span className={`st-pill st-${a.status}`}>{tStatus(a.status)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="panel" style={{ marginTop: 16 }}>
        <h3>{t("projects.title")}</h3>
        <div className="tbl-wrap">
          <table className="data">
            <tbody>
              <tr>
                <th>{t("projects.project")}</th>
                <th style={{ textAlign: "end" }}>{t("projects.done")}</th>
                <th>{t("projects.perMeeting")}</th>
                <th>{t("projects.last")}</th>
              </tr>
              {st.projects.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td className="num">{r.total}</td>
                  <td data-chart-tip={r.perSession.map((v, i) => `${fmtDay(H[i]!.date)}: ${v}`).join("\n")}>
                    <Spark vals={r.perSession} />
                  </td>
                  <td>{fmtShort(r.last)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {tip?.text && (
        <div id="tip" style={{ left: Math.min(tip.x + 14, window.innerWidth - 280), top: tip.y + 14 }}>
          {tip.text}
        </div>
      )}
    </>
  );
}
