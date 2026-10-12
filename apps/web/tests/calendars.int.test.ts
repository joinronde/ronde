import { generateKeyPairSync, sign } from "node:crypto";
import { localDate, localTime } from "@ronde/core/schedule";
import { prisma, scoped } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { meetingAvailability, saveCalendarAccount, setMeetingCalendar, syncMeetingCalendar } from "@/lib/server/calendars";
import { saveLicense } from "@/lib/server/license";
import { runOp } from "@/lib/server/meeting/ops";
import { resyncSession } from "@/lib/server/meeting/schedule";
import { type Fixture, meeting, workspace } from "./fixtures";

// Calendar sync (Team): sessions written as events, kept in line with the schedule; conflicts read back

process.env.APP_URL ??= "http://ronde.test";
const pair = generateKeyPairSync("ed25519");
process.env.RONDE_LICENSE_TEST_KEYS = JSON.stringify({ "test-cal": pair.publicKey.export({ format: "jwk" }).x });
const body = Buffer.from(
  JSON.stringify({
    kid: "test-cal",
    id: "lic_c",
    customer: "Acme",
    edition: "team",
    seats: 0,
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
  }),
).toString("base64url");
const KEY = `ronde_lic_v1.${body}.${sign(null, Buffer.from(`ronde_lic_v1.${body}`), pair.privateKey).toString("base64url")}`;
const PEM = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

let f: Fixture;
let accountId = "";
const calls: { method: string; url: string }[] = [];
let n = 0;
type GoogleEvent = {
  id: string;
  status?: string;
  start: { dateTime: string };
  end: { dateTime: string };
  attendees: { email: string; responseStatus?: string }[];
};
const store = new Map<string, GoogleEvent>();

beforeAll(async () => {
  await saveLicense(KEY);
  f = await meeting(await workspace(`cal-${Date.now().toString(36)}`), "Weekly");
  // Sessions every Monday from last week: about eight in the next eight weeks
  const start = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  await prisma.scheduleRule.updateMany({ where: { meetingId: f.meetingId }, data: { startDate: start } });
  // A Google Calendar holding the organizer's events: written, changed, read and deleted like the real one
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const method = init.method ?? "GET";
      calls.push({ method, url });
      if (url.includes("oauth2.googleapis.com/token")) return Response.json({ access_token: "g" });
      if (url.includes("freeBusy")) {
        const host = await prisma.person.findUniqueOrThrow({ where: { id: f.hostPersonId } });
        const next = await prisma.calendarEvent.findFirstOrThrow({ where: { meetingId: f.meetingId }, orderBy: { startsAt: "asc" } });
        // Busy over the first session, but not by our own event
        const start = new Date(next.startsAt.getTime() - 15 * 60_000).toISOString();
        return Response.json({
          calendars: { [host.email]: { busy: [{ start, end: new Date(next.startsAt.getTime() + 15 * 60_000).toISOString() }] } },
        });
      }
      const id = /\/events\/([^?]+)/.exec(url)?.[1];
      if (method === "POST") {
        const ev = { ...JSON.parse(String(init.body)), id: `ev${++n}` };
        store.set(ev.id, ev);
        return Response.json(ev);
      }
      if (method === "PUT" && id) {
        store.set(id, { ...JSON.parse(String(init.body)), id });
        return Response.json(store.get(id));
      }
      if (method === "DELETE" && id) {
        store.delete(id);
        return new Response(null, { status: 204 });
      }
      if (id) return store.has(id) ? Response.json(store.get(id)) : Response.json({}, { status: 404 });
      return Response.json({});
    }),
  );
  ({ id: accountId } = await saveCalendarAccount(f.ctx.ws, {
    kind: "google",
    name: "Google",
    config: { clientEmail: "sa@acme.iam.gserviceaccount.com", organizer: "rooms@acme.com" },
    secret: PEM,
  }));
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await saveLicense("");
});

