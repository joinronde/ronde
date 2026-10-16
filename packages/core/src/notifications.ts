import { dirOf, formatters, type Locale, translator } from "@ronde/i18n";
import { markdownToHtml } from "./markdown";
import type { ActionStatus, SettingsDTO } from "./types";
import { first, fmtMinutes, hostName, plainItem, resolveSections } from "./util";

export type NotificationMessage = { text: string; html: string };
type NotificationSettings = Pick<SettingsDTO, "teamName" | "targetMin" | "speakSec" | "videoUrl" | "sections"> & {
  hostLabel?: string;
};

export const REMINDER_LOGO_CID = "ronde-logo";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const multiline = (s: string) => esc(s).replace(/\r?\n/g, "<br>");

/** Right-to-left languages (Arabic) in emails: the direction, the arrow of a link, the start and end sides */
function bidi(locale: Locale) {
  const rtl = dirOf(locale) === "rtl";
  return { dir: rtl ? "rtl" : "ltr", arrow: rtl ? "←" : "→", start: rtl ? "right" : "left", end: rtl ? "left" : "right" };
}

/** HTTP(S) links only; local paths are used by the preview in the settings. */
function safeLink(value: string): string {
  if (/^\/(?![/\\])/.test(value) && !/[\s\\]/.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

/** Absolute link to the viewer's check-in page, empty when the app URL is unknown */
export function notificationCheckInUrl(appUrl: string): string {
  const app = safeLink(appUrl);
  if (!app || app.startsWith("/")) return "";
  const url = new URL(app);
  url.pathname = url.pathname.replace(/\/+$/, "") + "/me";
  url.search = "";
  url.hash = "";
  return url.href;
}

function texts(s: NotificationSettings, locale: Locale) {
  const t = translator(locale, "notifications");
  const min = Math.floor(s.speakSec / 60);
  const sec = s.speakSec % 60;
  const speak = [min ? t("speak.minutes", { m: min }) : "", sec ? t("speak.seconds", { s: sec }) : ""].filter(Boolean).join(" ");
  const sections = resolveSections(s, locale).map((section) => t("quoted", { label: section.label }));
  return {
    t,
    timing: t("timing", { target: fmtMinutes(s.targetMin, locale), speak }),
    preparation: t("preparation", { sections: formatters(locale).list(sections) }),
    footer: t("email.footer", { host: hostName(s, locale) }),
  };
}

/** The workspace's own logo and name, in place of Ronde's (Team) */
export interface EmailBrand {
  name: string;
  /** Absolute address of the logo */
  logo: string;
}

export type ReminderEmailInput = {
  settings: NotificationSettings;
  locale: Locale;
  date: string;
  /** Local time of the session, "HH:MM" */
  time: string;
  name: string;
  checkInUrl: string;
  planned: string[];
  actions: { text: string; status: ActionStatus }[];
  /** Projects whose sheet the person still has to write for this session */
  sheets?: string[];
  /** CID when sent, path of the public image for the preview. */
  logoSrc?: string;
  brand?: EmailBrand | null;
  /** The instance reads replies (INBOUND_IMAP_URL): the email says the check-in can be written in a reply */
  reply?: boolean;
};

/** A single template for the email actually sent and its preview. */
export function reminderEmail({
  settings: s,
  locale,
  date,
  time,
  name,
  checkInUrl,
  planned,
  actions,
  sheets = [],
  logoSrc = `cid:${REMINDER_LOGO_CID}`,
  brand = null,
  reply = false,
}: ReminderEmailInput): NotificationMessage & { subject: string } {
  const b = bidi(locale);
  const { t, timing, preparation, footer } = texts(s, locale);
  const f = formatters(locale);
  const status = translator(locale, "actionStatus");
  const checkIn = safeLink(checkInUrl);
  const video = safeLink(s.videoUrl);
  const when = t("when", { date: f.date(date), time });
  const previous = planned.map(plainItem).filter((text) => text.trim());
  const todo = actions.filter((action) => action.status !== "done");
  const greeting = t("email.greeting", { name: first(name) });
  const intro = t("email.intro", { team: s.teamName });
  const subject = t("email.subject", { team: s.teamName, date: f.dateShort(date), time });
  // How a reply is written: each section's name on a line, the items under it
  const example = reply ? resolveSections(s, locale).flatMap((section) => [section.label, "- …"]) : [];
  const text = [
    greeting,
    "",
    intro,
    "",
    t("email.meeting", { when }),
    timing,
    "",
    t("email.prepare"),
    preparation,
    checkIn ? `${t("email.fillIn")}: ${checkIn}` : t("email.openApp"),
    ...(reply ? ["", t("email.replyTitle"), t("email.replyHint"), t("email.replyExample"), "", ...example] : []),
    ...(sheets.length ? ["", t("email.sheets"), ...sheets.map((p) => `- ${p}`)] : []),
    ...(previous.length ? ["", t("email.planned"), t("email.plannedHint"), ...previous.map((p) => `- ${p}`)] : []),
    ...(todo.length
      ? ["", t("email.actions"), t("email.actionsHint"), ...todo.map((a) => `- ${plainItem(a.text)} (${status(a.status)})`)]
      : []),
    ...(video ? ["", `${t("email.joinVideo")}: ${video}`] : []),
    "",
    t("email.thanks"),
    "",
    footer,
  ].join("\n");

  const heading = (label: string) => `<h2 style="margin:24px 0 8px;font-size:18px;line-height:1.4;color:#1F1A14">${esc(label)}</h2>`;
  const list = (items: string[]) =>
    `<ul style="margin:8px 0 0;padding-${b.start}:22px">${items.map((item) => `<li style="margin:6px 0;overflow-wrap:anywhere">${item}</li>`).join("")}</ul>`;
  const html = `<!doctype html>
<html lang="${locale}" dir="${b.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body dir="${b.dir}" style="margin:0;padding:0;background-color:#FAF8F5;color:#1F1A14;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;overflow-wrap:anywhere">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(t("email.preheader", { when }))}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#FAF8F5"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E5DFD5;border-top:4px solid #BB3E0C;border-radius:14px">
<tr><td style="padding:24px">
<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="padding-${b.end}:12px">${brand ? `<img src="${esc(brand.logo)}" alt="" height="48" style="display:block;border:0;height:48px;width:auto;max-width:160px">` : `<img src="${esc(logoSrc)}" alt="" width="48" height="48" style="display:block;border:0">`}</td><td><p style="margin:0;font-size:26px;font-weight:bold;letter-spacing:-1px">${esc(brand?.name ?? "Ronde")}</p><p style="margin:0;color:#6F665C;font-size:13px">${esc(s.teamName)} · ${esc(t("email.tagline"))}</p></td></tr></table>
<h1 style="margin:26px 0 16px;font-size:26px;line-height:1.25;color:#1F1A14">${esc(t("email.title"))}</h1>
<p style="margin:0 0 10px">${esc(greeting)}</p><p style="margin:0 0 20px">${esc(intro)}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#FEEEE2;border-radius:10px"><tr><td style="padding:16px"><p style="margin:0 0 4px;color:#BB3E0C;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">${esc(t("email.appointment"))}</p><p style="margin:0;font-size:17px;font-weight:bold">${esc(when)}</p><p style="margin:6px 0 0;font-size:13px;color:#544B42">${esc(timing)}</p></td></tr></table>
${heading(t("email.prepare"))}<p style="margin:0">${esc(preparation)}</p>
${checkIn ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:18px 0"><tr><td bgcolor="#BB3E0C" style="border-radius:8px"><a href="${esc(checkIn)}" style="display:inline-block;padding:12px 22px;border:1px solid #BB3E0C;border-radius:8px;background-color:#BB3E0C;color:#FFFFFF;font-weight:bold;text-decoration:none">${esc(t("email.fillIn"))} ${b.arrow}</a></td></tr></table><p style="margin:0;font-size:12px;color:#6F665C;overflow-wrap:anywhere">${esc(t("email.fallbackLink"))} <a href="${esc(checkIn)}" style="color:#BB3E0C">${esc(checkIn)}</a></p>` : `<p style="margin:16px 0 0;font-weight:bold">${esc(t("email.openApp"))}</p>`}
${reply ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:22px 0 0;background-color:#FAF8F5;border:1px dashed #E0C9A6;border-radius:10px"><tr><td style="padding:14px 16px"><p style="margin:0 0 4px;font-weight:bold">${esc(t("email.replyTitle"))}</p><p style="margin:0 0 8px;font-size:14px;color:#544B42">${esc(t("email.replyHint"))} ${esc(t("email.replyExample"))}</p><p style="margin:0;font-family:Menlo,Consolas,monospace;font-size:13px;line-height:1.5;color:#1F1A14">${example.map(esc).join("<br>")}</p></td></tr></table>` : ""}
${sheets.length ? `${heading(t("email.sheets"))}${list(sheets.map(esc))}` : ""}
${previous.length ? `${heading(t("email.planned"))}<p style="margin:0;color:#544B42">${esc(t("email.plannedHint"))}</p>${list(previous.map(multiline))}` : ""}
${todo.length ? `${heading(t("email.actions"))}<p style="margin:0;color:#544B42">${esc(t("email.actionsHint"))}</p>${list(todo.map((a) => `${multiline(plainItem(a.text))} <strong style="color:#544B42;font-size:13px">(${esc(status(a.status))})</strong>`))}` : ""}
${video ? `<p style="margin:24px 0 0"><a href="${esc(video)}" style="color:#BB3E0C;font-weight:bold">${esc(t("email.joinVideo"))} ${b.arrow}</a></p>` : ""}
<p style="margin:24px 0 0">${esc(t("email.thanks"))}</p>
</td></tr><tr><td style="padding:16px 24px;border-top:1px solid #E5DFD5;border-radius:0 0 13px 13px;background-color:#FAF8F5;color:#6F665C;font-size:12px">${esc(footer)}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

export type ReplyEmailInput = {
  locale: Locale;
  name: string;
  teamName: string;
  /** What the reply added, section by section (empty: nothing found) */
  added: { label: string; items: string[] }[];
  /** Something was found, but it was all in the check-in already */
  already: boolean;
  /** The person's check-in in Ronde */
  url: string;
  brand?: EmailBrand | null;
};

/** The answer to a check-in written by email: what went into it, or how to write it when nothing was found */
export function checkInReplyEmail({
  locale,
  name,
  teamName,
  added,
  already,
  url,
  brand = null,
}: ReplyEmailInput): NotificationMessage & { subject: string } {
  const b = bidi(locale);
  const t = translator(locale, "notifications");
  const link = safeLink(url);
  const subject = t("replied.subject", { team: teamName });
  const lead = added.length
    ? t("replied.intro", { name: first(name), team: teamName })
    : already
      ? t("replied.already")
      : t("replied.nothing");
  const text = [
    lead,
    ...added.flatMap((s) => ["", s.label, ...s.items.map((i) => `- ${plainItem(i)}`)]),
    ...(link ? ["", `${t("replied.open")}: ${link}`] : []),
    "",
    t("replied.footer"),
  ].join("\n");
  const html = `<!doctype html>
<html lang="${locale}" dir="${b.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body dir="${b.dir}" style="margin:0;padding:0;background-color:#FAF8F5;color:#1F1A14;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;overflow-wrap:anywhere">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#FAF8F5"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E5DFD5;border-top:4px solid #BB3E0C;border-radius:14px">
<tr><td style="padding:24px">
<p style="margin:0;font-size:22px;font-weight:bold;letter-spacing:-0.5px">${esc(brand?.name ?? "Ronde")}</p>
<h1 style="margin:18px 0 12px;font-size:22px;line-height:1.3">${esc(added.length ? t("replied.title") : subject)}</h1>
<p style="margin:0">${esc(lead)}</p>
${added
  .map(
    (s) =>
      `<p style="margin:18px 0 4px;font-weight:bold">${esc(s.label)}</p><ul style="margin:0;padding-${b.start}:22px">${s.items.map((i) => `<li style="margin:4px 0">${multiline(plainItem(i))}</li>`).join("")}</ul>`,
  )
  .join("")}
${link ? `<p style="margin:22px 0 0"><a href="${esc(link)}" style="color:#BB3E0C;font-weight:bold">${esc(t("replied.open"))} ${b.arrow}</a></p>` : ""}
</td></tr><tr><td style="padding:16px 24px;border-top:1px solid #E5DFD5;border-radius:0 0 13px 13px;background-color:#FAF8F5;color:#6F665C;font-size:12px">${esc(t("replied.footer"))}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

export type DigestEmailInput = {
  teamName: string;
  locale: Locale;
  /** Date of the session */
  date: string;
  name: string;
  /** The minutes, in Markdown */
  minutes: string;
  /** Link to the meeting in Ronde (empty: left out) */
  url: string;
  brand?: EmailBrand | null;
};

/** Digest of a session run without a live meeting: the minutes, sent to the participants */
export function digestEmail({
  teamName,
  locale,
  date,
  name,
  minutes,
  url,
  brand = null,
}: DigestEmailInput): NotificationMessage & { subject: string } {
  const b = bidi(locale);
  const t = translator(locale, "digest");
  const f = formatters(locale);
  const link = safeLink(url);
  const subject = t("subject", { team: teamName, date: f.dateShort(date) });
  const greeting = t("greeting", { name: first(name) });
  const intro = t("intro", { team: teamName, date: f.date(date) });
  const text = [
    greeting,
    "",
    intro,
    "",
    minutes,
    "",
    ...(link ? [`${t(brand ? "openBranded" : "open")}: ${link}`, ""] : []),
    t(brand ? "footerBranded" : "footer", { team: teamName }),
  ].join("\n");
  const html = `<!doctype html>
<html lang="${locale}" dir="${b.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body dir="${b.dir}" style="margin:0;padding:0;background-color:#FAF8F5;color:#1F1A14;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;overflow-wrap:anywhere">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#FAF8F5"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background-color:#FFFFFF;border:1px solid #E5DFD5;border-top:4px solid #BB3E0C;border-radius:14px">
<tr><td style="padding:24px">
${brand ? `<img src="${esc(brand.logo)}" alt="${esc(brand.name)}" height="40" style="display:block;border:0;height:40px;width:auto;max-width:160px;margin:0 0 18px">` : ""}
<p style="margin:0 0 10px">${esc(greeting)}</p><p style="margin:0 0 20px">${esc(intro)}</p>
<div>${markdownToHtml(minutes)}</div>
${link ? `<p style="margin:24px 0 0"><a href="${esc(link)}" style="color:#BB3E0C;font-weight:bold">${esc(t(brand ? "openBranded" : "open"))} ${b.arrow}</a></p>` : ""}
</td></tr><tr><td style="padding:16px 24px;border-top:1px solid #E5DFD5;border-radius:0 0 13px 13px;background-color:#FAF8F5;color:#6F665C;font-size:12px">${esc(t(brand ? "footerBranded" : "footer", { team: teamName }))}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

export type WeeklyEmailInput = {
  locale: Locale;
  /** The person's name, and the workspace the summary is about */
  name: string;
  workspace: string;
  /** Sessions of the week where the person takes part, in order, each with its check-in page */
  sessions: { date: string; time: string; meeting: string; url: string; moved?: boolean }[];
  /** Their follow-up actions still open */
  actions: { text: string; meeting: string; status: ActionStatus; carried: number }[];
  /** Kudos received in the last seven days */
  kudos: { from: string; text: string }[];
  /** The workspace in Ronde, the account settings, and the one-click way out */
  url: string;
  settingsUrl: string;
  unsubscribeUrl: string;
  logoSrc?: string;
  brand?: EmailBrand | null;
};

/**
 * Monday's summary of a person's week in a workspace: their sessions with a link to each check-in, the
 * follow-up actions they still have open, and the kudos they received. Sent only when one of them is not empty.
 */
export function weeklyEmail({
  locale,
  name,
  workspace,
  sessions,
  actions,
  kudos,
  url,
  settingsUrl,
  unsubscribeUrl,
  logoSrc = `cid:${REMINDER_LOGO_CID}`,
  brand = null,
}: WeeklyEmailInput): NotificationMessage & { subject: string } {
  const b = bidi(locale);
  const t = translator(locale, "weekly");
  const f = formatters(locale);
  const status = translator(locale, "actionStatus");
  const home = safeLink(url);
  const settings = safeLink(settingsUrl);
  const out = safeLink(unsubscribeUrl);
  const subject = t("subject", { workspace });
  const greeting = t("greeting", { name: first(name) });
  const intro = t("intro", { workspace });
  const preheader = t("preheader", { sessions: sessions.length, actions: actions.length });
  const when = (s: WeeklyEmailInput["sessions"][number]) => t("when", { date: f.date(s.date), time: s.time });
  const carried = (a: WeeklyEmailInput["actions"][number]) => (a.carried ? ` · ${t("carried", { count: a.carried })}` : "");
  const text = [
    greeting,
    "",
    intro,
    ...(sessions.length
      ? [
          "",
          t("sessions"),
          ...sessions.map((s) => `- ${when(s)} · ${s.meeting}${safeLink(s.url) ? ` · ${t("checkIn")}: ${safeLink(s.url)}` : ""}`),
        ]
      : []),
    ...(actions.length
      ? [
          "",
          t("actions"),
          t("actionsHint"),
          ...actions.map((a) => `- ${plainItem(a.text)} (${a.meeting} · ${status(a.status)}${carried(a)})`),
        ]
      : []),
    ...(kudos.length ? ["", t("kudos"), ...kudos.map((k) => `- “${k.text}” ${t("from", { name: k.from })}`)] : []),
    ...(home ? ["", `${t("open")}: ${home}`] : []),
    "",
    t("footer", { workspace }),
    ...(out ? [`${t("stop")}: ${out}`] : []),
  ].join("\n");

  const heading = (label: string) => `<h2 style="margin:24px 0 8px;font-size:18px;line-height:1.4;color:#1F1A14">${esc(label)}</h2>`;
  const row = (main: string, aside: string) =>
    `<tr><td style="padding:10px 0;border-top:1px solid #F1E7D6;vertical-align:top">${main}</td><td align="${b.end}" style="padding:10px 0;padding-${b.start}:12px;border-top:1px solid #F1E7D6;vertical-align:top;white-space:nowrap">${aside}</td></tr>`;
  const table = (rows: string[]) =>
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:4px 0 0">${rows.join("")}</table>`;
  const sessionRows = sessions.map((s) => {
    const link = safeLink(s.url);
    return row(
      `<strong>${esc(s.meeting)}</strong><br><span style="color:#544B42;font-size:13px">${esc(when(s))}${s.moved ? ` · ${esc(t("moved"))}` : ""}</span>`,
      link ? `<a href="${esc(link)}" style="color:#BB3E0C;font-weight:bold;font-size:13px">${esc(t("checkIn"))} ${b.arrow}</a>` : "",
    );
  });
  const actionRows = actions.map((a) =>
    row(
      `${multiline(plainItem(a.text))}<br><span style="color:#544B42;font-size:13px">${esc(a.meeting)}${esc(carried(a))}</span>`,
      `<span style="display:inline-block;padding:2px 8px;border-radius:99px;background-color:${a.status === "doing" ? "#FEEEE2" : "#F3ECE0"};color:${a.status === "doing" ? "#BB3E0C" : "#544B42"};font-size:12px;font-weight:bold">${esc(status(a.status))}</span>`,
    ),
  );
  const kudosRows = kudos.map(
    (k) =>
      `<tr><td style="padding:10px 12px;background-color:#FDF3E7;border-radius:10px"><span dir="auto">“${multiline(k.text)}”</span><br><span style="color:#544B42;font-size:13px">${esc(t("from", { name: k.from }))}</span></td></tr><tr><td style="height:8px;line-height:8px;font-size:0">&nbsp;</td></tr>`,
  );
  const html = `<!doctype html>
<html lang="${locale}" dir="${b.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body dir="${b.dir}" style="margin:0;padding:0;background-color:#FAF8F5;color:#1F1A14;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;overflow-wrap:anywhere">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${esc(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#FAF8F5"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E5DFD5;border-top:4px solid #BB3E0C;border-radius:14px">
<tr><td style="padding:24px">
<table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="padding-${b.end}:12px">${brand ? `<img src="${esc(brand.logo)}" alt="" height="48" style="display:block;border:0;height:48px;width:auto;max-width:160px">` : `<img src="${esc(logoSrc)}" alt="" width="48" height="48" style="display:block;border:0">`}</td><td><p style="margin:0;font-size:26px;font-weight:bold;letter-spacing:-1px">${esc(brand?.name ?? "Ronde")}</p><p style="margin:0;color:#6F665C;font-size:13px">${esc(workspace)}</p></td></tr></table>
<h1 style="margin:26px 0 16px;font-size:26px;line-height:1.25;color:#1F1A14">${esc(t("title"))}</h1>
<p style="margin:0 0 10px">${esc(greeting)}</p><p style="margin:0">${esc(intro)}</p>
${sessions.length ? `${heading(t("sessions"))}${table(sessionRows)}` : ""}
${actions.length ? `${heading(t("actions"))}<p style="margin:0;color:#544B42">${esc(t("actionsHint"))}</p>${table(actionRows)}` : ""}
${kudos.length ? `${heading(t("kudos"))}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:4px 0 0">${kudosRows.join("")}</table>` : ""}
${home ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0 0"><tr><td bgcolor="#BB3E0C" style="border-radius:8px"><a href="${esc(home)}" style="display:inline-block;padding:12px 22px;border:1px solid #BB3E0C;border-radius:8px;background-color:#BB3E0C;color:#FFFFFF;font-weight:bold;text-decoration:none">${esc(t("open"))} ${b.arrow}</a></td></tr></table>` : ""}
</td></tr><tr><td style="padding:16px 24px;border-top:1px solid #E5DFD5;border-radius:0 0 13px 13px;background-color:#FAF8F5;color:#6F665C;font-size:12px">${esc(t("footer", { workspace }))}${settings ? ` <a href="${esc(settings)}" style="color:#6F665C">${esc(t("settings"))}</a>` : ""}${out ? ` · <a href="${esc(out)}" style="color:#6F665C">${esc(t("stop"))}</a>` : ""}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}
