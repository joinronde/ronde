import { generateKeyPairSync } from "node:crypto";
import type { CalendarAccess } from "@ronde/editions/ee";
import { describe, expect, it } from "vitest";
import { busy, test as check, read, remove, upsert } from "../src/calendar";
import { parseEvent } from "../src/calendar/caldav";

// Calendars: sessions written as events with their attendees, busy times read back

type Call = { url: string; init: RequestInit };
const fake = (answers: { status?: number; body: unknown }[]) => {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const a = answers[calls.length - 1] ?? { body: {} };
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
};
const event = {
  title: "Weekly",
  description: "Round table",
  start: "2030-01-07T09:00:00.000Z",
  end: "2030-01-07T09:30:00.000Z",
  attendees: ["emma@acme.com", "lucas@acme.com"],
  location: "https://zoom.us/j/42",
};
const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("calendars", () => {
  it("creates then updates a Google event for the organizer, inviting the attendees", async () => {
    const f = fake([{ body: { access_token: "g" } }, { body: { id: "ev1" } }, { body: { access_token: "g" } }, { body: { id: "ev1" } }]);
    const a: CalendarAccess = {
      kind: "google",
      config: { clientEmail: "sa@x.iam.gserviceaccount.com", organizer: "rooms@acme.com" },
      secret: key,
      fetch: f.fetch,
    };
    expect(await upsert(a, event)).toBe("ev1");
    expect(f.calls[1]!.url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all");
    expect(JSON.parse(String(f.calls[1]!.init.body))).toMatchObject({
      summary: "Weekly",
      attendees: [{ email: "emma@acme.com" }, { email: "lucas@acme.com" }],
    });
    await upsert(a, event, "ev1");
    expect([f.calls[3]!.init.method, f.calls[3]!.url]).toEqual([
      "PUT",
      "https://www.googleapis.com/calendar/v3/calendars/primary/events/ev1?sendUpdates=all",
    ]);
  });

  it("writes Outlook events in UTC, and accepts an event already removed", async () => {
    const f = fake([{ body: { access_token: "m" } }, { body: { id: "o1" } }, { body: { access_token: "m" } }, { status: 404, body: {} }]);
    const a: CalendarAccess = {
      kind: "microsoft",
      config: { tenant: "t", clientId: "c", organizer: "rooms@acme.com" },
      secret: "s",
      fetch: f.fetch,
    };
    expect(await upsert(a, event)).toBe("o1");
    expect(f.calls[1]!.url).toBe("https://graph.microsoft.com/v1.0/users/rooms%40acme.com/events");
    expect(JSON.parse(String(f.calls[1]!.init.body))).toMatchObject({ start: { dateTime: "2030-01-07T09:00:00.000", timeZone: "UTC" } });
    await expect(remove(a, "o1")).resolves.toBeUndefined();
  });

  it("reads busy times from both providers, as UTC instants", async () => {
    const g = fake([
      { body: { access_token: "g" } },
      { body: { calendars: { "emma@acme.com": { busy: [{ start: "2030-01-07T10:00:00+01:00", end: "2030-01-07T11:00:00+01:00" }] } } } },
    ]);
    const ga: CalendarAccess = {
      kind: "google",
      config: { clientEmail: "sa@x", organizer: "rooms@acme.com" },
      secret: key,
      fetch: g.fetch,
    };
    expect(await busy(ga, ["emma@acme.com"], { from: "2030-01-07T00:00:00Z", to: "2030-01-08T00:00:00Z" })).toEqual({
      "emma@acme.com": [{ start: "2030-01-07T09:00:00.000Z", end: "2030-01-07T10:00:00.000Z" }],
    });
    const m = fake([
      { body: { access_token: "m" } },
      {
        body: {
          value: [
            {
              scheduleId: "Lucas@acme.com",
              scheduleItems: [
                { status: "busy", start: { dateTime: "2030-01-07T09:00:00.0000000" }, end: { dateTime: "2030-01-07T09:30:00.0000000" } },
                { status: "free", start: { dateTime: "2030-01-07T12:00:00" }, end: { dateTime: "2030-01-07T13:00:00" } },
              ],
            },
          ],
        },
      },
    ]);
    const ma: CalendarAccess = {
      kind: "microsoft",
      config: { tenant: "t", clientId: "c", organizer: "rooms@acme.com" },
      secret: "s",
      fetch: m.fetch,
    };
    expect(await busy(ma, ["lucas@acme.com"], { from: "2030-01-07T00:00:00Z", to: "2030-01-08T00:00:00Z" })).toEqual({
      "lucas@acme.com": [{ start: "2030-01-07T09:00:00.000Z", end: "2030-01-07T09:30:00.000Z" }],
    });
  });

  it("reads back a Google event: moved, cancelled, answered, or gone", async () => {
    const google = (body: unknown, status = 200) => fake([{ body: { access_token: "g" } }, { body, status }]);
    const a = (f: ReturnType<typeof fake>): CalendarAccess => ({
      kind: "google",
      config: { clientEmail: "sa@x.iam.gserviceaccount.com", organizer: "rooms@acme.com" },
      secret: key,
      fetch: f.fetch,
    });
    const moved = google({
      status: "confirmed",
      start: { dateTime: "2030-01-07T11:00:00+01:00" },
      end: { dateTime: "2030-01-07T11:45:00+01:00" },
      attendees: [
        { email: "Emma@acme.com", responseStatus: "declined" },
        { email: "lucas@acme.com", responseStatus: "needsAction" },
      ],
    });
    expect(await read(a(moved), "ev1")).toEqual({
      cancelled: false,
      start: "2030-01-07T10:00:00.000Z",
      end: "2030-01-07T10:45:00.000Z",
      answers: { "emma@acme.com": "declined", "lucas@acme.com": "none" },
    });
    expect(moved.calls[1]!.url).toBe("https://www.googleapis.com/calendar/v3/calendars/primary/events/ev1");
    expect((await read(a(google({ status: "cancelled", start: {}, end: {} })), "ev1"))?.cancelled).toBe(true);
    expect(await read(a(google({ error: { message: "Not Found" } }, 404)), "ev1")).toBeNull();
  });

  it("reads back an Outlook event in UTC, its answers named as Graph names them", async () => {
    const f = fake([
      { body: { access_token: "m" } },
      {
        body: {
          isCancelled: false,
          start: { dateTime: "2030-01-07T09:30:00.0000000" },
          end: { dateTime: "2030-01-07T10:00:00.0000000" },
          attendees: [{ emailAddress: { address: "emma@acme.com" }, status: { response: "tentativelyAccepted" } }],
        },
      },
    ]);
    const a: CalendarAccess = {
      kind: "microsoft",
      config: { tenant: "t", clientId: "c", organizer: "rooms@acme.com" },
      secret: "s",
      fetch: f.fetch,
    };
    expect(await read(a, "AAMk")).toEqual({
      cancelled: false,
      start: "2030-01-07T09:30:00.000Z",
      end: "2030-01-07T10:00:00.000Z",
      answers: { "emma@acme.com": "tentative" },
    });
    expect(new Headers(f.calls[1]!.init.headers).get("prefer")).toBe('outlook.timezone="UTC"');
  });
});

/** A CalDAV server: a principal, its calendar home with a task list and a calendar, the events stored as files */
function caldavServer(opts: { freeBusy?: "none" | "forbidden" } = {}) {
  const files = new Map<string, string>();
  const calls: { method: string; url: string; body: string; depth: string | null; auth: string | null }[] = [];
  const multistatus = (responses: string) =>
    new Response(
      `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav">${responses}</d:multistatus>`,
      {
        status: 207,
      },
    );
  const fetch = (async (url: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    const body = String(init.body ?? "");
    calls.push({ method, url, body, depth: headers.get("depth"), auth: headers.get("authorization") });
    if (headers.get("authorization") !== `Basic ${Buffer.from("ana@acme.com:app-pass").toString("base64")}`)
      return new Response("", { status: 401 });
    const path = new URL(url).pathname;
    if (method === "PROPFIND" && path === "/dav/")
      return multistatus(
        `<d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype><d:current-user-principal><d:href>/dav/principals/ana/</d:href></d:current-user-principal></d:prop></d:propstat></d:response>`,
      );
    if (method === "PROPFIND" && path === "/dav/principals/ana/")
      return multistatus(
        `<d:response><d:href>/dav/principals/ana/</d:href><d:propstat><d:prop><cal:calendar-home-set><d:href>/dav/calendars/ana/</d:href></cal:calendar-home-set></d:prop></d:propstat></d:response>`,
      );
    if (method === "PROPFIND" && path === "/dav/calendars/ana/")
      return multistatus(
        [
          `<d:response><d:href>/dav/calendars/ana/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>`,
          `<d:response><d:href>/dav/calendars/ana/tasks/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><cal:supported-calendar-component-set><cal:comp name="VTODO"/></cal:supported-calendar-component-set></d:prop></d:propstat></d:response>`,
          // Written with a character reference, as some servers do
          `<d:response><d:href>/dav/calendars/ana/w&#111;rk/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set></d:prop></d:propstat></d:response>`,
        ].join(""),
      );
    if (method === "PROPFIND" && path === "/dav/calendars/ana/work/")
      return multistatus(
        `<d:response><d:href>/dav/calendars/ana/work/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><cal:calendar/></d:resourcetype><cal:supported-calendar-component-set><cal:comp name="VEVENT"/></cal:supported-calendar-component-set></d:prop></d:propstat></d:response>`,
      );
    if (method === "PUT") {
      files.set(path, body);
      return new Response(null, { status: 201 });
    }
    if (method === "GET") return files.has(path) ? new Response(files.get(path)) : new Response("", { status: 404 });
    if (method === "DELETE") return new Response(null, { status: files.delete(path) ? 204 : 404 });
    if (method === "REPORT" && body.includes("free-busy-query"))
      return opts.freeBusy
        ? new Response("", { status: opts.freeBusy === "none" ? 501 : 403 })
        : new Response(
            "BEGIN:VCALENDAR\r\nBEGIN:VFREEBUSY\r\nFREEBUSY;FBTYPE=BUSY:20300107T090000Z/20300107T100000Z,20300108T140000Z/PT30M\r\nFREEBUSY;FBTYPE=FREE:20300109T090000Z/20300109T100000Z\r\nEND:VFREEBUSY\r\nEND:VCALENDAR\r\n",
            { headers: { "content-type": "text/calendar; charset=utf-8" } },
          );
    if (method === "REPORT")
      return multistatus(
        `<d:response><d:href>/dav/calendars/ana/work/x.ics</d:href><d:propstat><d:prop><cal:calendar-data>BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;TZID=Europe/Paris:20300107T150000
DTEND;TZID=Europe/Paris:20300107T160000
END:VEVENT
END:VCALENDAR</cal:calendar-data></d:prop></d:propstat></d:response>`,
      );
    return new Response("", { status: 405 });
  }) as unknown as typeof globalThis.fetch;
  return { files, calls, fetch };
}

describe("CalDAV calendars", () => {
  const account = (fetch: typeof globalThis.fetch, url = "https://dav.example.test/dav/"): CalendarAccess => ({
    kind: "caldav",
    config: { url, username: "ana@acme.com", organizer: "ana@acme.com" },
    secret: "app-pass",
    fetch,
  });

  it("finds the account's calendar of events, writes the session there with its attendees, and reads it back", async () => {
    const server = caldavServer();
    const a = account(server.fetch);
    expect(await check(a)).toEqual({ ok: true });
    const href = await upsert(a, event);
    expect(href).toMatch(/^https:\/\/dav\.example\.test\/dav\/calendars\/ana\/work\/ronde-[0-9a-f-]+\.ics$/);
    // Lines unfolded (the file folds them at 75 octets)
    const ics = server.files.get(new URL(href).pathname)!.replace(/\r\n /g, "");
    expect(ics).toContain("DTSTART:20300107T090000Z");
    expect(ics).toContain("DTEND:20300107T093000Z");
    expect(ics).toContain("ORGANIZER:mailto:ana@acme.com");
    expect(ics).toContain("ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:emma@acme.com");
    expect(ics).toContain("LOCATION:https://zoom.us/j/42");
    expect(await read(a, href)).toEqual({
      cancelled: false,
      start: "2030-01-07T09:00:00.000Z",
      end: "2030-01-07T09:30:00.000Z",
      answers: { "emma@acme.com": "none", "lucas@acme.com": "none" },
    });
  });

  it("keeps the attendees' answers when the event is rewritten at the same time, asks again when it moves", async () => {
    const server = caldavServer();
    const a = account(server.fetch, "https://dav.example.test/dav/calendars/ana/work/");
    const href = await upsert(a, event);
    // Emma accepted in her calendar app: the server wrote it into the event
    const path = new URL(href).pathname;
    const unfold = (p: string) => server.files.get(p)!.replace(/\r\n /g, "");
    server.files.set(path, unfold(path).replace(/PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:emma/, "PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:emma"));
    await upsert(a, { ...event, title: "Weekly sync" }, href);
    expect(unfold(path)).toContain("PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:emma@acme.com");
    await upsert(a, { ...event, start: "2030-01-07T10:00:00.000Z", end: "2030-01-07T10:30:00.000Z" }, href);
    expect(unfold(path)).toContain("PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:emma@acme.com");
    // The address given was the calendar itself: no discovery
    expect(server.calls.some((c) => c.url.includes("/principals/"))).toBe(false);
    await remove(a, href);
    expect(await read(a, href)).toBeNull();
    await remove(a, href);
  });

  it("reads times in a named zone, durations, cancellations and answers as clients write them", () => {
    const e = parseEvent(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VTIMEZONE",
        "DTSTART:19700101T000000",
        "END:VTIMEZONE",
        "BEGIN:VEVENT",
        "DTSTART;TZID=Europe/Paris:20300107T143000",
        "DURATION:PT1H15M",
        "STATUS:CANCELLED",
        'ATTENDEE;CN="Martin, Lucas";PARTSTAT=DECLINED:mailto:Lucas@Acme.com',
        "ATTENDEE;PARTSTAT=ACCEPTED;CN=Emma",
        " Laurent:mailto:emma@acme.com",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
    );
    expect(e).toEqual({
      cancelled: true,
      start: "2030-01-07T13:30:00.000Z",
      end: "2030-01-07T14:45:00.000Z",
      answers: { "lucas@acme.com": "declined", "emma@acme.com": "accepted" },
    });
    // A whole day, or a zone only Windows knows: no time to move to
    expect(parseEvent("BEGIN:VEVENT\nDTSTART;VALUE=DATE:20300107\nEND:VEVENT").start).toBeNull();
    expect(parseEvent("BEGIN:VEVENT\nDTSTART;TZID=Romance Standard Time:20300107T090000\nEND:VEVENT").start).toBeNull();
  });

  it("reads the organizer's busy times only, from the free-busy report or the events of the period", async () => {
    const range = { from: "2030-01-07T00:00:00.000Z", to: "2030-01-10T00:00:00.000Z" };
    const server = caldavServer();
    expect(await busy(account(server.fetch), ["emma@acme.com", "Ana@acme.com"], range)).toEqual({
      "Ana@acme.com": [
        { start: "2030-01-07T09:00:00.000Z", end: "2030-01-07T10:00:00.000Z" },
        { start: "2030-01-08T14:00:00.000Z", end: "2030-01-08T14:30:00.000Z" },
      ],
    });
    expect(await busy(account(server.fetch), ["emma@acme.com"], range)).toEqual({});
    // No free-busy report, or one the account may not run: the events of the period
    for (const freeBusy of ["none", "forbidden"] as const) {
      const old = caldavServer({ freeBusy });
      expect(await busy(account(old.fetch), ["ana@acme.com"], range)).toEqual({
        "ana@acme.com": [{ start: "2030-01-07T14:00:00.000Z", end: "2030-01-07T15:00:00.000Z" }],
      });
    }
  });

  it("leaves out an address that would break out of its line", async () => {
    const server = caldavServer();
    const a = account(server.fetch, "https://dav.example.test/dav/calendars/ana/work/");
    const href = await upsert(a, {
      ...event,
      attendees: ["emma@acme.com", "eve@acme.com\r\nATTENDEE:mailto:x@evil.test", "bob@acme.com;PARTSTAT=ACCEPTED"],
    });
    const ics = server.files.get(new URL(href).pathname)!.replace(/\r\n /g, "");
    expect(ics.match(/^ATTENDEE/gm)).toHaveLength(1);
    expect(ics).not.toContain("evil.test");
    expect(ics).not.toContain("bob@acme.com");
  });

  it("says when the password is refused", async () => {
    const server = caldavServer();
    expect(await check({ ...account(server.fetch, "https://other.example.test/dav/"), secret: "wrong" })).toEqual({
      ok: false,
      error: "401: the server refused the user name or password",
    });
  });
});
