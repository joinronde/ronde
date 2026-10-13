import { generateKeyPairSync } from "node:crypto";
import { signWebhook } from "@ronde/connectors";
import { prisma } from "@ronde/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/server/secrets";
import { type Fixture, meeting, workspace } from "./fixtures";

// The background jobs: each recurring one is declared with a handler and a valid schedule, and each does its work
// on the workspaces still open (not suspended, not deleted), one failure never stopping the others. Against fakes:
// Google Calendar, a speech-to-text service, a SIEM, an IMAP mailbox and a push service.

// An IMAP mailbox kept in memory, as imapflow sees it
type Mail = { uid: number; source: string; inReplyTo?: string; size?: number; seen?: boolean; folder?: string };
const imap = vi.hoisted(() => ({
  messages: [] as Mail[],
  options: [] as Record<string, unknown>[],
  locked: [] as string[],
  sourcesRead: [] as number[],
  created: [] as string[],
  released: 0,
  loggedOut: 0,
}));
vi.mock("imapflow", () => ({
  ImapFlow: class {
    constructor(options: Record<string, unknown>) {
      imap.options.push(options);
    }
    async connect() {}
    async mailboxCreate(name: string) {
      imap.created.push(name);
    }
    async getMailboxLock(name: string) {
      imap.locked.push(name);
      return { release: () => void imap.released++ };
    }
    async search() {
      return imap.messages.filter((m) => !m.seen && !m.folder).map((m) => m.uid);
    }
    async fetchOne(uid: string, query: { source?: boolean }) {
      const m = imap.messages.find((x) => String(x.uid) === uid);
      if (!m) return false;
      if (query.source) {
        imap.sourcesRead.push(m.uid);
        return { source: Buffer.from(m.source) };
      }
      return { envelope: { inReplyTo: m.inReplyTo }, size: m.size ?? m.source.length, headers: Buffer.from("") };
    }
    async messageFlagsAdd(uid: string, flags: string[]) {
      if (flags.includes("\\Seen")) imap.messages.find((x) => String(x.uid) === uid)!.seen = true;
    }
    async messageMove(uid: string, folder: string) {
      imap.messages.find((x) => String(x.uid) === uid)!.folder = folder;
    }
    async logout() {
      imap.loggedOut++;
    }
  },
}));
const pushed = vi.hoisted(() => [] as { endpoint: string; payload: { url: string } }[]);
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => undefined,
    sendNotification: async (sub: { endpoint: string }, payload: string) => {
      pushed.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) });
      return { statusCode: 201 };
    },
  },
}));
const mails = vi.hoisted(() => [] as { to: string; subject: string }[]);
vi.mock("@/lib/server/mailer", async (original) => ({
  ...(await original<typeof import("@/lib/server/mailer")>()),
  sendEmail: async (m: { to: string; subject: string }) => void mails.push(m),
}));

const { JOBS, prepareSessions } = await import("@/lib/server/jobs");
const { syncCalendars } = await import("@/lib/server/calendars");
const { checkDaily } = await import("@/lib/server/reminders");
const { streamAudit } = await import("@/lib/server/audit");
const { processPendingChunks } = await import("@/lib/server/transcripts");
const { checkInbound, replyMessageId } = await import("@/lib/server/inbound");
const { pushInbox } = await import("@/lib/server/push");

const run = Date.now().toString(36);
const DAY = 86_400_000;
const PEM = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const today = () => new Date().toISOString().slice(0, 10);

