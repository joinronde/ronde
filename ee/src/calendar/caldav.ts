// Ronde Enterprise Edition. Copyright (c) Ronde. Licensed under the Ronde Enterprise License (see ee/LICENSE).
import { randomUUID } from "node:crypto";
import { foldLine, icsText } from "@ronde/core/ics";
import { zonedInstant } from "@ronde/core/schedule";
import type { CalendarAccess, CalendarEventInput, CalendarEventState } from "@ronde/editions/ee";
import { ProviderError } from "../providers";

// CalDAV calendars (iCloud, Fastmail, Nextcloud, SOGo, Radicale…): each session is an iCalendar file in the
// organizer's calendar, the server inviting the attendees (CalDAV scheduling); read back for what changed there.

const DAV = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"';
const NS = "(?:[\\w-]+:)?";

const basic = (a: CalendarAccess) => `Basic ${Buffer.from(`${a.config.username ?? ""}:${a.secret}`).toString("base64")}`;

async function dav(a: CalendarAccess, url: string, method: string, body?: string, headers: Record<string, string> = {}): Promise<Response> {
  const res = await (a.fetch ?? fetch)(url, {
    method,
    headers: { authorization: basic(a), ...headers },
    ...(body === undefined ? {} : { body }),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401 || res.status === 403)
    throw new ProviderError(`${res.status}: the server refused the user name or password`, res.status);
  return res;
}

const decodeXml = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** The responses of a multistatus answer: each one's address and the XML of its properties */
function responses(xml: string): { href: string; body: string }[] {
  const out: { href: string; body: string }[] = [];
  for (const m of xml.matchAll(new RegExp(`<${NS}response\\b[^>]*>([\\s\\S]*?)</${NS}response>`, "gi"))) {
    const href = new RegExp(`<${NS}href\\b[^>]*>([^<]*)</${NS}href>`, "i").exec(m[1]!)?.[1]?.trim();
    if (href) out.push({ href: decodeXml(href), body: m[1]! });
  }
  return out;
}

const prop = (body: string, name: string) => new RegExp(`<${NS}${name}\\b[^>]*>([\\s\\S]*?)</${NS}${name}>`, "i").exec(body)?.[1];
const hrefIn = (xml: string | undefined) =>
  xml ? decodeXml(new RegExp(`<${NS}href\\b[^>]*>([^<]*)<`, "i").exec(xml)?.[1]?.trim() ?? "") : "";
/** A calendar collection that holds events (not a task list, an inbox or an outbox) */
function eventCalendar(body: string): boolean {
  const type = prop(body, "resourcetype") ?? "";
  if (!new RegExp(`<${NS}calendar[\\s/>]`, "i").test(type)) return false;
  const components = prop(body, "supported-calendar-component-set");
  return !components || /name="VEVENT"/i.test(components);
}

async function propfind(a: CalendarAccess, url: string, depth: 0 | 1, props: string) {
  const res = await dav(
    a,
    url,
    "PROPFIND",
    `<?xml version="1.0" encoding="utf-8"?><d:propfind ${DAV}><d:prop>${props}</d:prop></d:propfind>`,
    { depth: String(depth), "content-type": "application/xml; charset=utf-8" },
  );
  if (res.status !== 207) throw new ProviderError(`${res.status}: no CalDAV answer at ${new URL(url).host}`, res.status);
  return responses(await res.text());
}

const withSlash = (u: string) => (u.endsWith("/") ? u : `${u}/`);
const found = new Map<string, { at: number; url: string }>();

/**
 * The calendar sessions go to: the address given when it is a calendar, otherwise the first calendar of events of
 * the account, found from the server's address (its principal, then its calendar home). Kept an hour.
 */
export async function calendarUrl(a: CalendarAccess): Promise<string> {
  const start = (a.config.url ?? "").trim();
  const key = `${start}|${a.config.username ?? ""}`;
  const hit = found.get(key);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.url;
  const here = (await propfind(a, start, 0, "<d:resourcetype/><d:current-user-principal/><c:supported-calendar-component-set/>"))[0];
  let url: string | null = null;
  if (here && eventCalendar(here.body)) url = withSlash(start);
  else {
    let principal = hrefIn(here && prop(here.body, "current-user-principal"));
    // Servers that only answer on their well-known address
    if (!principal) {
      const known = (
        await propfind(a, new URL("/.well-known/caldav", start).toString(), 0, "<d:current-user-principal/>").catch(() => [])
      )[0];
      principal = hrefIn(known && prop(known.body, "current-user-principal"));
    }
    if (!principal) throw new ProviderError("404: no CalDAV account at this address", 404);
    const p = (await propfind(a, new URL(principal, start).toString(), 0, "<c:calendar-home-set/>"))[0];
    const home = hrefIn(p && prop(p.body, "calendar-home-set"));
    if (!home) throw new ProviderError("404: the account has no calendars", 404);
    const homeUrl = new URL(home, start).toString();
    const list = await propfind(a, homeUrl, 1, "<d:resourcetype/><c:supported-calendar-component-set/>");
    const calendar = list.find((r) => eventCalendar(r.body));
    if (!calendar) throw new ProviderError("404: the account has no calendar of events", 404);
    url = withSlash(new URL(calendar.href, homeUrl).toString());
  }
  found.set(key, { at: Date.now(), url });
  return url;
}

const stamp = (ms: number) => `${new Date(ms).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;

/** The event as an iCalendar file: in UTC, the organizer and the attendees with their answers so far */
function eventIcs(a: CalendarAccess, e: CalendarEventInput, uid: string, answers: Record<string, string>): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ronde//Calendar sync//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp(Date.now())}`,
    // Grows with every write: clients and servers take the newest version of an invitation
    `SEQUENCE:${Math.max(0, Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 1000))}`,
    `DTSTART:${stamp(Date.parse(e.start))}`,
    `DTEND:${stamp(Date.parse(e.end))}`,
    `SUMMARY:${icsText(e.title)}`,
    `DESCRIPTION:${icsText(e.description)}`,
    ...(e.location ? [`LOCATION:${icsText(e.location)}`] : []),
    `ORGANIZER:mailto:${a.config.organizer ?? ""}`,
    ...e.attendees.map(
      (m) => `ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=${answers[m.toLowerCase()] ?? "NEEDS-ACTION"};RSVP=TRUE:mailto:${m}`,
    ),
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

/** The properties of the first event of an iCalendar file, lines unfolded: name, parameters, value */
function eventLines(ics: string): { name: string; params: Record<string, string>; value: string }[] {
  const text = ics.replace(/\r?\n[ \t]/g, "");
  const block = /BEGIN:VEVENT\r?\n([\s\S]*?)END:VEVENT/.exec(text)?.[1] ?? "";
  return block
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      // The value starts at the first colon outside a quoted parameter
      let quoted = false;
      let at = -1;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') quoted = !quoted;
        else if (line[i] === ":" && !quoted) {
          at = i;
          break;
        }
      }
      const head = at < 0 ? line : line.slice(0, at);
      const [name = "", ...rest] = head.split(";");
      const params = Object.fromEntries(
        rest.map((p) => {
          const [k = "", ...v] = p.split("=");
          return [k.toUpperCase(), v.join("=").replace(/^"|"$/g, "")];
        }),
      );
      return { name: name.toUpperCase(), params, value: at < 0 ? "" : line.slice(at + 1) };
    });
}