describe("calendar sync", () => {
  it("writes each coming session once, and leaves unchanged events alone", async () => {
    const written = await setMeetingCalendar(f.ctx, accountId);
    const events = await prisma.calendarEvent.findMany({ where: { meetingId: f.meetingId } });
    expect(written).toBeGreaterThanOrEqual(7);
    expect(events).toHaveLength(written);
    const posts = calls.filter((c) => c.method === "POST" && c.url.includes("/events")).length;
    expect(await syncMeetingCalendar(f.meetingId)).toBe(0);
    expect(calls.filter((c) => c.method === "POST" && c.url.includes("/events")).length).toBe(posts);
  });

  it("removes the event of a skipped session", async () => {
    const first = await prisma.calendarEvent.findFirstOrThrow({ where: { meetingId: f.meetingId }, orderBy: { startsAt: "asc" } });
    await runOp({ ...f.ctx, meeting: { ...f.ctx.meeting, calendarAccountId: null } }, { op: "schedule.skip", key: first.occurrenceKey });
    expect(await syncMeetingCalendar(f.meetingId)).toBe(1);
    expect(calls.some((c) => c.method === "DELETE" && c.url.includes(first.eventId))).toBe(true);
    expect(await prisma.calendarEvent.findFirst({ where: { id: first.id } })).toBeNull();
  });

  it("names the people busy at a coming session", async () => {
    const m = { ...f.ctx, meeting: await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } }) };
    const a = await meetingAvailability(m);
    expect(a.sessions[0]?.busy).toEqual(["Host"]);
    expect(a.sessions.slice(1).every((s) => s.busy.length === 0)).toBe(true);
  });

  // Both ways: what changes in the calendar comes back to the meeting

  const second = async () => (await prisma.calendarEvent.findMany({ where: { meetingId: f.meetingId }, orderBy: { startsAt: "asc" } }))[1]!;
  const zone = async () => {
    const m = await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId }, include: { workspace: true } });
    return m.timezone ?? m.workspace.timezone;
  };

  it("moves a session moved in the calendar, without writing it back", async () => {
    const e = await second();
    const ev = store.get(e.eventId)!;
    const start = e.startsAt.getTime() + 2 * 3_600_000;
    ev.start.dateTime = new Date(start).toISOString();
    ev.end.dateTime = new Date(start + 45 * 60_000).toISOString();
    const writes = calls.filter((c) => c.url.includes("/events") && (c.method === "PUT" || c.method === "POST")).length;
    expect(await syncMeetingCalendar(f.meetingId)).toBe(1);
    const [ruleId, originalDate] = [e.occurrenceKey.slice(0, e.occurrenceKey.lastIndexOf(":")), e.occurrenceKey.slice(-10)];
    const tz = await zone();
    expect(await prisma.scheduleException.findUniqueOrThrow({ where: { ruleId_originalDate: { ruleId, originalDate } } })).toMatchObject({
      kind: "move",
      time: localTime(start, tz),
      durationMin: 45,
      date: localDate(start, tz) === originalDate ? null : localDate(start, tz),
    });
    // The calendar already says so: nothing written to it, nothing more to do next time
    expect(calls.filter((c) => c.url.includes("/events") && (c.method === "PUT" || c.method === "POST")).length).toBe(writes);
    expect(await syncMeetingCalendar(f.meetingId)).toBe(0);
  });

  it("turns an answer given in the calendar into the person's RSVP, once", async () => {
    const e = await second();
    const host = await prisma.person.findUniqueOrThrow({ where: { id: f.hostPersonId } });
    const ev = store.get(e.eventId)!;
    ev.attendees = ev.attendees.map((a) => (a.email === host.email.toLowerCase() ? { ...a, responseStatus: "declined" } : a));
    expect(await syncMeetingCalendar(f.meetingId)).toBe(1);
    const where = { meetingId_occurrenceKey_personId: { meetingId: f.meetingId, occurrenceKey: e.occurrenceKey, personId: host.id } };
    expect(await prisma.attendance.findUniqueOrThrow({ where })).toMatchObject({ status: "no" });
    // Changed in Ronde afterwards: the calendar's old answer does not take it back
    await prisma.attendance.update({ where, data: { status: "yes" } });
    expect(await syncMeetingCalendar(f.meetingId)).toBe(0);
    expect(await prisma.attendance.findUniqueOrThrow({ where })).toMatchObject({ status: "yes" });
  });

  it("skips a session whose event was deleted in the calendar", async () => {
    const e = await second();
    store.delete(e.eventId);
    expect(await syncMeetingCalendar(f.meetingId)).toBe(1);
    const at = e.occurrenceKey.lastIndexOf(":");
    expect(
      await prisma.scheduleException.findUniqueOrThrow({
        where: { ruleId_originalDate: { ruleId: e.occurrenceKey.slice(0, at), originalDate: e.occurrenceKey.slice(at + 1) } },
      }),
    ).toMatchObject({ kind: "cancel" });
    expect(await prisma.calendarEvent.findFirst({ where: { id: e.id } })).toBeNull();
    // Not written again
    expect(await syncMeetingCalendar(f.meetingId)).toBe(0);
  });

  const coming = () => prisma.calendarEvent.findMany({ where: { meetingId: f.meetingId }, orderBy: { startsAt: "asc" } });
  const writesTo = (eventId: string) => calls.filter((c) => c.method === "PUT" && c.url.includes(`/events/${eventId}`)).length;
  const exceptionOf = (key: string) => {
    const at = key.lastIndexOf(":");
    return prisma.scheduleException.findUnique({
      where: { ruleId_originalDate: { ruleId: key.slice(0, at), originalDate: key.slice(at + 1) } },
    });
  };

  it("puts the calendar back when a session is moved there onto another session's day", async () => {
    const [, e, other] = await coming();
    const ev = store.get(e!.eventId)!;
    const start = other!.startsAt.getTime() + 3_600_000;
    ev.start = { dateTime: new Date(start).toISOString() };
    ev.end = { dateTime: new Date(start + 30 * 60_000).toISOString() };
    const writes = writesTo(e!.eventId);
    expect(await syncMeetingCalendar(f.meetingId)).toBe(1);
    expect(await exceptionOf(e!.occurrenceKey)).toBeNull();
    // Written again at Ronde's time; the calendar and Ronde agree from then on
    expect(writesTo(e!.eventId)).toBe(writes + 1);
    expect(store.get(e!.eventId)!.start.dateTime).toContain(e!.startsAt.toISOString().slice(0, 19));
    expect(await syncMeetingCalendar(f.meetingId)).toBe(0);
  });

  it("marks someone absent from the session being prepared when they decline it in the calendar, and back", async () => {
    // The session waiting for the next occurrence; today's, when its time has passed, is skipped (no event)
    const prepare = async () =>
      resyncSession(
        scoped(prisma, f.workspaceId),
        { id: f.meetingId, workspaceId: f.workspaceId, timezone: null },
        { timezone: await zone() },
      );
    await prisma.session.update({ where: { id: f.sessionId }, data: { startedAt: null } });
    await prepare();
    let session = await prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } });
    if (!(await prisma.calendarEvent.findFirst({ where: { meetingId: f.meetingId, occurrenceKey: session.occurrenceKey! } }))) {
      const at = session.occurrenceKey!.lastIndexOf(":");
      await prisma.scheduleException.create({
        data: {
          workspaceId: f.workspaceId,
          meetingId: f.meetingId,
          ruleId: session.occurrenceKey!.slice(0, at),
          originalDate: session.occurrenceKey!.slice(at + 1),
          kind: "cancel",
        },
      });
      await prepare();
      session = await prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } });
    }
    const e = await prisma.calendarEvent.findFirstOrThrow({ where: { meetingId: f.meetingId, occurrenceKey: session.occurrenceKey! } });
    const host = await prisma.person.findUniqueOrThrow({ where: { id: f.hostPersonId } });
    const answer = (responseStatus: string) => {
      const ev = store.get(e.eventId)!;
      ev.attendees = ev.attendees.map((a) => (a.email === host.email.toLowerCase() ? { ...a, responseStatus } : a));
    };
    answer("declined");
    expect(await syncMeetingCalendar(f.meetingId)).toBe(1);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } })).absent).toEqual([host.id]);
    answer("accepted");
    expect(await syncMeetingCalendar(f.meetingId)).toBe(1);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: f.sessionId } })).absent).toEqual([]);
  });

  it("keeps a session moved in the calendar further than the weeks written ahead", async () => {
    const [, e] = await coming();
    const ev = store.get(e!.eventId)!;
    // Ten weeks later, on a Tuesday: no other session that day
    const start = e!.startsAt.getTime() + 71 * 86_400_000;
    ev.start = { dateTime: new Date(start).toISOString() };
    ev.end = { dateTime: new Date(start + 30 * 60_000).toISOString() };
    expect(await syncMeetingCalendar(f.meetingId)).toBe(1);
    expect(await exceptionOf(e!.occurrenceKey)).toMatchObject({ kind: "move", date: localDate(start, await zone()) });
    expect(await syncMeetingCalendar(f.meetingId)).toBe(0);
    expect(await prisma.calendarEvent.findUniqueOrThrow({ where: { id: e!.id } })).toMatchObject({ startsAt: new Date(start) });
    expect(calls.some((c) => c.method === "DELETE" && c.url.includes(`/events/${e!.eventId}`))).toBe(false);
    expect(store.has(e!.eventId)).toBe(true);
  });

  it("syncs a meeting once at a time: two runs together write a missing event once", async () => {
    const [, , e] = await coming();
    await prisma.calendarEvent.delete({ where: { id: e!.id } });
    const posts = () => calls.filter((c) => c.method === "POST" && c.url.includes("/events")).length;
    const before = posts();
    const [a, b] = await Promise.all([syncMeetingCalendar(f.meetingId), syncMeetingCalendar(f.meetingId)]);
    expect(a + b).toBe(1);
    expect(posts()).toBe(before + 1);
  });

  it("moves the events to another organizer's calendar when the account changes", async () => {
    const old = await coming();
    await saveCalendarAccount(f.ctx.ws, {
      id: accountId,
      kind: "google",
      name: "Google",
      config: { clientEmail: "sa@acme.iam.gserviceaccount.com", organizer: "team@acme.com" },
    });
    // Waits for the sync the change started
    expect(await syncMeetingCalendar(f.meetingId)).toBe(0);
    const now = Date.now();
    for (const e of old.filter((x) => x.startsAt.getTime() > now)) expect(store.has(e.eventId)).toBe(false);
    const fresh = await coming();
    expect(fresh.length).toBeGreaterThanOrEqual(old.filter((x) => x.startsAt.getTime() > now).length - 1);
    expect(fresh.every((e) => !old.some((o) => o.eventId === e.eventId))).toBe(true);
  });

  it("asks for https to a CalDAV server in the cloud", async () => {
    const caldav = (url: string) =>
      saveCalendarAccount(f.ctx.ws, {
        kind: "caldav",
        name: "DAV",
        config: { url, username: "ana", organizer: "ana@acme.com" },
        secret: "p",
      });
    vi.stubEnv("RONDE_CLOUD", "1");
    try {
      await expect(caldav("http://dav.acme.com/dav/")).rejects.toMatchObject({ key: "connectorInvalid" });
      await expect(caldav("https://dav.acme.com/dav/")).resolves.toMatchObject({ id: expect.any(String) });
    } finally {
      vi.unstubAllEnvs();
    }
    // A server of the instance's own network, self-hosted
    await expect(caldav("http://radicale:5232/ana/")).resolves.toMatchObject({ id: expect.any(String) });
  });
});
