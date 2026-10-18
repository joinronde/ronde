// SPDX-License-Identifier: LicenseRef-Ronde-EE
// Scheduled reports: the workspace insights of the past week or month, by email.

import type { EnterpriseEdition, InsightsDTO } from "@ronde/editions/ee";
import { formatters, type Locale, translator } from "@ronde/i18n";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export function due(frequency: "weekly" | "monthly", local: { date: string; minutes: number }) {
  if (local.minutes < 8 * 60) return null;
  const day = new Date(`${local.date}T12:00:00Z`);
  if (frequency === "weekly") {
    if (day.getUTCDay() !== 1) return null;
    return { key: `W:${local.date}`, from: addDays(local.date, -7), to: addDays(local.date, -1) };
  }
  if (day.getUTCDate() !== 1) return null;
  const to = addDays(local.date, -1);
  return { key: `M:${local.date.slice(0, 7)}`, from: `${to.slice(0, 7)}-01`, to };
}

export function email(data: InsightsDTO, o: { locale: Locale; workspace: string; url: string; logo?: string }) {
  const t = translator(o.locale, "reports");
  const ti = translator(o.locale, "insights");
  const f = formatters(o.locale);
  const k = data.totals;
  const period = t("period", { from: f.dateShort(data.from), to: f.dateShort(data.to) });
  const subject = t("subject", { workspace: o.workspace, period });
  const figures: [string, string][] = [
    [ti("cards.engagement"), k.engagement === null ? "—" : `${k.engagement} / 100`],
    [ti("cards.sessions"), String(k.sessions)],
    [ti("cards.attendance"), pct(k.attendance)],
    [ti("cards.followThrough"), pct(k.followThrough)],
    [ti("cards.onTime"), pct(k.onTime)],
    [ti("cards.mood"), k.mood === null ? "—" : `${f.decimal(k.mood)} / 5`],
    [ti("cards.actions"), ti("cards.actionsValue", { done: k.actionsDone, created: k.actionsCreated })],
  ];
  const meetings = data.meetings.filter((m) => m.sessions > 0);
  // Projects that need someone's attention: in trouble, overdue or gone quiet
  const tp = translator(o.locale, "projects");
  const watch = (data.portfolio?.projects ?? [])
    .map((p) => ({
      name: p.name,
      why: [
        p.health && p.health !== "onTrack" ? tp(`health.${p.health}`) : "",
        p.overdue ? tp("dashboard.overdue") : "",
        p.quiet ? tp("dashboard.quiet") : "",
      ].filter(Boolean),
    }))
    .filter((p) => p.why.length);
  const text = [
    subject,
    "",
    ...figures.map(([l, v]) => `${l}: ${v}`),
    "",
    t("byMeeting"),
    ...meetings.map(
      (m) =>
        `- ${m.name}: ${ti("columns.engagement")} ${m.engagement ?? "—"}, ${ti("columns.attendance")} ${pct(m.attendance)}, ${ti("columns.followThrough")} ${pct(m.followThrough)}`,
    ),
    ...(watch.length ? ["", t("projectsToWatch"), ...watch.map((p) => `- ${p.name}: ${p.why.join(", ")}`)] : []),
    "",
    `${t(o.logo ? "openBranded" : "open")}: ${o.url}`,
  ].join("\n");
  const cell = "padding:8px 10px;border-bottom:1px solid #E5DFD5;text-align:left";
  const html = `<!doctype html><html lang="${o.locale}"><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#FAF8F5;color:#1F1A14;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#FFFFFF;border:1px solid #E5DFD5;border-top:4px solid #B23A0B;border-radius:14px"><tr><td style="padding:24px">
${o.logo ? `<img src="${esc(o.logo)}" alt="" height="40" style="display:block;border:0;height:40px;width:auto;max-width:160px;margin:0 0 14px">` : ""}<p style="margin:0;color:#6F665C;font-size:13px">${esc(o.workspace)} · ${esc(period)}</p>
<h1 style="margin:6px 0 18px;font-size:24px">${esc(t("title"))}</h1>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${figures
    .map(
      ([l, v]) =>
        `<tr><td style="${cell};color:#544B42">${esc(l)}</td><td style="${cell};font-weight:bold;text-align:right">${esc(v)}</td></tr>`,
    )
    .join("")}</table>
${
  meetings.length
    ? `<h2 style="margin:24px 0 8px;font-size:18px">${esc(t("byMeeting"))}</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><th style="${cell}">${esc(ti("columns.meeting"))}</th><th style="${cell}">${esc(ti("columns.engagement"))}</th><th style="${cell}">${esc(ti("columns.attendance"))}</th><th style="${cell}">${esc(ti("columns.followThrough"))}</th></tr>${meetings
        .map(
          (m) =>
            `<tr><td style="${cell}">${esc(m.name)}</td><td style="${cell}">${m.engagement ?? "—"}</td><td style="${cell}">${pct(m.attendance)}</td><td style="${cell}">${pct(m.followThrough)}</td></tr>`,
        )
        .join("")}</table>`
    : `<p style="color:#544B42">${esc(t("noSession"))}</p>`
}
${
  watch.length
    ? `<h2 style="margin:24px 0 8px;font-size:18px">${esc(t("projectsToWatch"))}</h2><table role="presentation" width="100%" cellspacing="0" cellpadding="0">${watch
        .map((p) => `<tr><td style="${cell}">${esc(p.name)}</td><td style="${cell};color:#544B42">${esc(p.why.join(", "))}</td></tr>`)
        .join("")}</table>`
    : ""
}
<p style="margin:24px 0 0"><a href="${esc(o.url)}" style="color:#B23A0B;font-weight:bold">${esc(t(o.logo ? "openBranded" : "open"))} →</a></p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, text, html };
}

export const reports: EnterpriseEdition["reports"] = { email, due };
