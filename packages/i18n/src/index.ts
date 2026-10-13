// Locales supported by Ronde and helpers shared by the server, the browser and plain TypeScript modules.
import { createTranslator } from "next-intl";
import { type Messages, messages } from "./messages";

/** The most-spoken languages of the world, then German and Italian (Chinese is Mandarin, in simplified characters) */
export const locales = ["en", "zh", "hi", "es", "ar", "fr", "pt", "ru", "de", "it"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "en";

/** Native name of each locale, for the language switcher */
export const localeNames: Record<Locale, string> = {
  en: "English",
  zh: "中文",
  hi: "हिन्दी",
  es: "Español",
  ar: "العربية",
  fr: "Français",
  pt: "Português",
  ru: "Русский",
  de: "Deutsch",
  it: "Italiano",
};

/** Languages written from right to left */
export const isRtl = (locale: Locale) => locale === "ar";
/** Value of the dir attribute of a page in this language */
export const dirOf = (locale: Locale): "ltr" | "rtl" => (isRtl(locale) ? "rtl" : "ltr");

/** Cookie that stores the language picked by the viewer */
export const LOCALE_COOKIE = "ronde-locale";

export const isLocale = (value: unknown): value is Locale => typeof value === "string" && (locales as readonly string[]).includes(value);

/** Best supported locale for an Accept-Language header ("fr-FR,fr;q=0.9,en;q=0.8" → "fr") */
export function negotiateLocale(acceptLanguage: string | null | undefined, fallback: Locale = defaultLocale): Locale {
  const ranked = String(acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => /^q=([\d.]+)$/.exec(p.trim())?.[1]).find(Boolean);
      return { tag: tag.toLowerCase(), q: q ? Number(q) : 1 };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (isLocale(tag)) return tag;
    if (isLocale(base)) return base;
  }
  return fallback;
}

/** Locale to use, from the most specific preference to the least specific one */
export function resolveLocale(...candidates: unknown[]): Locale {
  return candidates.find(isLocale) ?? defaultLocale;
}

/** Catalog of a locale; a locale whose catalog is not written yet reads the English one */
export const messagesFor = (locale: Locale): Messages => (messages as Partial<Record<Locale, Messages>>)[locale] ?? messages.en;

type Namespace = keyof Messages;

/**
 * Translator usable outside React (minutes, notifications, emails, server errors).
 * Missing keys throw in tests through `onError`, and fall back to the key elsewhere.
 */
export function translator<N extends Namespace>(locale: Locale, namespace: N) {
  return createTranslator({ locale, messages: messagesFor(locale), namespace, onError: onMissing });
}

let strict = false;
/** Make missing or invalid messages throw (used by the test suites) */
export const setStrictMessages = (value: boolean) => {
  strict = value;
};
function onMissing(error: Error) {
  if (strict) throw error;
  console.warn(error.message);
}

/** Intl formatters bound to a locale; dates use the noon UTC trick so a calendar day never shifts */
export function formatters(locale: Locale) {
  const day = (iso: string) => new Date(`${iso}T12:00:00`);
  const fmt = (iso: string, options: Intl.DateTimeFormatOptions) => (iso ? day(iso).toLocaleDateString(locale, options) : "");
  return {
    /** "Monday, October 5, 2026" */
    date: (iso: string) => fmt(iso, { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    /** "Monday, October 5" */
    dateShort: (iso: string) => fmt(iso, { weekday: "long", day: "numeric", month: "long" }),
    /** "Oct 5" */
    dayMonth: (iso: string) => fmt(iso, { day: "numeric", month: "short" }),
    /** "Oct 5, 2026" */
    dayMonthYear: (iso: string) => fmt(iso, { day: "numeric", month: "short", year: "numeric" }),
    /** Name of a weekday, 0 = Sunday */
    weekday: (index: number) => new Date(Date.UTC(2023, 0, 1 + index, 12)).toLocaleDateString(locale, { weekday: "long", timeZone: "UTC" }),
    /** Name of a month, 1 = January */
    month: (index: number) => new Date(Date.UTC(2023, index - 1, 1, 12)).toLocaleDateString(locale, { month: "long", timeZone: "UTC" }),
    /** "Alice, Bob and Carol" */
    list: (items: string[]) => new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items),
    /** "4.2" or "4,2" */
    decimal: (value: number, digits = 1) => value.toLocaleString(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }),
    /** "42%" */
    percent: (value: number) => value.toLocaleString(locale, { style: "percent", maximumFractionDigits: 0 }),
  };
}
export type Formatters = ReturnType<typeof formatters>;

export type { Messages };
