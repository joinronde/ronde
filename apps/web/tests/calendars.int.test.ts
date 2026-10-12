import { generateKeyPairSync, sign } from "node:crypto";
import { localDate, localTime } from "@ronde/core/schedule";
import { prisma } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { meetingAvailability, saveCalendarAccount, setMeetingCalendar, syncMeetingCalendar } from "@/lib/server/calendars";
import { saveLicense } from "@/lib/server/license";
import { runOp } from "@/lib/server/meeting/ops";
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
});
