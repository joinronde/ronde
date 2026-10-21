// Messages sent by notification connectors (Matrix, Slack, Teams, Discord, Mattermost, email, webhook).
// Each event gives a structured message, rendered for each platform: plain text, HTML, Markdown, Slack
// mrkdwn, Teams Adaptive Card, Discord embed.

import { dirOf, formatters, type Locale, translator } from "@ronde/i18n";
import { type EmailBrand, REMINDER_LOGO_CID } from "./notifications";
import type { SettingsDTO } from "./types";
import { fmtMinutes, resolveSections } from "./util";

export const NOTIFY_EVENTS = [
  "session.soon",
  "session.started",
  "minutes.published",
  "checkin.reminder",
  "action.overdue",
  "birthday",
] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

export type Block =
  | { kind: "title"; text: string }
  | { kind: "text"; text: string }
  | { kind: "facts"; items: { label: string; value: string }[] }
  | { kind: "list"; items: string[] }
  | { kind: "link"; url: string; label: string };

export interface RichMessage {
  /** One line: notification previews, email subject, Teams fallback */
  summary: string;
  blocks: Block[];
}

export type NotifySettings = Pick<SettingsDTO, "teamName" | "targetMin" | "speakSec" | "videoUrl" | "sections">;

export interface NotifyInput {
  event: NotifyEvent | "test";
  settings: NotifySettings;
  locale: Locale;
  /** Public URL of the meeting (empty: no link to Ronde) */
  meetingUrl: string;
  session?: { date: string; time: string } | null;
  /** session.soon */
  minutesBefore?: number;
  /** checkin.reminder */
  progress?: { ready: number; total: number };
  /** minutes.published */
  minutes?: { durationMs: number; participants: number; decisions: string[]; actions: { text: string; owner: string }[] };
  /** action.overdue */
  overdue?: { text: string; owner: string; days: number }[];
  /** birthday */
  names?: string[];
}

/** HTTP(S) links only */
export function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

const join = (base: string, path: string) => (safeUrl(base) ? `${base.replace(/\/+$/, "")}${path}` : "");

/** The structured message of an event */
export function notifyMessage(input: NotifyInput): RichMessage {
  const t = translator(input.locale, "notify");
  const f = formatters(input.locale);
  const s = input.settings;
  const team = s.teamName;
  const me = join(input.meetingUrl, "/me");
  const blocks: Block[] = [];
  const when = input.session ? t("when", { date: f.date(input.session.date), time: input.session.time }) : "";
  const speak = [
    Math.floor(s.speakSec / 60) ? t("speak.minutes", { m: Math.floor(s.speakSec / 60) }) : "",
    s.speakSec % 60 ? t("speak.seconds", { s: s.speakSec % 60 }) : "",
  ]
    .filter(Boolean)
    .join(" ");
  const timing = t("timing", { target: fmtMinutes(s.targetMin, input.locale), speak });
  const link = (url: string, label: string) => {
    const href = safeUrl(url);
    if (href) blocks.push({ kind: "link", url: href, label });
  };
  const title = (text: string) => {
    blocks.push({ kind: "title", text });
    return text;
  };
  let summary = "";

  switch (input.event) {
    case "test": {
      summary = title(t("test.title"));
      blocks.push({ kind: "text", text: t("test.body", { team }) });
      link(input.meetingUrl, t("openRonde"));
      break;
    }
    case "session.soon": {
      summary = title(t("soon.title", { team, minutes: input.minutesBefore ?? 10 }));
      if (when)
        blocks.push({
          kind: "facts",
          items: [
            { label: t("labels.when"), value: when },
            { label: t("labels.timing"), value: timing },
          ],
        });
      blocks.push({ kind: "text", text: t("soon.body") });
      link(s.videoUrl, t("joinVideo"));
      link(me, t("followInApp"));
      break;
    }
    case "session.started": {
      summary = title(t("started.title", { team }));
      blocks.push({ kind: "text", text: t("started.body") });
      link(s.videoUrl, t("joinVideo"));
      link(me, t("followInApp"));
      break;
    }
    case "minutes.published": {
      const m = input.minutes;
      summary = title(t("minutes.title", { team, date: input.session ? f.dateShort(input.session.date) : "" }));
      if (m) {
        blocks.push({
          kind: "facts",
          items: [
            { label: t("labels.duration"), value: fmtMinutes(Math.round(m.durationMs / 60_000), input.locale) },
            { label: t("labels.participants"), value: String(m.participants) },
          ],
        });
        if (m.decisions.length) blocks.push({ kind: "text", text: t("minutes.decisions") }, { kind: "list", items: m.decisions });
        if (m.actions.length)
          blocks.push(
            { kind: "text", text: t("minutes.actions") },
            { kind: "list", items: m.actions.map((a) => t("minutes.action", { text: a.text, owner: a.owner })) },
          );
      }
      link(join(input.meetingUrl, "/history"), t("minutes.read"));
      break;
    }
    case "checkin.reminder": {
      summary = title(t("checkIn.title", { team }));
      if (when)
        blocks.push({
          kind: "facts",
          items: [
            { label: t("labels.when"), value: when },
            { label: t("labels.timing"), value: timing },
          ],
        });
      const p = input.progress;
      if (p) {
        const remaining = Math.max(0, p.total - p.ready);
        blocks.push({
          kind: "text",
          text: `${t("checkIn.ready", { ready: p.ready, total: p.total })}\n${
            p.total === 0 ? t("checkIn.none") : remaining === 0 ? t("checkIn.allReady") : t("checkIn.remaining", { count: remaining })
          }`,
        });
      }
      const sections = resolveSections(s, input.locale).map((x) => x.label);
      blocks.push({ kind: "text", text: t("checkIn.prepare", { sections: f.list(sections) }) });
      link(me, t("checkIn.fillIn"));
      break;
    }
    case "action.overdue": {
      const list = input.overdue ?? [];
      summary = title(t("overdue.title", { team, count: list.length }));
      blocks.push({ kind: "list", items: list.map((a) => t("overdue.item", { text: a.text, owner: a.owner, days: a.days })) });
      link(me, t("overdue.update"));
      break;
    }
    case "birthday": {
      const names = input.names ?? [];
      summary = title(t("birthday.title", { names: f.list(names), count: names.length }));
      blocks.push({ kind: "text", text: t("birthday.body", { team }) });
      break;
    }
  }
  return { summary, blocks };
}

