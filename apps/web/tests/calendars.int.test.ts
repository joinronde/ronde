import { generateKeyPairSync, sign } from "node:crypto";
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

beforeAll(async () => {
  await saveLicense(KEY);
  f = await meeting(await workspace(`cal-${Date.now().toString(36)}`), "Weekly");
  // Sessions every Monday from last week: about eight in the next eight weeks
  const start = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  await prisma.scheduleRule.updateMany({ where: { meetingId: f.meetingId }, data: { startDate: start } });
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
      if (method === "DELETE") return new Response(null, { status: 204 });
      return Response.json({ id: `ev${++n}` });
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
});