// Every request leaving the app, answered by the fake service it is for. Each answer waits a little, so requests
// running together overlap.
const requests: { url: string; init: RequestInit }[] = [];
let inFlight = 0;
let maxInFlight = 0;
let onEventPost: () => void = () => {};
let siemStatus = 200;
let sttFails = false;
let eventIds = 0;
/** Events written into the calendars, read back as they were written */
const calendar = new Map<string, object>();
const organizerOf = (init: RequestInit) => {
  const auth = new Headers(init.headers).get("authorization") ?? "";
  return auth.replace(/^Bearer tok:/, "");
};
async function fakeServices(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = String(input instanceof Request ? input.url : input);
  requests.push({ url, init });
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  try {
    await new Promise((r) => setTimeout(r, 5));
    if (url === "https://oauth2.googleapis.com/token") {
      // The token names the organizer it was asked for (the JWT's subject), so each request says whose it is
      const assertion = new URLSearchParams(String(init.body)).get("assertion") ?? "";
      const sub = (JSON.parse(Buffer.from(assertion.split(".")[1] ?? "", "base64url").toString()) as { sub: string }).sub;
      return Response.json({ access_token: `tok:${sub}` });
    }
    if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events")) {
      const method = init.method ?? "GET";
      if (method === "POST") {
        onEventPost();
        const event = { ...JSON.parse(String(init.body)), id: `ev${++eventIds}` };
        calendar.set(event.id, event);
        return Response.json(event);
      }
      const id = /\/events\/([^?]+)/.exec(url)?.[1] ?? "";
      if (method === "GET" && calendar.has(id)) return Response.json(calendar.get(id));
      return Response.json({}, { status: 404 });
    }
    if (url.startsWith("https://api.openai.com/v1/audio/transcriptions")) {
      if (sttFails) return Response.json({ error: { message: "down" } }, { status: 503 });
      return Response.json({ segments: [{ start: 1, end: 3, text: "Hello" }] });
    }
    if (url.startsWith("https://siem.example.org/")) return new Response("ok", { status: siemStatus });
    if (url.startsWith("https://hooks.example.org/")) return new Response("ok");
    throw new Error(`unexpected request to ${url}`);
  } finally {
    inFlight--;
  }
}

beforeAll(() => {
  vi.stubEnv("RONDE_CLOUD", "1");
  vi.stubEnv("APP_URL", "https://app.example.org");
  // The cloud's guard on outgoing requests goes through its own client: off here so the fakes answer, and back on
  // where a test checks it
  vi.stubEnv("RONDE_ALLOW_PRIVATE_URLS", "1");
  vi.stubEnv("INBOUND_IMAP_URL", "");
  vi.stubEnv("INBOUND_ADDRESS", "");
  vi.stubGlobal("fetch", vi.fn(fakeServices));
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  requests.length = 0;
  maxInFlight = 0;
  onEventPost = () => {};
});

const FIELDS: [min: number, max: number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];
/** A five-field cron expression whose every value is in range */
function validCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  return fields.every((field, i) => {
    const [min, max] = FIELDS[i]!;
    return field.split(",").every((part) => {
      const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
      if (!m) return false;
      const values = [m[2], m[3]].filter((v) => v !== undefined).map(Number);
      if (m[4] !== undefined && Number(m[4]) < 1) return false;
      return values.every((v) => v >= min && v <= max) && (values.length < 2 || values[0]! <= values[1]!);
    });
  });
}

describe("the list of jobs", () => {
  it("gives every job a handler, a unique name, and a valid schedule to the recurring ones", () => {
    expect(new Set(JOBS.map((j) => j.name)).size).toBe(JOBS.length);
    for (const job of JOBS) {
      expect(typeof job.handler, job.name).toBe("function");
      if (job.cron !== undefined) expect(validCron(job.cron), `${job.name}: ${job.cron}`).toBe(true);
    }
    // Only the jobs queued with their data run on demand
    expect(JOBS.filter((j) => !j.cron).map((j) => j.name)).toEqual(["notify.deliver", "audit.stream"]);
    expect(validCron("61 * * * *") || validCron("* * *") || validCron("*/0 * * * *")).toBe(false);
  });

  it("runs every recurring handler on an instance with nothing to do, without failing", async () => {
    for (const job of JOBS.filter((j) => j.cron)) await expect(job.handler({}), job.name).resolves.not.toThrow();
  });
});

/** A workspace in one state, with a weekly meeting from last week on, nobody's session open yet */
async function place(name: string, state: { suspended?: boolean; deleted?: boolean; plan?: string } = {}) {
  const w = await workspace(`jobs-${name}-${run}`);
  await prisma.workspace.update({
    where: { id: w.ws.id },
    data: {
      plan: state.plan ?? "team",
      suspendedAt: state.suspended ? new Date() : null,
      deletedAt: state.deleted ? new Date() : null,
    },
  });
  const m = await prisma.meeting.create({ data: { workspaceId: w.ws.id, name: `Weekly ${name}` } });
  await prisma.meetingParticipant.create({ data: { workspaceId: w.ws.id, meetingId: m.id, personId: w.host.id, role: "host" } });
  const start = new Date(Date.now() - 7 * DAY).toISOString().slice(0, 10);
  await prisma.scheduleRule.create({
    data: { workspaceId: w.ws.id, meetingId: m.id, freq: "weekly", byDay: [1], startDate: start, time: "23:59" },
  });
  return { ...w, meeting: m };
}

