// Ronde Enterprise Edition. Copyright (c) Ronde. Licensed under the Ronde Enterprise License (see ee/LICENSE).
import type { CalendarAccess, CalendarEventInput, CalendarEventState, EnterpriseEdition } from "@ronde/editions/ee";
import { bearer, call, googleToken, graphToken, graphUser, ProviderError } from "../providers";
import * as caldav from "./caldav";

// Calendars: each session becomes an event of the organizer, its participants invited (Google Calendar,
// Outlook, a CalDAV server); what changes there comes back (moved, cancelled, answered), and busy times to spot
// conflicts and find a slot.

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar";
const GOOGLE_EVENTS = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

const organizer = (a: CalendarAccess) => a.config.organizer ?? "";
const google = (a: CalendarAccess) => googleToken(a, organizer(a), GOOGLE_SCOPE);

/** Graph answers date-times in UTC without the zone */
const utc = (s: string) => (/[zZ]|[+-]\d\d:\d\d$/.test(s) ? new Date(s).toISOString() : new Date(`${s}Z`).toISOString());

export async function upsert(a: CalendarAccess, e: CalendarEventInput, eventId?: string): Promise<string> {
  if (a.kind === "caldav") return caldav.upsert(a, e, eventId);
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
  if (a.kind === "caldav") return caldav.remove(a, eventId);
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
  if (a.kind === "caldav") return caldav.busy(a, emails, range);
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

const GOOGLE_ANSWERS: Record<string, CalendarEventState["answers"][string]> = {
  accepted: "accepted",
  declined: "declined",
  tentative: "tentative",
};
const GRAPH_ANSWERS: Record<string, CalendarEventState["answers"][string]> = {
  accepted: "accepted",
  declined: "declined",
  tentativelyAccepted: "tentative",
};

/** The event as the calendar has it now: its times, whether it was cancelled, what each attendee answered */
export async function read(a: CalendarAccess, eventId: string): Promise<CalendarEventState | null> {
  if (a.kind === "caldav") return caldav.read(a, eventId);
  try {
    if (a.kind === "google") {
      const r = (await call(a.fetch, `${GOOGLE_EVENTS}/${encodeURIComponent(eventId)}`, bearer(await google(a)))) as {
        status?: string;
        start?: { dateTime?: string };
        end?: { dateTime?: string };
        attendees?: { email?: string; responseStatus?: string }[];
      };
      return {
        cancelled: r.status === "cancelled",
        start: r.start?.dateTime ? new Date(r.start.dateTime).toISOString() : null,
        end: r.end?.dateTime ? new Date(r.end.dateTime).toISOString() : null,
        answers: Object.fromEntries(
          (r.attendees ?? []).filter((x) => x.email).map((x) => [x.email!.toLowerCase(), GOOGLE_ANSWERS[x.responseStatus ?? ""] ?? "none"]),
        ),
      };
    }
    // Times in UTC, as the events were written
    const r = (await call(
      a.fetch,
      `${graphUser(organizer(a))}/events/${encodeURIComponent(eventId)}?$select=isCancelled,start,end,attendees`,
      {
        headers: { authorization: `Bearer ${await graphToken(a)}`, prefer: 'outlook.timezone="UTC"' },
      },
    )) as {
      isCancelled?: boolean;
      start?: { dateTime?: string };
      end?: { dateTime?: string };
      attendees?: { emailAddress?: { address?: string }; status?: { response?: string } }[];
    };
    return {
      cancelled: !!r.isCancelled,
      start: r.start?.dateTime ? utc(r.start.dateTime) : null,
      end: r.end?.dateTime ? utc(r.end.dateTime) : null,
      answers: Object.fromEntries(
        (r.attendees ?? [])
          .filter((x) => x.emailAddress?.address)
          .map((x) => [x.emailAddress!.address!.toLowerCase(), GRAPH_ANSWERS[x.status?.response ?? ""] ?? "none"]),
      ),
    };
  } catch (e) {
    // Deleted in the calendar
    if (e instanceof ProviderError && (e.status === 404 || e.status === 410)) return null;
    throw e;
  }
}

export async function test(a: CalendarAccess): Promise<{ ok: true } | { ok: false; error: string }> {
  if (a.kind === "caldav") return caldav.test(a);
  try {
    const now = new Date();
    await busy(a, [organizer(a)], { from: now.toISOString(), to: new Date(now.getTime() + 3_600_000).toISOString() });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export const calendar: EnterpriseEdition["calendar"] = { upsert, remove, read, busy, test };
