import "server-only";
import Holidays from "date-holidays";

// Public holidays, country by country (and region by region where they differ), from the date-holidays data
// (ISC code, CC BY-SA 3.0 data drawn from Wikipedia). A meeting skips the sessions that fall on them: the
// schedule turns them into cancelled occurrences (lib/server/meeting/schedule.ts), the host may still hold one.

/** A meeting that skips no holiday although its workspace does */
export const NO_HOLIDAYS = "none";

const CODE = /^([A-Z]{2})(?:-([A-Z0-9]{1,5}))?$/;
let countryCodes: Set<string> | null = null;
const countries = () => (countryCodes ??= new Set(Object.keys(new Holidays().getCountries())));

/** Countries that have a holiday calendar (ISO codes) */
export const holidayCountries = (): string[] => [...countries()].sort();

/** Regions of a country whose holidays differ (Bavaria, California…), with their names; empty when none */
export function holidayRegions(country: string): Record<string, string> {
  if (!countries().has(country)) return {};
  return (new Holidays().getStates(country) as Record<string, string> | undefined) ?? {};
}

/** Whether a code names a known calendar: "FR", "DE-BY" */
export function isHolidayCode(code: string): boolean {
  const m = CODE.exec(code);
  if (!m || !countries().has(m[1]!)) return false;
  return !m[2] || m[2] in holidayRegions(m[1]!);
}

/** The calendar a meeting follows: its own choice ("none" for none), otherwise its workspace's */
export function holidaysOf(meeting: { holidays: string | null }, workspace: { settings?: unknown }): string | null {
  const own = meeting.holidays;
  if (own === NO_HOLIDAYS) return null;
  const code = own ?? (workspace.settings as { holidays?: string } | null)?.holidays ?? null;
  return code && isHolidayCode(code) ? code : null;
}

const byYear = new Map<string, Map<string, string>>();
/** Public holidays of one year: date → name (in the language asked when the data has it) */
function yearOf(code: string, year: number, lang: string): Map<string, string> {
  const id = `${code}:${year}:${lang}`;
  const known = byYear.get(id);
  if (known) return known;
  const [country, region] = code.split("-");
  const out = new Map<string, string>();
  const hd = region ? new Holidays(country!, region) : new Holidays(country!);
  for (const h of hd.getHolidays(year, lang) || []) {
    if (h.type !== "public") continue;
    // A holiday of several days (Eid in some countries) covers each of them
    const days = Math.max(1, Math.round((h.end.getTime() - h.start.getTime()) / 86_400_000));
    const first = Date.parse(`${h.date.slice(0, 10)}T12:00:00Z`);
    for (let i = 0; i < days; i++) {
      const date = new Date(first + i * 86_400_000).toISOString().slice(0, 10);
      if (!out.has(date)) out.set(date, h.name);
    }
  }
  byYear.set(id, out);
  return out;
}

/** Public holidays between two dates (inclusive): date → name */
export function publicHolidays(code: string, from: string, to: string, lang: string): Map<string, string> {
  const out = new Map<string, string>();
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++)
    for (const [date, name] of yearOf(code, y, lang)) if (date >= from && date <= to) out.set(date, name);
  return out;
}

let zones: Map<string, string[]> | null = null;
/**
 * The country a time zone belongs to, for a new workspace's first choice ("Europe/Paris" → "FR"); null when the
 * zone is shared by several countries or unknown
 */
export function guessHolidays(timeZone: string): string | null {
  if (!zones) {
    zones = new Map();
    for (const c of countries()) for (const tz of new Holidays(c).getTimezones() ?? []) zones.set(tz, [...(zones.get(tz) ?? []), c]);
  }
  const found = zones.get(timeZone) ?? [];
  return found.length === 1 ? found[0]! : null;
}