describe("sessions.prepare", () => {
  it("opens the next session of each meeting with a schedule, in open workspaces only", async () => {
    const open = await place("prep-open");
    const suspended = await place("prep-suspended", { suspended: true });
    const deleted = await place("prep-deleted", { deleted: true });
    const archived = await place("prep-archived");
    await prisma.meeting.update({ where: { id: archived.meeting.id }, data: { archivedAt: new Date() } });
    const unscheduled = await place("prep-unscheduled");
    await prisma.scheduleRule.deleteMany({ where: { meetingId: unscheduled.meeting.id } });

    await prepareSessions();

    const current = async (p: { meeting: { id: string } }) =>
      prisma.session.findMany({ where: { meetingId: p.meeting.id, status: "current" } });
    const [session] = await current(open);
    expect(session).toMatchObject({ occurrenceKey: expect.stringMatching(/:\d{4}-\d{2}-\d{2}$/) });
    expect(session!.date >= today() || session!.date === new Date(Date.now() - DAY).toISOString().slice(0, 10)).toBe(true);
    for (const p of [suspended, deleted, archived, unscheduled]) expect(await current(p), p.ws.slug).toEqual([]);
    // Run again: still one session, not a second
    await prepareSessions();
    expect(await current(open)).toHaveLength(1);
  });

  it("goes on with the other meetings when one fails", async () => {
    const broken = await place("prep-broken");
    // A time zone that does not exist: preparing this meeting throws
    await prisma.meeting.update({ where: { id: broken.meeting.id }, data: { timezone: "Nowhere/Atlantis" } });
    const fine = await place("prep-fine");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    await prepareSessions();
    expect(errors.mock.calls.some((c) => String(c[0]).includes(broken.meeting.id))).toBe(true);
    errors.mockRestore();
    expect(await prisma.session.count({ where: { meetingId: fine.meeting.id, status: "current" } })).toBe(1);
  });
});