// ---------- Renderers ----------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function toText(m: RichMessage): string {
  return m.blocks
    .map((b) => {
      if (b.kind === "title" || b.kind === "text") return b.text;
      if (b.kind === "facts") return b.items.map((x) => `${x.label}: ${x.value}`).join("\n");
      if (b.kind === "list") return b.items.map((x) => `• ${x}`).join("\n");
      return `${b.label}: ${b.url}`;
    })
    .join("\n\n");
}

export function toHtml(m: RichMessage): string {
  return m.blocks
    .map((b) => {
      if (b.kind === "title") return `<p><strong>${esc(b.text)}</strong></p>`;
      if (b.kind === "text") return `<p>${esc(b.text).replace(/\n/g, "<br>")}</p>`;
      if (b.kind === "facts") return `<p>${b.items.map((x) => `<strong>${esc(x.label)}</strong>: ${esc(x.value)}`).join("<br>")}</p>`;
      if (b.kind === "list") return `<ul>${b.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
      return `<p><a href="${esc(b.url)}">${esc(b.label)}</a></p>`;
    })
    .join("");
}

/**
 * The whole email of a notification, in the layout of the reminder: logo, card, the first link as a button,
 * the others under it. A text right before a list is that list's heading.
 */
export function toEmailHtml(
  m: RichMessage,
  {
    locale,
    team,
    brand = null,
    logoSrc = `cid:${REMINDER_LOGO_CID}`,
  }: { locale: Locale; team: string; brand?: EmailBrand | null; logoSrc?: string },
): string {
  const t = translator(locale, "notifications");
  const rtl = dirOf(locale) === "rtl";
  const dir = rtl ? "rtl" : "ltr";
  const arrow = rtl ? "←" : "→";
  const start = rtl ? "right" : "left";
  const end = rtl ? "left" : "right";
  const links = m.blocks.filter((b) => b.kind === "link");
  const body = m.blocks
    .map((b, i) => {
      if (b.kind === "title") return `<h1 style="margin:26px 0 16px;font-size:24px;line-height:1.3;color:#1F1A14">${esc(b.text)}</h1>`;
      if (b.kind === "text") {
        if (m.blocks[i + 1]?.kind === "list")
          return `<h2 style="margin:24px 0 8px;font-size:18px;line-height:1.4;color:#1F1A14">${esc(b.text)}</h2>`;
        return `<p style="margin:0 0 16px">${esc(b.text).replace(/\n/g, "<br>")}</p>`;
      }
      if (b.kind === "facts")
        return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 18px;background-color:#FEEEE2;border-radius:10px"><tr><td style="padding:14px 16px">${b.items
          .map(
            (x, j) =>
              `<p style="margin:${j ? "10px" : "0"} 0 0;color:#B23A0B;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">${esc(x.label)}</p><p style="margin:2px 0 0;font-size:16px;font-weight:bold">${esc(x.value)}</p>`,
          )
          .join("")}</td></tr></table>`;
      if (b.kind === "list")
        return `<ul style="margin:0 0 16px;padding-${start}:22px">${b.items.map((x) => `<li style="margin:6px 0;overflow-wrap:anywhere">${esc(x)}</li>`).join("")}</ul>`;
      return "";
    })
    .join("\n");
  const [main, ...others] = links;
  const button = main
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0 14px"><tr><td bgcolor="#B23A0B" style="border-radius:8px"><a href="${esc(main.url)}" style="display:inline-block;padding:12px 22px;border:1px solid #B23A0B;border-radius:8px;background-color:#B23A0B;color:#FFFFFF;font-weight:bold;text-decoration:none">${esc(main.label)} ${arrow}</a></td></tr></table>
${others.map((l) => `<p style="margin:0 0 10px"><a href="${esc(l.url)}" style="color:#B23A0B;font-weight:bold">${esc(l.label)} ${arrow}</a></p>`).join("")}
<p style="margin:14px 0 0;font-size:12px;color:#6F665C;overflow-wrap:anywhere">${esc(t("email.fallbackLink"))} <a href="${esc(main.url)}" style="color:#B23A0B">${esc(main.url)}</a></p>`
    : "";
  const footer = translator(locale, "notify")("emailFooter", { team });
  return `<!doctype html>
<html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.summary)}</title></head>
<body dir="${dir}" style="margin:0;padding:0;background-color:#FAF8F5;color:#1F1A14;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;overflow-wrap:anywhere">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(m.summary)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#FAF8F5"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E5DFD5;border-top:4px solid #B23A0B;border-radius:14px">
<tr><td style="padding:24px">
<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="padding-${end}:12px">${brand ? `<img src="${esc(brand.logo)}" alt="" height="48" style="display:block;border:0;height:48px;width:auto;max-width:160px">` : `<img src="${esc(logoSrc)}" alt="" width="48" height="48" style="display:block;border:0">`}</td><td><p style="margin:0;font-size:26px;font-weight:bold;letter-spacing:-1px">${esc(brand?.name ?? "Ronde")}</p><p style="margin:0;color:#6F665C;font-size:13px">${esc(team)} · ${esc(t("email.tagline"))}</p></td></tr></table>
${body}
${button}
</td></tr><tr><td style="padding:16px 24px;border-top:1px solid #E5DFD5;border-radius:0 0 13px 13px;background-color:#FAF8F5;color:#6F665C;font-size:12px">${esc(footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

/** Markdown for Discord and Mattermost; characters that would format user text are escaped */
const md = (s: string) => s.replace(/([\\*_~`|>[\]()])/g, "\\$1");
export function toMarkdown(m: RichMessage): string {
  return m.blocks
    .map((b) => {
      if (b.kind === "title") return `**${md(b.text)}**`;
      if (b.kind === "text") return md(b.text);
      if (b.kind === "facts") return b.items.map((x) => `**${md(x.label)}**: ${md(x.value)}`).join("\n");
      if (b.kind === "list") return b.items.map((x) => `- ${md(x)}`).join("\n");
      return `[${md(b.label)}](${b.url})`;
    })
    .join("\n\n");
}

/** Slack mrkdwn: *bold*, <url|label>; &, < and > escaped as Slack requires */
const slack = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function toSlack(m: RichMessage): { text: string; blocks: object[] } {
  const blocks = m.blocks.map((b) => {
    const text =
      b.kind === "title"
        ? `*${slack(b.text)}*`
        : b.kind === "text"
          ? slack(b.text)
          : b.kind === "facts"
            ? b.items.map((x) => `*${slack(x.label)}*: ${slack(x.value)}`).join("\n")
            : b.kind === "list"
              ? b.items.map((x) => `• ${slack(x)}`).join("\n")
              : `<${b.url}|${slack(b.label)}>`;
    return { type: "section", text: { type: "mrkdwn", text } };
  });
  return { text: m.summary, blocks };
}

/** Microsoft Teams (Workflows webhook): a message with one Adaptive Card */
export function toTeams(m: RichMessage): object {
  const body: object[] = [];
  const actions: object[] = [];
  for (const b of m.blocks) {
    if (b.kind === "title") body.push({ type: "TextBlock", text: b.text, weight: "Bolder", size: "Medium", wrap: true });
    else if (b.kind === "text") body.push({ type: "TextBlock", text: b.text, wrap: true });
    else if (b.kind === "facts") body.push({ type: "FactSet", facts: b.items.map((x) => ({ title: x.label, value: x.value })) });
    else if (b.kind === "list") body.push({ type: "TextBlock", text: b.items.map((x) => `- ${x}`).join("\r"), wrap: true });
    else actions.push({ type: "Action.OpenUrl", title: b.label, url: b.url });
  }
  return {
    type: "message",
    summary: m.summary,
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body,
          ...(actions.length ? { actions } : {}),
        },
      },
    ],
  };
}

/** Discord: an embed (title, description, fields, links), within Discord's limits */
export function toDiscord(m: RichMessage): object {
  const [first, ...rest] = m.blocks;
  const title = first?.kind === "title" ? first.text : m.summary;
  const body = first?.kind === "title" ? rest : m.blocks;
  const fields = body.flatMap((b) =>
    b.kind === "facts" ? b.items.map((x) => ({ name: x.label.slice(0, 256), value: x.value.slice(0, 1024), inline: true })) : [],
  );
  const description = toMarkdown({ summary: m.summary, blocks: body.filter((b) => b.kind !== "facts") }).slice(0, 4096);
  return {
    embeds: [{ title: title.slice(0, 256), description, color: 0xb23a0b, ...(fields.length ? { fields: fields.slice(0, 25) } : {}) }],
  };
}
