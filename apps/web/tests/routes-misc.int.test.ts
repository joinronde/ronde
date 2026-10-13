import { createSign, generateKeyPairSync } from "node:crypto";
import { can, type Permission, type WorkspaceRole } from "@ronde/core/permissions";
import { prisma, scoped } from "@ronde/db";
import { LATEST_MIGRATION } from "@ronde/db/migrations";
import { translator } from "@ronde/i18n";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "@/lib/server/authz";
import { type Fixture, meeting, workspace } from "./fixtures";

// The smaller routes: health, calendar links, the weekly summary's unsubscribe, the workspace's logo and a
// meeting's picture, its directory, history, draft, sound and video room, Teams' and Slack's doors, and SCIM's
// answers when the workspace is suspended or something breaks. The person signed in is set by each test; the
// meeting's access checks run for real on top of it.

let current: WorkspaceContext | null = null;
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
}));
vi.mock("next-intl/server", async () => {
  const { translator } = await import("@ronde/i18n");
  return { getTranslations: async (ns: Parameters<typeof translator>[1]) => translator("en", ns) };
});
// The database as the health probe sees it: down on demand
const db = vi.hoisted(() => ({ down: false }));
vi.mock("@/lib/server/db", async (original) => {
  const real = await original<typeof import("@/lib/server/db")>();
  const prisma = new Proxy(real.prisma, {
    get: (target, key) =>
      key === "$queryRaw" && db.down ? () => Promise.reject(new Error("connection refused")) : Reflect.get(target, key, target),
  });
  return { ...real, prisma };
});
vi.mock("@/lib/server/authz", async (original) => {
  const real = await original<typeof import("@/lib/server/authz")>();
  const { AccessError } = await import("@/lib/server/errors");
  const requireUser = async () => {
    if (!current) throw new AccessError(401, "signInRequired");
    return current.user;
  };
  return {
    ...real,
    currentUser: async () => current?.user ?? null,
    requireUser,
    pageUser: requireUser,
    workspaceContext: async (slug: string) => (current?.workspace.slug === slug ? current : null),
    // As the real one: the workspace of the person signed in, and the permission their role gives
    authorize: async (slug: string, permission?: Permission) => {
      await requireUser();
      if (current?.workspace.slug !== slug || (permission && !current.can(permission))) throw new AccessError(403, "accessDenied");
      return current;
    },
  };
});

const { GET: health } = await import("@/app/api/health/route");
const { POST: newPersonalFeed } = await import("@/app/api/calendar/route");
const { GET: feed } = await import("@/app/api/calendar/[token]/route");
const { POST: newMeetingFeed } = await import("@/app/api/w/[ws]/m/[meeting]/calendar/route");
const { GET: unsubscribe } = await import("@/app/api/unsubscribe/weekly/route");
const logo = await import("@/app/api/w/[ws]/logo/route");
const image = await import("@/app/api/w/[ws]/m/[meeting]/image/route");
const { GET: directory } = await import("@/app/api/w/[ws]/m/[meeting]/people/route");
const { GET: historyMine } = await import("@/app/api/w/[ws]/m/[meeting]/history/mine/route");
const { GET: draft } = await import("@/app/api/w/[ws]/m/[meeting]/draft/route");
const { POST: audio } = await import("@/app/api/w/[ws]/m/[meeting]/audio/route");
const { GET: video } = await import("@/app/w/[ws]/m/[meeting]/video/route");
const { POST: teamsMessages } = await import("@/app/api/teams/messages/route");
const { GET: slackInstall } = await import("@/app/api/slack/install/route");
const { GET: slackOauth } = await import("@/app/api/slack/oauth/route");
const scim = await import("@/app/api/scim/v2/[ws]/[[...path]]/route");
const { enterprise } = await import("@/ee-bridge");
const { encryptSecret } = await import("@/lib/server/secrets");
const { installState } = await import("@/lib/server/slack");
const { newScimToken } = await import("@/lib/server/scim");