describe("calendar.sync", () => {
  /** A meeting written into its own organizer's Google Calendar */
  async function synced(name: string, state: Parameters<typeof place>[1] = {}) {
    const p = await place(name, state);
    const organizer = `rooms-${name}@acme.test`;
    const account = await prisma.calendarAccount.create({
      data: {
        workspaceId: p.ws.id,
        kind: "google",
        name: "Google",
        config: { clientEmail: "sa@acme.iam.gserviceaccount.com", organizer },
        secret: encryptSecret(PEM),
      },
    });
    await prisma.meeting.update({ where: { id: p.meeting.id }, data: { calendarAccountId: account.id } });
    return { ...p, organizer, account };
  }
  const eventsOf = (p: { meeting: { id: string } }) => prisma.calendarEvent.count({ where: { meetingId: p.meeting.id } });
  const wroteFor = (organizer: string) =>
    requests.filter((r) => r.url.includes("/calendars/primary/events") && organizerOf(r.init) === organizer).length;
  let first: Awaited<ReturnType<typeof synced>>[] = [];

  it("syncs four meetings at a time, past an account that fails and leaving closed workspaces alone", async () => {
    first = [];
    for (let i = 0; i < 6; i++) first.push(await synced(`cal-${i}`));
    const failing = await synced("cal-failing");
    // Its key cannot be read any more (SECRET_KEY changed): its sync throws
    await prisma.calendarAccount.update({ where: { id: failing.account.id }, data: { secret: "unreadable" } });
    const suspended = await synced("cal-suspended", { suspended: true });
    const deleted = await synced("cal-deleted", { deleted: true });
    const community = await synced("cal-community", { plan: "community" });

    const changed = await syncCalendars();

    for (const p of first) expect(await eventsOf(p), p.ws.slug).toBeGreaterThan(0);
    expect(changed).toBe((await Promise.all(first.map(eventsOf))).reduce((a, b) => a + b, 0));
    expect(maxInFlight).toBe(4);
    for (const p of [failing, suspended, deleted, community]) {
      expect(await eventsOf(p), p.ws.slug).toBe(0);
      expect(wroteFor(p.organizer), p.ws.slug).toBe(0);
    }
    // Their events are written: nothing more to write on the next run
    requests.length = 0;
    expect(await syncCalendars()).toBe(0);
    expect(requests.filter((r) => r.init.method === "POST" && r.url.includes("/events")).length).toBe(0);
  });

  it("starts no new meeting once its time is spent, and leaves the rest to the next run", async () => {
    // The first ones out of the way (their events dropped, so nothing is left to clean up in their calendars)
    for (const p of first) {
      await prisma.calendarEvent.deleteMany({ where: { meetingId: p.meeting.id } });
      await prisma.meeting.update({ where: { id: p.meeting.id }, data: { archivedAt: new Date() } });
    }
    await prisma.meeting.updateMany({ where: { name: "Weekly cal-failing" }, data: { calendarAccountId: null } });
    const late: Awaited<ReturnType<typeof synced>>[] = [];
    for (let i = 0; i < 6; i++) late.push(await synced(`late-${i}`));
    // Eleven minutes pass as soon as the first event is written: past the ten minutes a run may take
    const realNow = Date.now.bind(Date);
    let skew = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => realNow() + skew);
    onEventPost = () => {
      skew = 11 * 60_000;
    };
    try {
      await syncCalendars();
    } finally {
      clock.mockRestore();
    }
    const counts = await Promise.all(late.map(eventsOf));
    // The four meetings already begun are finished; the two others wait for the next run
    expect(counts.filter((n) => n > 0)).toHaveLength(4);
    expect(counts.filter((n) => n === 0)).toHaveLength(2);
    await syncCalendars();
    for (const p of late) expect(await eventsOf(p), p.ws.slug).toBeGreaterThan(0);
  });
});

describe("notify.daily", () => {
  /** A meeting told of its actions overdue for three days and of birthdays, through a webhook */
  async function told(name: string, state: Parameters<typeof place>[1] = {}) {
    const p = await place(name, state);
    const connector = await prisma.connector.create({
      data: { workspaceId: p.ws.id, kind: "webhook", name: "Hook", config: { url: "https://hooks.example.org/ronde" } },
    });
    const base = { workspaceId: p.ws.id, meetingId: p.meeting.id, connectorId: connector.id };
    const overdue = await prisma.notificationRule.create({ data: { ...base, event: "action_overdue", options: { days: 3 } } });
    const birthday = await prisma.notificationRule.create({ data: { ...base, event: "birthday" } });
    await prisma.action.create({
      data: {
        workspaceId: p.ws.id,
        meetingId: p.meeting.id,
        text: "Send the quote",
        ownerId: p.host.id,
        createdAt: new Date(Date.now() - 5 * DAY),
      },
    });
    return { ...p, rules: { overdue, birthday } };
  }
  const deliveries = (p: { meeting: { id: string } }) =>
    prisma.delivery.findMany({ where: { meetingId: p.meeting.id }, orderBy: { event: "asc" } });
  const at = (time: string) => new Date(`${today()}T${time}:00Z`);

  it("tells each open meeting of its overdue actions and birthdays once a day, from 09:00", async () => {
    const open = await told("daily-open");
    const suspended = await told("daily-suspended", { suspended: true });
    const deleted = await told("daily-deleted", { deleted: true });
    for (const p of [open, suspended, deleted])
      await prisma.person.update({ where: { id: p.host.id }, data: { birthday: today().slice(5) } });

    // Before nine in the workspace's time zone: nothing yet
    await checkDaily(at("08:59"));
    expect(await deliveries(open)).toEqual([]);

    expect(await checkDaily(at("09:00"))).toBe(2);
    expect((await deliveries(open)).map((d) => [d.event, d.key])).toEqual([
      ["action.overdue", `${open.rules.overdue.id}:action.overdue:${today()}`],
      ["birthday", `${open.rules.birthday.id}:birthday:${today()}`],
    ]);
    expect(await deliveries(suspended)).toEqual([]);
    expect(await deliveries(deleted)).toEqual([]);
    // Checked again in the hour after: already sent today
    expect(await checkDaily(at("10:03"))).toBe(0);
    expect(await deliveries(open)).toHaveLength(2);
  });

  it("says nothing when no action is overdue that long and nobody's birthday is today", async () => {
    const quiet = await told("daily-quiet");
    await prisma.action.updateMany({ where: { meetingId: quiet.meeting.id }, data: { createdAt: new Date(Date.now() - 2 * DAY) } });
    await checkDaily(at("12:00"));
    expect(await deliveries(quiet)).toEqual([]);
  });
});

