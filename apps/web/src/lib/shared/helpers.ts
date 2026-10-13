import type { NotifyEvent } from "@ronde/core/notify";
import type { NotifyConnectorDTO } from "@ronde/core/types";
import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";

// Small pieces of the pages' logic, kept out of the components so the server-free tests check them

/** Where a new notification rule sends, for a connector: to the meeting's participants, or a room to name */
export const defaultTarget = (kind: NotifyConnectorDTO["kind"]): Record<string, string> =>
  kind === "email" || kind === "sms" || kind === "whatsapp" ? { audience: "participants" } : kind === "matrix" ? { room: "" } : {};

/** The settings a new rule starts with for an event: how long before a session, after how many days late */
export const defaultOptions = (event: NotifyEvent): Record<string, number> =>
  event === "session.soon" ? { minutesBefore: 10 } : event === "action.overdue" ? { days: 7 } : {};

/** One entry of a drawn select */
export interface Choice {
  value: string;
  label: ReactNode;
  /** Text used for type-ahead */
  text: string;
  disabled: boolean;
  group: string | null;
  lang?: string;
}

/** The text of a piece of React content, for type-ahead: strings and numbers, through elements and lists */
export const textOf = (node: ReactNode): string =>
  typeof node === "string" || typeof node === "number"
    ? String(node)
    : Array.isArray(node)
      ? node.map(textOf).join("")
      : isValidElement(node)
        ? textOf((node.props as { children?: ReactNode }).children)
        : "";

/** The entries of a select from its <option> and <optgroup> children, as a native <select> reads them */
export function choicesOf(children: ReactNode, group: string | null = null): Choice[] {
  const out: Choice[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean; label?: string; lang?: string }>;
    if (el.type === "optgroup") out.push(...choicesOf(el.props.children, el.props.label ?? null));
    else if (el.type === "option")
      out.push({
        value: String(el.props.value ?? textOf(el.props.children)),
        label: el.props.children,
        text: textOf(el.props.children),
        disabled: !!el.props.disabled,
        group,
        lang: el.props.lang,
      });
    else if (el.type === Fragment) out.push(...choicesOf((el.props as { children?: ReactNode }).children, group));
  });
  return out;
}

/** The VAPID public key, as the browser wants it */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const raw = atob((base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** "Chrome · Android" from a user agent: enough to tell one's devices apart in the list */
export function deviceLabelOf(ua: string): string {
  // Edge and Samsung Internet also say Chrome, and Chrome also says Safari: the most specific first
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "";
  // Android says Linux too
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return [browser, os].filter(Boolean).join(" · ");
}

/** Seconds as minutes and seconds, minutes as hours and minutes */
export const splitDuration = (v: number) => [Math.floor(v / 60), v % 60] as const;

/** "12 minutes ago", "yesterday"; under a minute, "just now" (`now` is there for the tests) */
export function ago(iso: string, locale: string, justNow: string, now = Date.now()): string {
  const minutes = Math.round((Date.parse(iso) - now) / 60_000);
  if (minutes === 0) return justNow;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  if (Math.abs(minutes) < 24 * 60) return rtf.format(Math.round(minutes / 60), "hour");
  return rtf.format(Math.round(minutes / (24 * 60)), "day");
}

/** The first line of a description, without its Markdown marks */
export const firstLine = (md: string) => (md.split("\n").find((l) => l.trim()) ?? "").replace(/^#+\s*|[*_`]/g, "").trim();

/** The name of a holiday calendar in the reader's language: "France", "Germany · Bayern" */
export function holidayName(code: string | null, locale: string, regions: Record<string, string> = {}): string {
  if (!code) return "";
  const [country = "", region] = code.split("-");
  let name = country;
  try {
    name = new Intl.DisplayNames([locale], { type: "region" }).of(country) ?? country;
  } catch {
    // An old browser without region names: the code
  }
  return region ? `${name} · ${regions[region] ?? region}` : name;
}