/** An instant of the file: UTC, or in the zone it names; null for a whole day or a time without a zone */
function instant(value: string, params: Record<string, string>): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m || params.VALUE === "DATE" || !m[4]) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (z) return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  if (!params.TZID) return null;
  try {
    return zonedInstant(`${y}-${mo}-${d}`, `${h}:${mi}`, params.TZID);
  } catch {
    // A zone named by Windows ("Romance Standard Time"): not known here, the time is left alone
    return null;
  }
}

/** ISO 8601 durations of iCalendar: P1D, PT1H30M… */
function durationMs(value: string): number | null {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, w = "0", d = "0", h = "0", mi = "0", s = "0"] = m;
  return ((Number(w) * 7 + Number(d)) * 86_400 + Number(h) * 3600 + Number(mi) * 60 + Number(s)) * 1000;
}

const PARTSTAT: Record<string, CalendarEventState["answers"][string]> = {
  ACCEPTED: "accepted",
  DECLINED: "declined",
  TENTATIVE: "tentative",
};

export function parseEvent(ics: string): CalendarEventState {
  const lines = eventLines(ics);
  const one = (name: string) => lines.find((l) => l.name === name);
  const start = one("DTSTART");
  const startMs = start ? instant(start.value, start.params) : null;
  const end = one("DTEND");
  const duration = one("DURATION");
  const endMs = end ? instant(end.value, end.params) : startMs !== null && duration ? startMs + (durationMs(duration.value) ?? 0) : null;
  const answers: CalendarEventState["answers"] = {};
  for (const l of lines.filter((x) => x.name === "ATTENDEE")) {
    const email = l.value
      .replace(/^mailto:/i, "")
      .trim()
      .toLowerCase();
    if (email) answers[email] = PARTSTAT[(l.params.PARTSTAT ?? "").toUpperCase()] ?? "none";
  }
  return {
    cancelled: (one("STATUS")?.value ?? "").toUpperCase() === "CANCELLED",
    start: startMs === null ? null : new Date(startMs).toISOString(),
    end: endMs === null ? null : new Date(endMs).toISOString(),
    answers,
  };
}