describe("audit.stream", () => {
  let f: Fixture;
  let entryId = "";
  const SECRET = "whsec_stream_secret";
  const streamTo = async (url: string) => {
    await prisma.connector.update({ where: { id: f.connectorId }, data: { config: { url }, secret: encryptSecret(SECRET) } });
  };
  beforeAll(async () => {
    f = await meeting(await workspace(`jobs-audit-${run}`), "Weekly");
    await prisma.workspace.update({
      where: { id: f.workspaceId },
      data: { plan: "enterprise", settings: { auditStream: { connectorId: f.connectorId } } },
    });
    entryId = (await prisma.auditLog.create({ data: { workspaceId: f.workspaceId, action: "meeting.archive", actorLabel: "Host" } })).id;
  });

  it("sends each entry signed with the connector's key", async () => {
    await streamTo("https://siem.example.org/ronde");
    await streamAudit({ workspaceId: f.workspaceId, auditId: entryId });
    const sent = requests.find((r) => r.url === "https://siem.example.org/ronde")!;
    const headers = new Headers(sent.init.headers);
    const body = String(sent.init.body);
    expect(headers.get("x-ronde-delivery")).toBe(entryId);
    expect(headers.get("x-ronde-signature")).toBe(`sha256=${signWebhook(SECRET, headers.get("x-ronde-timestamp")!, body)}`);
    expect(JSON.parse(body)).toMatchObject({
      id: entryId,
      event: "audit",
      workspace: f.ctx.ws.workspace.slug,
      entry: { action: "meeting.archive" },
    });
  });

  it("fails, to be retried, when the SIEM refuses or the entry is not committed yet", async () => {
    await streamTo("https://siem.example.org/ronde");
    siemStatus = 503;
    await expect(streamAudit({ workspaceId: f.workspaceId, auditId: entryId })).rejects.toThrow("audit stream answered 503");
    siemStatus = 200;
    const missing = "00000000-0000-7000-8000-000000000000";
    await expect(streamAudit({ workspaceId: f.workspaceId, auditId: missing })).rejects.toThrow(`audit entry ${missing} not found yet`);
  });

  it("never sends over plain http", async () => {
    await streamTo("http://siem.example.org/ronde");
    await expect(streamAudit({ workspaceId: f.workspaceId, auditId: entryId })).rejects.toThrow("unsafe audit stream address");
    expect(requests).toEqual([]);
  });

  it("never reaches a private address in the cloud", async () => {
    vi.stubEnv("RONDE_ALLOW_PRIVATE_URLS", "0");
    try {
      for (const url of ["https://10.0.0.7/siem", "https://192.168.1.20/siem", "https://localhost/siem"]) {
        await streamTo(url);
        const failure = await streamAudit({ workspaceId: f.workspaceId, auditId: entryId }).then(
          () => null,
          (e: unknown) => e as Error & { cause?: Error },
        );
        expect(failure?.cause?.message ?? failure?.message, url).toMatch(/is on a private network, out of reach from here/);
      }
    } finally {
      vi.stubEnv("RONDE_ALLOW_PRIVATE_URLS", "1");
    }
    expect(requests).toEqual([]);
  });

  it("sends nothing for a workspace whose plan has no stream, or without its connector", async () => {
    await streamTo("https://siem.example.org/ronde");
    await prisma.workspace.update({ where: { id: f.workspaceId }, data: { plan: "team" } });
    await streamAudit({ workspaceId: f.workspaceId, auditId: entryId });
    await prisma.workspace.update({
      where: { id: f.workspaceId },
      data: { plan: "enterprise", settings: { auditStream: { connectorId: "00000000-0000-7000-8000-000000000000" } } },
    });
    await streamAudit({ workspaceId: f.workspaceId, auditId: entryId });
    expect(requests).toEqual([]);
  });
});

