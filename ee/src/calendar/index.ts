// Ronde Enterprise Edition. Copyright (c) Ronde. Licensed under the Ronde Enterprise License (see ee/LICENSE).
import type { CalendarAccess, CalendarEventInput, EnterpriseEdition } from "@ronde/editions/ee";
import { bearer, call, googleToken, graphToken, graphUser, ProviderError } from "../providers";

// Calendars: each session becomes an event of the organizer, its participants invited (Google Calendar,
// Outlook); their busy times come back to spot conflicts and find a slot.

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar";
const GOOGLE_EVENTS = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

const organizer = (a: CalendarAccess) => a.config.organizer ?? "";
const google = (a: CalendarAccess) => googleToken(a, organizer(a), GOOGLE_SCOPE);

/** Graph answers date-times in UTC without the zone */
const utc = (s: string) => (/[zZ]|[+-]\d\d:\d\d$/.test(s) ? new Date(s).toISOString() : new Date(`${s}Z`).toISOString());

export async function upsert(a: CalendarAccess, e: CalendarEventInput, eventId?: string): Promise<string> {
  if (a.kind === "google") {
    const body = {
      summary: e.title,
      description: e.description,
      location: e.location || undefined,
      start: { dateTime: e.start },
      end: { dateTime: e.end },
      attendees: e.attendees.map((email) => ({ email })),
      guestsCanModify: false,
    };
    const url = eventId ? `${GOOGLE_EVENTS}/${encodeURIComponent(eventId)}?sendUpdates=all` : `${GOOGLE_EVENTS}?sendUpdates=all`;
    const r = await call(a.fetch, url, bearer(await google(a), eventId ? "PUT" : "POST", body));
    return String(r.id);
  }
  const body = {
    subject: e.title,
    body: { contentType: "text", content: e.description },
    start: { dateTime: e.start.replace(/Z$/, ""), timeZone: "UTC" },
    end: { dateTime: e.end.replace(/Z$/, ""), timeZone: "UTC" },
    location: { displayName: e.location },
    attendees: e.attendees.map((address) => ({ emailAddress: { address }, type: "required" })),
  };
  const base = `${graphUser(organizer(a))}/events`;
  const r = await call(
    a.fetch,
    eventId ? `${base}/${encodeURIComponent(eventId)}` : base,
    bearer(await graphToken(a), eventId ? "PATCH" : "POST", body),
  );
  return String(r.id ?? eventId);
}

export async function remove(a: CalendarAccess, eventId: string): Promise<void> {
  try {
    if (a.kind === "google")
      await call(a.fetch, `${GOOGLE_EVENTS}/${encodeURIComponent(eventId)}?sendUpdates=all`, bearer(await google(a), "DELETE"));
    else await call(a.fetch, `${graphUser(organizer(a))}/events/${encodeURIComponent(eventId)}`, bearer(await graphToken(a), "DELETE"));
  } catch (e) {
    // Already removed in the calendar: nothing left to do
    if (e instanceof ProviderError && (e.status === 404 || e.status === 410)) return;
    throw e;
  }
}

export async function busy(
  a: CalendarAccess,
  emails: string[],
  range: { from: string; to: string },
): Promise<Record<string, { start: string; end: string }[]>> {
  if (!emails.length) return {};
  if (a.kind === "google") {
    const r = await call(
      a.fetch,
      "https://www.googleapis.com/calendar/v3/freeBusy",
      bearer(await google(a), "POST", { timeMin: range.from, timeMax: range.to, items: emails.map((id) => ({ id })) }),
    );
    const calendars = (r.calendars ?? {}) as Record<string, { busy?: { start: string; end: string }[] }>;
    return Object.fromEntries(emails.map((e) => [e, (calendars[e]?.busy ?? []).map((b) => ({ start: utc(b.start), end: utc(b.end) }))]));
  }
  const r = await call(
    a.fetch,
    `${graphUser(organizer(a))}/calendar/getSchedule`,
    bearer(await graphToken(a), "POST", {
      schedules: emails,
      startTime: { dateTime: range.from.replace(/Z$/, ""), timeZone: "UTC" },
      endTime: { dateTime: range.to.replace(/Z$/, ""), timeZone: "UTC" },
      availabilityViewInterval: 30,
    }),
  );
  const value = (r.value ?? []) as {
    scheduleId: string;
    scheduleItems?: { status: string; start: { dateTime: string }; end: { dateTime: string } }[];
  }[];
  return Object.fromEntries(
    emails.map((e) => {
      const items = value.find((v) => v.scheduleId.toLowerCase() === e.toLowerCase())?.scheduleItems ?? [];
      return [e, items.filter((i) => i.status !== "free").map((i) => ({ start: utc(i.start.dateTime), end: utc(i.end.dateTime) }))];
    }),
  );
}

export async function test(a: CalendarAccess): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const now = new Date();
    await busy(a, [organizer(a)], { from: now.toISOString(), to: new Date(now.getTime() + 3_600_000).toISOString() });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const calendar: EnterpriseEdition["calendar"] = { upsert, remove, busy, test };