export async function read(a: CalendarAccess, eventId: string): Promise<CalendarEventState | null> {
  const res = await dav(a, eventId, "GET");
  if (res.status === 404 || res.status === 410) return null;
  if (!res.ok) throw new ProviderError(`${res.status}: the event could not be read`, res.status);
  return parseEvent(await res.text());
}

export async function upsert(a: CalendarAccess, e: CalendarEventInput, eventId?: string): Promise<string> {
  const href = eventId ?? new URL(`ronde-${randomUUID()}.ics`, await calendarUrl(a)).toString();
  const uid = decodeURIComponent(href.split("/").pop() ?? "").replace(/\.ics$/i, "") || randomUUID();
  // Rewriting an event keeps what its attendees answered, unless it moved (a new time asks them again)
  let answers: Record<string, string> = {};
  if (eventId) {
    const now = await read(a, eventId).catch(() => null);
    if (now && now.start === new Date(e.start).toISOString() && now.end === new Date(e.end).toISOString())
      answers = Object.fromEntries(
        Object.entries(now.answers)
          .filter(([, v]) => v !== "none")
          .map(([k, v]) => [k, v.toUpperCase()]),
      );
  }
  const res = await dav(a, href, "PUT", eventIcs(a, e, uid, answers), { "content-type": "text/calendar; charset=utf-8" });
  if (!res.ok) throw new ProviderError(`${res.status}: the calendar refused the event`, res.status);
  return href;
}

export async function remove(a: CalendarAccess, eventId: string): Promise<void> {
  const res = await dav(a, eventId, "DELETE");
  if (!res.ok && res.status !== 404 && res.status !== 410)
    throw new ProviderError(`${res.status}: the event could not be removed`, res.status);
}

/** Busy periods of a VFREEBUSY answer, or of the events of a calendar-query answer */
function periods(ics: string): { start: string; end: string }[] {
  const text = ics.replace(/\r?\n[ \t]/g, "");
  const out: { start: string; end: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^FREEBUSY([^:]*):(.+)$/i.exec(line);
    if (!m || /FBTYPE=FREE\b/i.test(m[1]!)) continue;
    for (const period of m[2]!.split(",")) {
      const [from = "", to = ""] = period.split("/");
      const s = instant(from, {});
      const e = to.startsWith("P") ? (s === null ? null : s + (durationMs(to) ?? 0)) : instant(to, {});
      if (s !== null && e !== null) out.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString() });
    }
  }
  for (const block of text.split("BEGIN:VEVENT").slice(1)) {
    const e = parseEvent(`BEGIN:VEVENT${block}`);
    if (!e.cancelled && e.start && e.end) out.push({ start: e.start, end: e.end });
  }
  return out;
}

/**
 * Busy times: a CalDAV server only shows the account's own calendar, so the organizer's alone; the others are
 * not known (the interface says whose calendar could not be read)
 */
export async function busy(
  a: CalendarAccess,
  emails: string[],
  range: { from: string; to: string },
): Promise<Record<string, { start: string; end: string }[]>> {
  const organizer = (a.config.organizer ?? "").toLowerCase();
  const own = emails.find((e) => e.toLowerCase() === organizer);
  if (!own) return {};
  const url = await calendarUrl(a);
  const window = `start="${stamp(Date.parse(range.from))}" end="${stamp(Date.parse(range.to))}"`;
  let res = await dav(
    a,
    url,
    "REPORT",
    `<?xml version="1.0" encoding="utf-8"?><c:free-busy-query ${DAV}><c:time-range ${window}/></c:free-busy-query>`,
    { depth: "1", "content-type": "application/xml; charset=utf-8" },
  );
  let text: string;
  if (res.ok) text = await res.text();
  else {
    // No free-busy report on this server: the events of the period, recurring ones expanded
    res = await dav(
      a,
      url,
      "REPORT",
      `<?xml version="1.0" encoding="utf-8"?><c:calendar-query ${DAV}><d:prop><c:calendar-data><c:expand ${window}/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range ${window}/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`,
      { depth: "1", "content-type": "application/xml; charset=utf-8" },
    );
    if (res.status !== 207) throw new ProviderError(`${res.status}: the calendar could not be read`, res.status);
    text = responses(await res.text())
      .map((r) => decodeXml(prop(r.body, "calendar-data") ?? ""))
      .join("\n");
  }
  return { [own]: periods(text) };
}

export async function test(a: CalendarAccess): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    found.delete(`${(a.config.url ?? "").trim()}|${a.config.username ?? ""}`);
    await calendarUrl(a);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