describe("transcript.process", () => {
  let f: Fixture;
  const piece = (age: number) =>
    prisma.audioChunk.create({
      data: {
        workspaceId: f.workspaceId,
        sessionId: f.sessionId,
        data: new Uint8Array([1, 2, 3]),
        type: "audio/webm",
        startAt: new Date(),
        endAt: new Date(Date.now() + 30_000),
        steps: [{ at: Date.now() - 60_000, key: f.memberId }],
        createdAt: new Date(Date.now() - age),
      },
    });
  beforeAll(async () => {
    f = await meeting(await workspace(`jobs-stt-${run}`), "Weekly");
    await prisma.workspace.update({
      where: { id: f.workspaceId },
      data: { plan: "team", settings: { transcription: { enabled: true, baseUrl: "", model: "whisper-1", key: encryptSecret("sk-t") } } },
    });
  });
  beforeEach(() => prisma.audioChunk.deleteMany({ where: { workspaceId: f.workspaceId } }));

  it("transcribes the pieces left over a minute ago, twenty a run, and leaves the fresh ones to the recorder", async () => {
    for (let i = 0; i < 22; i++) await piece(5 * 60_000 + i);
    const fresh = await piece(10_000);
    expect(await processPendingChunks()).toBe(20);
    expect(await prisma.transcriptSegment.count({ where: { sessionId: f.sessionId, speakerId: f.memberId } })).toBe(20);
    // The sound of each piece transcribed is gone
    expect((await prisma.audioChunk.findMany({ where: { workspaceId: f.workspaceId } })).length).toBe(3);
    expect(await processPendingChunks()).toBe(2);
    expect((await prisma.audioChunk.findMany({ where: { workspaceId: f.workspaceId } })).map((c) => c.id)).toEqual([fresh.id]);
  });

  it("tries a failing piece three times, then drops its sound", async () => {
    const c = await piece(5 * 60_000);
    sttFails = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await processPendingChunks();
      expect(await prisma.audioChunk.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ attempts: 1 });
      await processPendingChunks();
      expect(await prisma.audioChunk.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ attempts: 2 });
      await processPendingChunks();
      expect(await prisma.audioChunk.findUnique({ where: { id: c.id } })).toBeNull();
    } finally {
      sttFails = false;
      errors.mockRestore();
    }
  });

  it("drops the sound without sending it anywhere once the workspace turned transcription off", async () => {
    await prisma.workspace.update({ where: { id: f.workspaceId }, data: { settings: { transcription: { enabled: false } } } });
    await piece(5 * 60_000);
    expect(await processPendingChunks()).toBe(0);
    expect(await prisma.audioChunk.count({ where: { workspaceId: f.workspaceId } })).toBe(0);
    expect(requests).toEqual([]);
  });
  it("sends nothing from a suspended or deleted workspace", async () => {
    await piece(5 * 60_000);
    await prisma.workspace.update({ where: { id: f.workspaceId }, data: { suspendedAt: new Date() } });
    expect(await processPendingChunks()).toBe(0);
    await prisma.workspace.update({ where: { id: f.workspaceId }, data: { suspendedAt: null, deletedAt: new Date() } });
    expect(await processPendingChunks()).toBe(0);
    expect(requests).toEqual([]);
    expect(await prisma.audioChunk.count({ where: { workspaceId: f.workspaceId } })).toBe(1);
  });
});

