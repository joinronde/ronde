import { dirOf, type Locale, translator } from "@ronde/i18n";

export type AuthEmailKind = "verify" | "magicLink" | "resetPassword" | "invitation";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Account emails (verification, sign-in link, password reset, invitation), in the recipient's language */
export function authEmail(
  kind: AuthEmailKind,
  { url, locale, workspace = "", inviter = "" }: { url: string; locale: Locale; workspace?: string; inviter?: string },
): { subject: string; text: string; html: string } {
  const t = translator(locale, "emails");
  const values = { workspace, inviter };
  const subject = t(`${kind}.subject`, values);
  const intro = t(`${kind}.intro`, values);
  const action = t(`${kind}.action`, values);
  const footer = t(`${kind}.footer`);
  const text = [intro, "", `${action}: ${url}`, "", footer].join("\n");
  // Arabic reads right to left: the whole email turns, its arrow too
  const dir = dirOf(locale);
  const html = `<!doctype html>
<html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body dir="${dir}" style="margin:0;padding:0;background-color:#FBF6EC;color:#2B1D0E;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#FBF6EC"><tr><td align="center" style="padding:20px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background-color:#FFFFFF;border:1px solid #E9DCC4;border-top:4px solid #B53B0A;border-radius:14px">
<tr><td style="padding:24px">
<p style="margin:0 0 18px;font-size:22px;font-weight:bold;letter-spacing:-1px">Ronde</p>
<h1 style="margin:0 0 12px;font-size:22px;line-height:1.3">${esc(subject)}</h1>
<p style="margin:0 0 20px">${esc(intro)}</p>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 16px"><tr><td bgcolor="#B53B0A" style="border-radius:8px"><a href="${esc(url)}" style="display:inline-block;padding:12px 22px;border-radius:8px;background-color:#B53B0A;color:#FFFFFF;font-weight:bold;text-decoration:none">${esc(action)} ${dir === "rtl" ? "←" : "→"}</a></td></tr></table>
<p style="margin:0;font-size:12px;color:#76624B;overflow-wrap:anywhere">${esc(t("fallbackLink"))} <a href="${esc(url)}" style="color:#B53B0A">${esc(url)}</a></p>
</td></tr><tr><td style="padding:16px 24px;border-top:1px solid #E9DCC4;background-color:#FBF6EC;border-radius:0 0 13px 13px;color:#76624B;font-size:12px">${esc(footer)}</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}