const APP = "https://app.example.org";
const t = translator("en", "errors");
const run = Date.now().toString(36);

/** Requests going out, answered by the fake service each is for */
const outbound: { url: string; init: RequestInit }[] = [];
let bbbAnswer = "<response><returncode>SUCCESS</returncode></response>";
const fakeServices = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  outbound.push({ url, init });
  if (url.startsWith("https://bbb.example.org/")) return new Response(bbbAnswer, { headers: { "content-type": "text/xml" } });
  if (url === "https://slack.com/api/oauth.v2.access")
    return Response.json({ ok: true, access_token: "xoxb-1", bot_user_id: "UBOT", team: { id: "T-ACME", name: "Acme" } });
  if (url.startsWith("https://api.openai.com/")) return Response.json({ segments: [{ start: 0, end: 1, text: "Hello" }] });
  if (url === "https://login.botframework.com/v1/.well-known/openidconfiguration")
    return Response.json({ jwks_uri: "https://login.botframework.com/v1/.well-known/keys" });
  if (url === "https://login.botframework.com/v1/.well-known/keys") return Response.json({ keys: [{ kid: "microsoft-key", kty: "RSA" }] });
  throw new Error(`unexpected request to ${url}`);
});

beforeAll(() => {
  vi.stubEnv("RONDE_CLOUD", "1");
  // The fakes answer through the global fetch; the cloud's own client for configured addresses is tested elsewhere
  vi.stubEnv("RONDE_ALLOW_PRIVATE_URLS", "1");
  vi.stubEnv("APP_URL", APP);
  vi.stubGlobal("fetch", fakeServices);
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  outbound.length = 0;
});

/** The workspace as a person of that role sees it (the host's account, or another person's) */
function as(
  w: Awaited<ReturnType<typeof workspace>>,
  role: WorkspaceRole,
  person = { id: w.host.id, userId: w.user.id },
): WorkspaceContext {
  const principal = { userId: person.userId, personId: person.id, workspaceId: w.ws.id, workspaceRole: role };
  return {
    user: {
      id: person.userId,
      name: "Someone",
      email: `${person.userId}@x.test`,
      image: null,
      locale: null,
      timezone: null,
      instanceRole: "user",
    },
    workspace: { id: w.ws.id, slug: w.ws.slug, name: w.ws.name, locale: "en", timezone: "UTC", plan: w.ws.plan, settings: {} },
    member: { id: w.member.id, personId: person.id, role },
    principal,
    db: scoped(prisma, w.ws.id),
    can: (p: Permission) => can(principal, p),
  };
}

/** Another person of the workspace, with an account, in the meeting with that role (none: not in it) */
async function person(
  w: Awaited<ReturnType<typeof workspace>>,
  name: string,
  meetingRole?: { meetingId: string; role: "host" | "participant" | "observer" },
) {
  const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `${name}-${run}@${w.ws.slug}.test`, name } });
  const p = await prisma.person.create({ data: { workspaceId: w.ws.id, userId: user.id, email: user.email, firstName: name } });
  await prisma.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: user.id, personId: p.id, role: "member" } });
  if (meetingRole)
    await prisma.meetingParticipant.create({
      data: { workspaceId: w.ws.id, meetingId: meetingRole.meetingId, personId: p.id, role: meetingRole.role, position: 9 },
    });
  return { id: p.id, userId: user.id, email: user.email };
}

const meetingParams = (f: Fixture, slug: string) => ({ params: Promise.resolve({ ws: slug, meeting: f.meetingId }) });
const errorOf = async (res: Response) => ((await res.json()) as { error: string }).error;

let w: Awaited<ReturnType<typeof workspace>>;
let f: Fixture;
let participant: Awaited<ReturnType<typeof person>>;
beforeAll(async () => {
  w = await workspace(`routes-${run}`);
  w.ws = await prisma.workspace.update({ where: { id: w.ws.id }, data: { plan: "team" } });
  f = await meeting(w, "Weekly");
  participant = await person(w, "Lena", { meetingId: f.meetingId, role: "participant" });
});
const host = () => as(w, "owner");
const member = () => as(w, "member", participant);