describe("inbound.check", () => {
  let f: Fixture;
  let member: { id: string; email: string };
  const reply = (uid: number, from: string, inReplyTo: string | undefined, body: string, size?: number): Mail => ({
    uid,
    inReplyTo,
    size,
    source: [
      `From: ${from}`,
      "To: checkins@ronde.test",
      "Subject: Re: Your check-in",
      ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
      "Content-Type: text/plain; charset=utf-8",
      "",
      body,
    ].join("\r\n"),
  });
  beforeAll(async () => {
    f = await meeting(await workspace(`jobs-inbound-${run}`), "Weekly");
    member = await prisma.person.findUniqueOrThrow({ where: { id: f.memberId }, select: { id: true, email: true } });
  });
  beforeEach(() => {
    Object.assign(imap, { messages: [], options: [], locked: [], sourcesRead: [], created: [], released: 0, loggedOut: 0 });
    mails.length = 0;
  });

  it("does not connect when replies are not read", async () => {
    expect(await checkInbound()).toBe(0);
    expect(imap.options).toEqual([]);
  });

  it("takes the replies to a reminder into check-ins, puts them away, and touches nothing else", async () => {
    vi.stubEnv("INBOUND_IMAP_URL", "imaps://checkins%40ronde.test:p%40ss@imap.ronde.test/Replies");
    try {
      const id = replyMessageId(member.id, f.meetingId)!;
      const forged = id.replace(/\.([\w-]{22})@/, ".AAAAAAAAAAAAAAAAAAAAAA@");
      imap.messages = [
        reply(1, member.email, id, "Done this week\n- Wrote the job tests"),
        reply(2, "news@vendor.test", undefined, "Our newsletter"),
        reply(3, member.email, forged, "Done this week\n- Forged"),
        // Too big to download: put away unread
        reply(4, member.email, id, "Done this week\n- Huge", 2_000_000),
      ];
      expect(await checkInbound()).toBe(1);
      expect(imap.options[0]).toMatchObject({
        host: "imap.ronde.test",
        port: 993,
        secure: true,
        auth: { user: "checkins@ronde.test", pass: "p@ss" },
      });
      expect(imap.locked).toEqual(["Replies"]);
      expect(imap.created).toEqual(["Ronde"]);
      const items = await prisma.checkInItem.findMany({ where: { meetingId: f.meetingId, personId: member.id } });
      expect(items.map((i) => i.text)).toContain("Wrote the job tests");
      expect(items.map((i) => i.text)).not.toContain("Forged");
      expect(items.map((i) => i.text)).not.toContain("Huge");
      expect(mails.map((m) => m.to)).toEqual([member.email]);
      expect(imap.sourcesRead).toEqual([1]);
      expect(imap.messages.map((m) => [m.uid, !!m.seen, m.folder ?? null])).toEqual([
        [1, true, "Ronde"],
        [2, false, null],
        [3, false, null],
        [4, true, "Ronde"],
      ]);
      // The mailbox let go of, whatever happened
      expect([imap.released, imap.loggedOut]).toEqual([1, 1]);
      // Nothing left to read on the next run
      expect(await checkInbound()).toBe(0);
    } finally {
      vi.stubEnv("INBOUND_IMAP_URL", "");
    }
  });
});

describe("push.inbox", () => {
  it("pushes the bell's new items only to members of open workspaces", async () => {
    vi.stubEnv("WEB_PUSH_PUBLIC_KEY", "public-key");
    vi.stubEnv("WEB_PUSH_PRIVATE_KEY", "private-key");
    try {
      const placed = [
        await place("push-open"),
        await place("push-suspended", { suspended: true }),
        await place("push-deleted", { deleted: true }),
      ];
      for (const p of placed) {
        await prisma.pushSubscription.create({
          data: {
            userId: p.user.id,
            endpoint: `https://fcm.googleapis.com/fcm/send/${p.ws.slug}`,
            p256dh: "p".repeat(30),
            auth: "a".repeat(22),
          },
        });
        await prisma.inboxItem.create({ data: { workspaceId: p.ws.id, personId: p.host.id, kind: "kudo.received", href: "/" } });
      }
      pushed.length = 0;
      await pushInbox();
      expect(pushed.map((x) => x.endpoint)).toEqual([`https://fcm.googleapis.com/fcm/send/${placed[0]!.ws.slug}`]);
      // None left waiting: the others are not tried again on every run
      expect(await prisma.inboxItem.count({ where: { workspaceId: { in: placed.map((p) => p.ws.id) }, pushedAt: null } })).toBe(0);
    } finally {
      vi.stubEnv("WEB_PUSH_PUBLIC_KEY", "");
      vi.stubEnv("WEB_PUSH_PRIVATE_KEY", "");
    }
  });
});