describe("the health probe", () => {
  it("waits for the newest migration, then answers ok", async () => {
    const mark = (finished: Date | null) =>
      prisma.$executeRaw`UPDATE "_prisma_migrations" SET finished_at = ${finished} WHERE migration_name = ${LATEST_MIGRATION}`;
    expect(await mark(null)).toBe(1);
    try {
      const res = await health();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ status: "migrations_pending", waiting: LATEST_MIGRATION });
    } finally {
      await mark(new Date());
    }
    const ok = await health();
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: "ok" });
  });

  it("says when the database does not answer", async () => {
    db.down = true;
    try {
      const res = await health();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ status: "database_unreachable" });
    } finally {
      db.down = false;
    }
    expect((await health()).status).toBe(200);
  });
});

describe("calendar links", () => {
  const tokenOf = (url: string) => {
    expect(url).toMatch(new RegExp(`^${APP}/api/calendar/[\\w-]+\\.ics$`));
    return url.slice(url.lastIndexOf("/") + 1);
  };
  const read = (token: string) => feed(new Request(`${APP}/api/calendar/${token}`), { params: Promise.resolve({ token }) });

  it("turn the previous personal link off when a new one is made", async () => {
    current = host();
    const first = tokenOf(((await (await newPersonalFeed()).json()) as { url: string }).url);
    expect((await read(first)).status).toBe(200);
    const second = tokenOf(((await (await newPersonalFeed()).json()) as { url: string }).url);
    expect(second).not.toBe(first);
    expect((await read(first)).status).toBe(404);
    const ics = await read(second);
    expect(ics.status).toBe(200);
    expect(ics.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(await ics.text()).toContain("BEGIN:VCALENDAR");
  });

  it("turn the previous link of a meeting off, and leave the personal one alone", async () => {
    current = host();
    const personal = tokenOf(((await (await newPersonalFeed()).json()) as { url: string }).url);
    const post = () => newMeetingFeed(new Request(`${APP}/x`, { method: "POST" }), meetingParams(f, w.ws.slug));
    const first = tokenOf(((await (await post()).json()) as { url: string }).url);
    expect((await read(first)).status).toBe(200);
    const second = tokenOf(((await (await post()).json()) as { url: string }).url);
    expect((await read(first)).status).toBe(404);
    expect((await read(second)).status).toBe(200);
    expect((await read(personal)).status).toBe(200);
  });

  it("are made only for someone signed in who sees the meeting", async () => {
    current = null;
    const res = await newPersonalFeed();
    expect(res.status).toBe(401);
    expect(await errorOf(res)).toBe(t("signInRequired"));
    // Someone of the workspace outside the meeting: it does not exist for them
    current = as(w, "member", await person(w, "Outsider"));
    const other = await newMeetingFeed(new Request(`${APP}/x`, { method: "POST" }), meetingParams(f, w.ws.slug));
    expect(other.status).toBe(403);
    expect(await errorOf(other)).toBe(t("accessDenied"));
  });
});

describe("the weekly summary's unsubscribe link", () => {
  it("sends a browser to the page that asks first, keeping the signed query", async () => {
    const res = unsubscribe(new Request(`${APP}/ronde/api/unsubscribe/weekly?u=user-1&t=abc`));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${APP}/ronde/unsubscribe/weekly?u=user-1&t=abc`);
  });
});

const png = () =>
  sharp({ create: { width: 40, height: 20, channels: 3, background: "#3366ff" } })
    .png()
    .toBuffer();

describe("the workspace's logo", () => {
  const params = () => ({ params: Promise.resolve({ ws: w.ws.slug }) });
  const get = () => logo.GET(new Request(`${APP}/x`), params());

  it("is uploaded and removed by the administrators only, and served to anyone while the plan has it", async () => {
    expect((await get()).status).toBe(404);
    current = member();
    const refused = await logo.PUT(new Request(`${APP}/x`, { method: "PUT", body: await png() }), params());
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe(t("accessDenied"));

    current = host();
    expect((await logo.PUT(new Request(`${APP}/x`, { method: "PUT", body: await png() }), params())).status).toBe(200);
    // Public: emails and the shared screen load it, nobody signed in
    current = null;
    const served = await get();
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/webp");
    expect(served.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(served.headers.get("x-content-type-options")).toBe("nosniff");

    // Not served once the plan no longer has custom branding, nor once the workspace is deleted
    await prisma.workspace.update({ where: { id: w.ws.id }, data: { plan: "community" } });
    expect((await get()).status).toBe(404);
    await prisma.workspace.update({ where: { id: w.ws.id }, data: { plan: "team", deletedAt: new Date() } });
    expect((await get()).status).toBe(404);
    await prisma.workspace.update({ where: { id: w.ws.id }, data: { deletedAt: null } });
    expect((await get()).status).toBe(200);

    current = member();
    const kept = await logo.DELETE(new Request(`${APP}/x`, { method: "DELETE" }), params());
    expect(kept.status).toBe(403);
    expect(await errorOf(kept)).toBe(t("accessDenied"));
    expect((await get()).status).toBe(200);
    current = host();
    expect((await logo.DELETE(new Request(`${APP}/x`, { method: "DELETE" }), params())).status).toBe(200);
    expect((await get()).status).toBe(404);
  });

  it("refuses what is not an image", async () => {
    current = host();
    const res = await logo.PUT(new Request(`${APP}/x`, { method: "PUT", body: "<svg onload=alert(1)>" }), params());
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe(t("logoFormat"));
  });
});

describe("a meeting's picture", () => {
  const call = (method: "GET" | "PUT" | "DELETE", body?: Uint8Array<ArrayBuffer>) =>
    image[method](new Request(`${APP}/x`, { method, body }), meetingParams(f, w.ws.slug));

  it("is changed by the people configuring the meeting, and seen by its participants", async () => {
    current = member();
    expect((await call("GET")).status).toBe(404);
    const refused = await call("PUT", new Uint8Array(await png()));
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe(t("accessDenied"));

    current = host();
    expect((await call("PUT", new Uint8Array(await png()))).status).toBe(200);
    current = member();
    const seen = await call("GET");
    expect(seen.status).toBe(200);
    expect(seen.headers.get("content-type")).toBe("image/webp");
    // Private: only the people who see the meeting
    expect(seen.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    const kept = await call("DELETE");
    expect(kept.status).toBe(403);
    expect(await errorOf(kept)).toBe(t("accessDenied"));

    current = null;
    expect((await call("GET")).status).toBe(401);
    current = as(w, "member", await person(w, "Stranger"));
    const hidden = await call("GET");
    expect(hidden.status).toBe(403);
    expect(await errorOf(hidden)).toBe(t("accessDenied"));

    current = host();
    expect((await call("DELETE")).status).toBe(200);
    expect((await call("GET")).status).toBe(404);
  });

  it("refuses what is too big or not an image", async () => {
    current = host();
    const big = await call("PUT", new Uint8Array(300_001).fill(1));
    expect(big.status).toBe(413);
    expect(await errorOf(big)).toBe(t("avatarTooLarge", { max: 300 }));
    const text = await call("PUT", new TextEncoder().encode("GIF89a not quite"));
    expect(text.status).toBe(400);
    expect(await errorOf(text)).toBe(t("avatarFormat"));
  });
});

describe("the directory to add people from", () => {
  type Row = { id: string; name: string; email: string; hasAccount: boolean };
  const list = async () => {
    const res = await directory(new Request(`${APP}/x`), meetingParams(f, w.ws.slug));
    return { status: res.status, body: (await res.json()) as Row[] | { error: string } };
  };

  it("lists the people not in the meeting yet, with their addresses for those who read the directory", async () => {
    const newcomer = await person(w, "Newcomer");
    current = host();
    const { status, body } = await list();
    expect(status).toBe(200);
    const rows = body as Row[];
    expect(rows.find((r) => r.id === newcomer.id)).toMatchObject({ name: "Newcomer", email: newcomer.email, hasAccount: true });
    // Already in the meeting: not offered again
    expect(rows.map((r) => r.id)).not.toContain(participant.id);
    expect(rows.map((r) => r.id)).not.toContain(f.hostPersonId);
  });

  it("gives a guest of the workspace hosting a meeting the names, not the addresses", async () => {
    const guest = await person(w, "Guesthost", { meetingId: f.meetingId, role: "host" });
    current = as(w, "guest", guest);
    expect(current.can("people.read")).toBe(false);
    const { status, body } = await list();
    expect(status).toBe(200);
    const rows = body as Row[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.email === "" && r.name)).toBe(true);
  });

  it("is refused to a participant, who does not manage the meeting's people", async () => {
    current = member();
    const { status, body } = await list();
    expect(status).toBe(403);
    expect(body).toEqual({ error: t("accessDenied") });
  });
});

describe("one's own past check-ins", () => {
  it("lists those of the archived sessions, newest first, and nobody else's", async () => {
    const record = (date: string, items: Record<string, string>) => ({
      v: 1,
      date,
      teamName: "Weekly",
      startedAt: null,
      endedAt: null,
      durationMs: 600_000,
      spent: { [participant.id]: 90_000 },
      participants: [
        { id: participant.id, name: "Lena", jobCategory: "" },
        { id: f.hostPersonId, name: "Host", jobCategory: "" },
      ],
      absent: [],
      sections: [{ key: "done", label: "", role: "achievement", input: "list" }],
      checkIns: Object.fromEntries(
        Object.entries(items).map(([id, text]) => [id, { items: [{ id: `i-${id}-${date}`, section: "done", text }] }]),
      ),
      notes: {},
      interactions: [],
      topics: [],
      actions: [],
      names: {},
    });
    const archive = (date: string, items: Record<string, string>) =>
      prisma.session.create({
        data: { workspaceId: w.ws.id, meetingId: f.meetingId, date, status: "archived", record: record(date, items) },
      });
    await archive("2026-09-07", { [participant.id]: "Lena's first week", [f.hostPersonId]: "The host's week" });
    await archive("2026-09-14", { [participant.id]: "Lena's second week" });
    await archive("2026-09-21", { [f.hostPersonId]: "Only the host" });

    current = member();
    const res = await historyMine(new Request(`${APP}/x`), meetingParams(f, w.ws.slug));
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { date: string; checkIn: { done: string[] }; spent: number }[];
    expect(rows.map((r) => [r.date, r.checkIn.done, r.spent])).toEqual([
      ["2026-09-14", ["Lena's second week"], 90_000],
      ["2026-09-07", ["Lena's first week"], 90_000],
    ]);
  });

  it("is empty for an observer, who never presents", async () => {
    const observer = await person(w, "Watcher", { meetingId: f.meetingId, role: "observer" });
    current = as(w, "member", observer);
    const res = await historyMine(new Request(`${APP}/x`), meetingParams(f, w.ws.slug));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

describe("the draft of the minutes", () => {
  it("gives the session's record to those who edit the minutes only", async () => {
    current = host();
    const res = await draft(new Request(`${APP}/x`), meetingParams(f, w.ws.slug));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { record } = (await res.json()) as { record: { date: string; checkIns: Record<string, unknown> } };
    expect(record.date).toBe("2030-01-07");
    expect(Object.keys(record.checkIns)).toContain(f.memberId);

    current = member();
    const refused = await draft(new Request(`${APP}/x`), meetingParams(f, w.ws.slug));
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe(t("accessDenied"));
  });

  it("says so when no session is open", async () => {
    const other = await meeting(w, "No session");
    await prisma.session.updateMany({ where: { meetingId: other.meetingId }, data: { status: "archived" } });
    current = host();
    const res = await draft(new Request(`${APP}/x`), meetingParams(other, w.ws.slug));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe(t("noMeeting"));
  });
});

describe("a piece of the session's sound", () => {
  let recording: Fixture;
  const send = (
    o: { type?: string; body?: Uint8Array<ArrayBuffer>; start?: number; end?: number; steps?: string; length?: string } = {},
  ) => {
    const now = Date.now();
    const headers: Record<string, string> = {
      "content-type": o.type ?? "audio/webm",
      "x-ronde-start": String(o.start ?? now - 30_000),
      "x-ronde-end": String(o.end ?? now),
      "x-ronde-steps": o.steps ?? JSON.stringify([{ at: now - 30_000, key: recording.memberId }]),
    };
    if (o.length) headers["content-length"] = o.length;
    return audio(
      new Request(`${APP}/x`, { method: "POST", headers, body: o.body ?? new Uint8Array([1, 2, 3]) }),
      meetingParams(recording, w.ws.slug),
    );
  };
  beforeAll(async () => {
    recording = await meeting(w, "Recorded");
    await prisma.meeting.update({ where: { id: recording.meetingId }, data: { transcription: true } });
    await prisma.workspace.update({
      where: { id: w.ws.id },
      data: { settings: { transcription: { enabled: true, baseUrl: "", model: "whisper-1", key: encryptSecret("sk-t") } } },
    });
  });
  const asHost = () => {
    const ctx = host();
    current = {
      ...ctx,
      workspace: {
        ...ctx.workspace,
        settings: { transcription: { enabled: true, baseUrl: "", model: "whisper-1", language: "", key: encryptSecret("sk-t") } },
      },
    };
  };

  it("is refused while the recording is off", async () => {
    asHost();
    const res = await send();
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe(t("notRecording"));
  });

  it("is taken while recording, then transcribed and its sound deleted", async () => {
    await prisma.session.update({ where: { id: recording.sessionId }, data: { recordingSince: new Date(Date.now() - 60_000) } });
    asHost();
    const res = await send();
    expect(res.status).toBe(200);
    await vi.waitFor(async () => {
      expect(await prisma.transcriptSegment.count({ where: { sessionId: recording.sessionId } })).toBe(1);
      expect(await prisma.audioChunk.count({ where: { sessionId: recording.sessionId } })).toBe(0);
    });
  });

  it("checks the type, the size and the timing of what is sent", async () => {
    asHost();
    const check = async (res: Response, status: number, key: Parameters<typeof t>[0]) => {
      expect(res.status).toBe(status);
      expect(await errorOf(res)).toBe(t(key));
    };
    await check(await send({ type: "video/mp4" }), 400, "invalidRequestPlain");
    await check(await send({ type: "text/plain" }), 400, "invalidRequestPlain");
    await check(await send({ body: new Uint8Array(0) }), 400, "audioTooLarge");
    await check(await send({ body: new Uint8Array(8_000_001) }), 400, "audioTooLarge");
    await check(await send({ length: "8000001" }), 400, "audioTooLarge");
    await check(await send({ steps: "not json" }), 400, "invalidRequestPlain");
    await check(await send({ start: Date.now(), end: Date.now() - 1000 }), 400, "invalidRequestPlain");
    // Said before the recording was turned on
    await check(await send({ start: Date.now() - 600_000, end: Date.now() - 300_000 }), 400, "notRecording");
    expect(await prisma.audioChunk.count({ where: { sessionId: recording.sessionId } })).toBe(0);
  });

  it("is sent by the person running the session only", async () => {
    const lena = await person(w, "Recorder", { meetingId: recording.meetingId, role: "participant" });
    current = as(w, "member", lena);
    const res = await send();
    expect(res.status).toBe(403);
    expect(await errorOf(res)).toBe(t("hostOnly"));
  });

  it("is refused when the meeting does not allow transcription", async () => {
    await prisma.meeting.update({ where: { id: recording.meetingId }, data: { transcription: false } });
    asHost();
    const res = await send();
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe(t("transcriptionOff"));
  });
});

describe("the video room", () => {
  let room: Fixture;
  const enter = () => video(new Request(`${APP}/x`), meetingParams(room, w.ws.slug));
  beforeAll(async () => {
    room = await meeting(w, "Video");
    await prisma.moduleInstallation.create({
      data: {
        workspaceId: w.ws.id,
        meetingId: room.meetingId,
        moduleId: "video",
        enabled: true,
        config: { provider: "bbb", bbbUrl: "https://bbb.example.org/bigbluebutton", room: "weekly" },
        secret: encryptSecret("bbb-shared-secret"),
      },
    });
  });

  it("brings the hosts in as moderators and the others as viewers", async () => {
    current = host();
    const asHost = await enter();
    expect(asHost.status).toBe(307);
    const hostUrl = new URL(asHost.headers.get("location")!);
    expect(hostUrl.origin + hostUrl.pathname).toBe("https://bbb.example.org/bigbluebutton/api/join");
    expect(hostUrl.searchParams.get("role")).toBe("MODERATOR");
    expect(hostUrl.searchParams.get("meetingID")).toBe("ronde-weekly");
    // The room was opened first
    expect(outbound.some((r) => r.url.startsWith("https://bbb.example.org/bigbluebutton/api/create?"))).toBe(true);

    const guest = await person(w, "Viewer", { meetingId: room.meetingId, role: "participant" });
    current = as(w, "member", guest);
    const asViewer = await enter();
    expect(new URL(asViewer.headers.get("location")!).searchParams.get("role")).toBe("VIEWER");
  });

  it("says the room cannot be reached when BigBlueButton fails", async () => {
    current = host();
    bbbAnswer = "<response><returncode>FAILED</returncode><messageKey>checksumError</messageKey></response>";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await enter();
      expect(res.status).toBe(502);
      expect(await res.text()).toBe(t("videoUnreachable"));
    } finally {
      bbbAnswer = "<response><returncode>SUCCESS</returncode></response>";
      errors.mockRestore();
    }
  });
});

describe("Teams' messaging endpoint", () => {
  const post = (body: string, authorization?: string) =>
    teamsMessages(
      new Request(`${APP}/api/teams/messages`, {
        method: "POST",
        body,
        headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
      }),
    );
  const activity = JSON.stringify({
    type: "message",
    text: "hi",
    serviceUrl: "https://smba.trafficmanager.net/emea/",
    channelId: "msteams",
  });
  /** A token signed with a key Microsoft never published */
  const forged = () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const head = `${b64({ alg: "RS256", kid: "someone-else", typ: "JWT" })}.${b64({ iss: "https://api.botframework.com", aud: "teams-app-id", serviceUrl: "https://smba.trafficmanager.net/emea/" })}`;
    return `Bearer ${head}.${createSign("RSA-SHA256").update(head).sign(privateKey, "base64url")}`;
  };

  it("does not exist while the instance has no Teams app", async () => {
    expect((await post(activity)).status).toBe(404);
  });

  it("refuses a body that is not JSON, and any activity Microsoft did not sign", async () => {
    vi.stubEnv("TEAMS_APP_ID", "teams-app-id");
    vi.stubEnv("TEAMS_APP_PASSWORD", "teams-app-password");
    try {
      expect((await post("{not json", "Bearer x")).status).toBe(400);
      expect((await post(activity)).status).toBe(401);
      expect((await post(activity, "Bearer not-a-token")).status).toBe(401);
      expect((await post(activity, forged())).status).toBe(401);
      // Nothing was sent to Teams on their behalf
      expect(outbound.every((r) => r.url.startsWith("https://login.botframework.com/v1/.well-known/"))).toBe(true);
    } finally {
      vi.stubEnv("TEAMS_APP_ID", "");
      vi.stubEnv("TEAMS_APP_PASSWORD", "");
    }
  });
});

describe("adding Slack", () => {
  beforeAll(() => {
    vi.stubEnv("SLACK_CLIENT_ID", "1.2");
    vi.stubEnv("SLACK_CLIENT_SECRET", "client-secret");
    vi.stubEnv("SLACK_SIGNING_SECRET", "signing-secret");
  });
  const settingsBack = (result: string) => `${APP}/w/${w.ws.slug}/settings?slack=${result}#slack`;

  it("starts only for someone who manages the connectors", async () => {
    const start = () => slackInstall(new NextRequest(`${APP}/api/slack/install?w=${w.ws.slug}`));
    current = member();
    const denied = await start();
    expect(denied.headers.get("location")).toBe(settingsBack("denied"));
    current = host();
    const consent = new URL((await start()).headers.get("location")!);
    expect(consent.origin + consent.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(consent.searchParams.get("state")).toMatch(new RegExp(`^${w.ws.id}\\.${w.user.id}\\.`));
    // A workspace the person is not in
    expect((await slackInstall(new NextRequest(`${APP}/api/slack/install?w=nowhere-${run}`))).status).toBe(404);
  });

  it("finishes only for the administrator who started it", async () => {
    const back = (state: string, code = "slack-code") =>
      slackOauth(new NextRequest(`${APP}/api/slack/oauth?state=${encodeURIComponent(state)}&code=${code}`));
    const state = installState(w.ws.id, w.user.id);
    // Another administrator of the same workspace, handed the link
    const admin = await person(w, "Otheradmin");
    current = as(w, "admin", admin);
    expect((await back(state)).headers.get("location")).toBe(settingsBack("denied"));
    expect(outbound).toEqual([]);
    // A state not signed by Ronde leads nowhere
    expect((await back(`${w.ws.id}.${admin.userId}.${Date.now() + 60_000}.forged`)).headers.get("location")).toBe(`${APP}/`);

    current = host();
    expect((await slackOauth(new NextRequest(`${APP}/api/slack/oauth?state=${encodeURIComponent(state)}`))).headers.get("location")).toBe(
      settingsBack("cancelled"),
    );
    expect((await back(state)).headers.get("location")).toBe(settingsBack("connected"));
    const settings = (await prisma.workspace.findUniqueOrThrow({ where: { id: w.ws.id } })).settings as { slack?: { teamId: string } };
    expect(settings.slack?.teamId).toBe("T-ACME");
  });
});

describe("SCIM", () => {
  let sw: Awaited<ReturnType<typeof workspace>>;
  let token = "";
  const users = () =>
    scim.GET(new Request(`${APP}/api/scim/v2/${sw.ws.slug}/Users`, { headers: { authorization: `Bearer ${token}` } }), {
      params: Promise.resolve({ ws: sw.ws.slug, path: ["Users"] }),
    });
  beforeAll(async () => {
    sw = await workspace(`routes-scim-${run}`);
    await prisma.workspace.update({ where: { id: sw.ws.id }, data: { plan: "enterprise" } });
    const tk = newScimToken();
    await prisma.scimToken.create({ data: { workspaceId: sw.ws.id, name: "Okta", tokenHash: tk.hash, prefix: tk.prefix } });
    token = tk.token;
  });

  it("refuses a suspended workspace's directory with a 403", async () => {
    expect((await users()).status).toBe(200);
    await prisma.workspace.update({ where: { id: sw.ws.id }, data: { suspendedAt: new Date() } });
    try {
      const res = await users();
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ status: "403", detail: "This workspace is suspended" });
    } finally {
      await prisma.workspace.update({ where: { id: sw.ws.id }, data: { suspendedAt: null } });
    }
  });

  it("answers a 500 the directory retries when something unexpected breaks", async () => {
    const handle = vi.spyOn(enterprise.scim, "handle").mockRejectedValueOnce(new Error("deadlock"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await users();
      expect(res.status).toBe(500);
      expect(res.headers.get("content-type")).toBe("application/scim+json; charset=utf-8");
      expect(await res.json()).toEqual({
        schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
        status: "500",
        detail: "The request could not be handled now",
      });
    } finally {
      handle.mockRestore();
      errors.mockRestore();
    }
  });
});
