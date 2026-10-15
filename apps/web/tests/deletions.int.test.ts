import { generateKeyPairSync } from "node:crypto";
import { can, type Permission, type WorkspaceRole } from "@ronde/core/permissions";
import { localDate } from "@ronde/core/schedule";
import { prisma, scoped } from "@ronde/db";
import { translator } from "@ronde/i18n";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext, WorkspaceSettings } from "@/lib/server/authz";
import { type Fixture, meeting, workspace } from "./fixtures";

// What people remove or switch off from the settings, through the server actions they call: refused to a role
// without the permission, and with its effect on the rows tied to it (events left in a calendar, a link that
// stops working, a connector going with its Teams channel). In the cloud, each workspace on its own plan.

let current: WorkspaceContext | null = null;
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  // The messages are read in English, whatever language the instance defaults to (DEFAULT_LOCALE)
  headers: async () => new Headers({ "accept-language": "en" }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
}));
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
    workspaceContext: async (slug: string) => (current?.workspace.slug === slug ? current : null),
    // As the real one: the workspace of the person signed in, and the permission their role gives
    authorize: async (slug: string, permission?: Permission) => {
      await requireUser();
      if (current?.workspace.slug !== slug || (permission && !current.can(permission))) throw new AccessError(403, "accessDenied");
      return current;
    },
  };
});

const actions = await import("@/app/w/[ws]/actions");
const projectActions = await import("@/app/w/[ws]/project-actions");
const accountActions = await import("@/app/account/actions");
const { GET: scimUsers } = await import("@/app/api/scim/v2/[ws]/[[...path]]/route");
const { guestContext } = await import("@/lib/server/guest-links");
const { encryptSecret } = await import("@/lib/server/secrets");
const { newScimToken } = await import("@/lib/server/scim");

const t = translator("en", "errors");
const DENIED = t("accessDenied");
const NOT_IN_PLAN = t("featureNotInPlan");
const NOT_FOUND = t("notFound");
const run = Date.now().toString(36);
const UNKNOWN = "00000000-0000-7000-8000-000000000000";
const PEM = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

/** Requests going out, answered by the fake service each is for */
const outbound: { method: string; url: string; body: string }[] = [];
let hookStatus = 200;
const fakeServices = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
  const url = String(input instanceof Request ? input.url : input);
  const method = init.method ?? "GET";
  outbound.push({ method, url, body: String(init.body ?? "") });
  if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "g" });
  if (url.startsWith("https://www.googleapis.com/calendar/v3/calendars/primary/events/") && method === "DELETE")
    return new Response(null, { status: 204 });
  if (url.startsWith("https://zoom.us/oauth/token")) return Response.json({ access_token: "zt" });
  if (url === "https://api.zoom.us/v2/users/me/meetings") return Response.json({ join_url: "https://zoom.us/j/42", id: 42 });
  if (url === "https://api.stripe.com/v1/billing_portal/sessions") return Response.json({ url: "https://billing.stripe.com/p/session" });
  if (url.startsWith("https://hooks.example.org/")) return new Response("ok", { status: hookStatus });
  // Teams' Bot Connector, told the channel was unlinked: not reachable here, which the unlink tolerates
  throw new Error(`unexpected request to ${url}`);
});

beforeAll(() => {
  vi.stubEnv("RONDE_CLOUD", "1");
  vi.stubEnv("RONDE_ALLOW_PRIVATE_URLS", "1");
  vi.stubEnv("APP_URL", "https://app.example.org");
  vi.stubGlobal("fetch", fakeServices);
});
afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  outbound.length = 0;
});

type Place = Awaited<ReturnType<typeof workspace>>;
/** A workspace on a plan, with one meeting */
async function place(name: string, plan: "community" | "team" | "enterprise"): Promise<Fixture & { w: Place }> {
  const w = await workspace(`del-${name}-${run}`);
  await prisma.workspace.update({ where: { id: w.ws.id }, data: { plan } });
  return { ...(await meeting(w, "Weekly")), w };
}

/** Another person of the workspace with an account, in the meeting with that role (none: not in it) */
async function person(f: Fixture & { w: Place }, name: string, meetingRole?: "host" | "participant" | "observer") {
  const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `${name}-${run}@${f.w.ws.slug}.test`, name } });
  const p = await prisma.person.create({ data: { workspaceId: f.workspaceId, userId: user.id, email: user.email, firstName: name } });
  await prisma.workspaceMember.create({ data: { workspaceId: f.workspaceId, userId: user.id, personId: p.id, role: "member" } });
  if (meetingRole)
    await prisma.meetingParticipant.create({
      data: { workspaceId: f.workspaceId, meetingId: f.meetingId, personId: p.id, role: meetingRole, position: 9 },
    });
  return { id: p.id, userId: user.id };
}

/** Signs in as a person of that workspace role, the workspace as saved now (plan, settings) */
async function signIn(f: Fixture & { w: Place }, role: WorkspaceRole, who = { id: f.hostPersonId, userId: f.w.user.id }) {
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } });
  const principal = { userId: who.userId, personId: who.id, workspaceId: ws.id, workspaceRole: role };
  current = {
    user: {
      id: who.userId,
      name: "Someone",
      email: `${who.userId}@x.test`,
      image: null,
      locale: null,
      timezone: null,
      instanceRole: "user",
    },
    workspace: {
      id: ws.id,
      slug: ws.slug,
      name: ws.name,
      locale: "en",
      timezone: "UTC",
      plan: ws.plan,
      settings: ws.settings as WorkspaceSettings,
    },
    member: { id: f.w.member.id, personId: who.id, role },
    principal,
    db: scoped(prisma, ws.id),
    can: (p: Permission) => can(principal, p),
  };
  return current;
}

const failed = (error: string) => ({ ok: false, error });
const ok = { ok: true };

describe("job categories", () => {
  it("are deleted by the administrators, and the people of one keep their profile without it", async () => {
    const f = await place("jobs", "community");
    const cat = await prisma.jobCategory.create({ data: { workspaceId: f.workspaceId, name: "Design" } });
    await prisma.person.update({ where: { id: f.memberId }, data: { jobCategoryId: cat.id } });
    await signIn(f, "member");
    expect(await actions.deleteJobCategoryAction(f.w.ws.slug, cat.id)).toEqual(failed(DENIED));
    expect(await prisma.jobCategory.count({ where: { id: cat.id } })).toBe(1);
    await signIn(f, "admin");
    expect(await actions.deleteJobCategoryAction(f.w.ws.slug, cat.id)).toMatchObject(ok);
    expect(await prisma.jobCategory.count({ where: { id: cat.id } })).toBe(0);
    expect(await prisma.person.findUniqueOrThrow({ where: { id: f.memberId } })).toMatchObject({ jobCategoryId: null });
    expect(await actions.deleteJobCategoryAction(f.w.ws.slug, cat.id)).toEqual(failed(NOT_FOUND));
  });

  it("of another workspace are out of reach", async () => {
    const f = await place("jobs-a", "community");
    const other = await place("jobs-b", "community");
    const theirs = await prisma.jobCategory.create({ data: { workspaceId: other.workspaceId, name: "Theirs" } });
    await signIn(f, "owner");
    expect(await actions.deleteJobCategoryAction(f.w.ws.slug, theirs.id)).toEqual(failed(NOT_FOUND));
    expect(await prisma.jobCategory.count({ where: { id: theirs.id } })).toBe(1);
  });
});

describe("project themes", () => {
  it("are renamed and deleted by those managing the projects, the projects keeping their place without one", async () => {
    const f = await place("themes", "community");
    const theme = await prisma.projectTheme.create({ data: { workspaceId: f.workspaceId, name: "Growth" } });
    await prisma.projectTheme.create({ data: { workspaceId: f.workspaceId, name: "Platform" } });
    await prisma.project.update({ where: { id: f.projectId }, data: { themeId: theme.id } });

    await signIn(f, "member");
    expect(await projectActions.renameThemeAction(f.w.ws.slug, theme.id, "Revenue")).toEqual(failed(DENIED));
    expect(await projectActions.deleteThemeAction(f.w.ws.slug, theme.id)).toEqual(failed(DENIED));

    await signIn(f, "admin");
    expect(await projectActions.renameThemeAction(f.w.ws.slug, theme.id, "  Platform ")).toEqual(failed(t("themeExists")));
    expect(await projectActions.renameThemeAction(f.w.ws.slug, theme.id, "   ")).toEqual(failed(t("nameRequired")));
    expect(await projectActions.renameThemeAction(f.w.ws.slug, theme.id, " Revenue ")).toMatchObject(ok);
    expect(await prisma.projectTheme.findUniqueOrThrow({ where: { id: theme.id } })).toMatchObject({ name: "Revenue" });
    expect(await projectActions.renameThemeAction(f.w.ws.slug, UNKNOWN, "Ghost")).toEqual(failed(NOT_FOUND));

    expect(await projectActions.deleteThemeAction(f.w.ws.slug, theme.id)).toMatchObject(ok);
    expect(await prisma.projectTheme.count({ where: { id: theme.id } })).toBe(0);
    expect(await prisma.project.findUniqueOrThrow({ where: { id: f.projectId } })).toMatchObject({ themeId: null, archivedAt: null });
    expect(await projectActions.deleteThemeAction(f.w.ws.slug, theme.id)).toEqual(failed(NOT_FOUND));
  });
});

describe("a verified domain", () => {
  it("is removed by the administrators of an Enterprise workspace only, and only its own", async () => {
    const f = await place("domains", "enterprise");
    const other = await place("domains-other", "enterprise");
    const mine = await prisma.workspaceDomain.create({
      data: { workspaceId: f.workspaceId, domain: `mine-${run}.test`, token: "t", verifiedAt: new Date(), capture: true },
    });
    const theirs = await prisma.workspaceDomain.create({
      data: { workspaceId: other.workspaceId, domain: `theirs-${run}.test`, token: "t" },
    });

    await signIn(f, "member");
    expect(await actions.removeDomainAction(f.w.ws.slug, mine.id)).toEqual(failed(DENIED));
    await signIn(f, "owner");
    expect(await actions.removeDomainAction(f.w.ws.slug, theirs.id)).toEqual(failed(NOT_FOUND));
    expect(await prisma.workspaceDomain.count({ where: { id: theirs.id } })).toBe(1);
    expect(await actions.removeDomainAction(f.w.ws.slug, mine.id)).toMatchObject(ok);
    expect(await prisma.workspaceDomain.count({ where: { id: mine.id } })).toBe(0);

    await prisma.workspace.update({ where: { id: f.workspaceId }, data: { plan: "team" } });
    await signIn(f, "owner");
    expect(await actions.removeDomainAction(f.w.ws.slug, UNKNOWN)).toEqual(failed(NOT_IN_PLAN));
  });
});

describe("a SCIM token", () => {
  it("is revoked by the administrators, and the directory holding it is turned away at once", async () => {
    const f = await place("scim", "enterprise");
    const tk = newScimToken();
    const row = await prisma.scimToken.create({
      data: { workspaceId: f.workspaceId, name: "Okta", tokenHash: tk.hash, prefix: tk.prefix },
    });
    const users = () =>
      scimUsers(
        new Request(`https://app.example.org/api/scim/v2/${f.w.ws.slug}/Users`, { headers: { authorization: `Bearer ${tk.token}` } }),
        {
          params: Promise.resolve({ ws: f.w.ws.slug, path: ["Users"] }),
        },
      );
    expect((await users()).status).toBe(200);

    await signIn(f, "member");
    expect(await actions.revokeScimTokenAction(f.w.ws.slug, row.id)).toEqual(failed(DENIED));
    expect((await users()).status).toBe(200);
    await signIn(f, "admin");
    expect(await actions.revokeScimTokenAction(f.w.ws.slug, row.id)).toMatchObject(ok);
    expect((await users()).status).toBe(401);
    expect(await actions.revokeScimTokenAction(f.w.ws.slug, row.id)).toEqual(failed(NOT_FOUND));
  });
});

describe("a calendar account", () => {
  it("is deleted with the coming events it wrote, which leave the organizer's calendar", async () => {
    const f = await place("calendar", "team");
    const account = (organizer: string) =>
      prisma.calendarAccount.create({
        data: {
          workspaceId: f.workspaceId,
          kind: "google",
          name: "Google",
          config: { clientEmail: "sa@acme.iam.gserviceaccount.com", organizer },
          secret: encryptSecret(PEM),
        },
      });
    const gone = await account("rooms@acme.test");
    const kept = await account("other@acme.test");
    await prisma.meeting.update({ where: { id: f.meetingId }, data: { calendarAccountId: gone.id } });
    const event = (accountId: string, key: string, at: number) =>
      prisma.calendarEvent.create({
        data: {
          workspaceId: f.workspaceId,
          meetingId: f.meetingId,
          accountId,
          occurrenceKey: `${f.ruleId}:${key}`,
          eventId: `ev-${key}`,
          hash: "h",
          startsAt: new Date(at),
          endsAt: new Date(at + 1_800_000),
        },
      });
    await event(gone.id, "past", Date.now() - 7 * 86_400_000);
    await event(gone.id, "next", Date.now() + 7 * 86_400_000);
    await event(gone.id, "later", Date.now() + 14 * 86_400_000);
    const other = await event(kept.id, "other", Date.now() + 21 * 86_400_000);

    await signIn(f, "member");
    expect(await actions.deleteCalendarAccountAction(f.w.ws.slug, gone.id)).toEqual(failed(DENIED));
    expect(outbound).toEqual([]);

    await signIn(f, "admin");
    expect(await actions.deleteCalendarAccountAction(f.w.ws.slug, gone.id)).toMatchObject(ok);
    // The coming ones were removed from the calendar; the past one is history there, forgotten here only
    const removed = outbound.filter((r) => r.method === "DELETE").map((r) => new URL(r.url).pathname.split("/").pop());
    expect(removed.sort()).toEqual(["ev-later", "ev-next"]);
    expect(await prisma.calendarAccount.count({ where: { id: gone.id } })).toBe(0);
    expect((await prisma.calendarEvent.findMany({ where: { meetingId: f.meetingId } })).map((e) => e.id)).toEqual([other.id]);
    expect(await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } })).toMatchObject({ calendarAccountId: null });
  });
});

describe("a video account", () => {
  it("is deleted by those managing the connectors, the rooms already made keeping their link", async () => {
    const f = await place("video", "team");
    const zoom = await prisma.videoAccount.create({
      data: {
        workspaceId: f.workspaceId,
        kind: "zoom",
        name: "Zoom",
        config: { accountId: "acc", clientId: "cid" },
        secret: encryptSecret("zs"),
      },
    });
    await signIn(f, "owner");
    expect(await actions.createVideoRoomAction(f.w.ws.slug, f.meetingId, zoom.id)).toEqual({ ok: true, data: "https://zoom.us/j/42" });

    await signIn(f, "member");
    expect(await actions.deleteVideoAccountAction(f.w.ws.slug, zoom.id)).toEqual(failed(DENIED));
    await signIn(f, "admin");
    expect(await actions.deleteVideoAccountAction(f.w.ws.slug, zoom.id)).toMatchObject(ok);
    expect(await prisma.videoAccount.count({ where: { id: zoom.id } })).toBe(0);
    expect(await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } })).toMatchObject({ videoUrl: "https://zoom.us/j/42" });
    expect(await actions.createVideoRoomAction(f.w.ws.slug, f.meetingId, zoom.id)).toEqual(failed(NOT_FOUND));
  });
});

describe("a video room for a meeting", () => {
  it("is made only by someone configuring that meeting, on a plan with video links", async () => {
    const f = await place("room", "team");
    const zoom = await prisma.videoAccount.create({
      data: {
        workspaceId: f.workspaceId,
        kind: "zoom",
        name: "Zoom",
        config: { accountId: "acc", clientId: "cid" },
        secret: encryptSecret("zs"),
      },
    });
    await signIn(f, "member", await person(f, "Pia", "participant"));
    expect(await actions.createVideoRoomAction(f.w.ws.slug, f.meetingId, zoom.id)).toEqual(failed(DENIED));
    // Someone of the workspace outside the meeting: it does not exist for them
    await signIn(f, "member", await person(f, "Omar"));
    expect(await actions.createVideoRoomAction(f.w.ws.slug, f.meetingId, zoom.id)).toEqual(failed(DENIED));
    expect(outbound).toEqual([]);
    expect(await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } })).toMatchObject({ videoUrl: "" });

    await signIn(f, "member", await person(f, "Hugo", "host"));
    expect(await actions.createVideoRoomAction(f.w.ws.slug, f.meetingId, zoom.id)).toEqual({ ok: true, data: "https://zoom.us/j/42" });
    await prisma.workspace.update({ where: { id: f.workspaceId }, data: { plan: "community" } });
    await signIn(f, "owner");
    expect(await actions.createVideoRoomAction(f.w.ws.slug, f.meetingId, zoom.id)).toEqual(failed(NOT_IN_PLAN));
  });
});

describe("a push device", () => {
  it("is removed from one's own account only", async () => {
    const f = await place("push", "community");
    const other = await person(f, "Nadia");
    const device = (userId: string, n: number) =>
      prisma.pushSubscription.create({
        data: { userId, endpoint: `https://fcm.googleapis.com/fcm/send/${run}-${n}`, p256dh: "p".repeat(30), auth: "a".repeat(22) },
      });
    const mine = await device(f.w.user.id, 1);
    const theirs = await device(other.userId, 2);
    await signIn(f, "owner");
    // Someone else's device: nothing happens, and nothing tells whether it exists
    expect(await accountActions.removePushDeviceAction(theirs.id)).toMatchObject(ok);
    expect(await prisma.pushSubscription.count({ where: { id: theirs.id } })).toBe(1);
    expect(await accountActions.removePushDeviceAction(mine.id)).toMatchObject(ok);
    expect(await prisma.pushSubscription.count({ where: { id: mine.id } })).toBe(0);
    current = null;
    expect(await accountActions.removePushDeviceAction(theirs.id)).toEqual(failed(t("signInRequired")));
  });
});

describe("a Teams channel", () => {
  const linked = async (f: Fixture & { w: Place }) => {
    const connector = await prisma.connector.create({ data: { workspaceId: f.workspaceId, kind: "teams", name: "Teams · Acme" } });
    const rule = await prisma.notificationRule.create({
      data: { workspaceId: f.workspaceId, meetingId: f.meetingId, connectorId: connector.id, event: "minutes_published" },
    });
    const teams = {
      tenantId: "tenant",
      teamId: "team",
      teamName: "Acme",
      serviceUrl: "https://smba.trafficmanager.net/emea/",
      channelId: "19:channel",
      channelName: "General",
      connectorId: connector.id,
      reminders: true,
      linkedAt: new Date().toISOString(),
      linkedById: f.w.user.id,
    };
    await prisma.workspace.update({ where: { id: f.workspaceId }, data: { settings: { teams, reportTo: "kept" } } });
    return { connector, rule };
  };
  const settingsOf = async (id: string) =>
    (await prisma.workspace.findUniqueOrThrow({ where: { id } })).settings as WorkspaceSettings & { reportTo?: string };

  it("has its reminders turned off and on by those managing the connectors", async () => {
    const f = await place("teams-reminders", "team");
    await linked(f);
    await signIn(f, "member");
    expect(await actions.setTeamsRemindersAction(f.w.ws.slug, false)).toEqual(failed(DENIED));
    expect((await settingsOf(f.workspaceId)).teams?.reminders).toBe(true);
    await signIn(f, "admin");
    expect(await actions.setTeamsRemindersAction(f.w.ws.slug, false)).toMatchObject(ok);
    expect((await settingsOf(f.workspaceId)).teams).toMatchObject({ reminders: false, channelId: "19:channel" });
    expect((await settingsOf(f.workspaceId)).reportTo).toBe("kept");
  });

  it("is unlinked with its connector and the notifications sent through it, the other settings kept", async () => {
    const f = await place("teams-unlink", "team");
    const { connector, rule } = await linked(f);
    await signIn(f, "member");
    expect(await actions.unlinkTeamsAction(f.w.ws.slug)).toEqual(failed(DENIED));
    expect(await prisma.connector.count({ where: { id: connector.id } })).toBe(1);

    await signIn(f, "owner");
    expect(await actions.unlinkTeamsAction(f.w.ws.slug)).toMatchObject(ok);
    const settings = await settingsOf(f.workspaceId);
    expect(settings.teams).toBeUndefined();
    expect(settings.reportTo).toBe("kept");
    expect(await prisma.connector.count({ where: { id: connector.id } })).toBe(0);
    expect(await prisma.notificationRule.count({ where: { id: rule.id } })).toBe(0);
    // Nothing linked any more: unlinking again changes nothing, turning reminders on says so
    await signIn(f, "owner");
    expect(await actions.unlinkTeamsAction(f.w.ws.slug)).toMatchObject(ok);
    expect(await actions.setTeamsRemindersAction(f.w.ws.slug, true)).toEqual(failed(NOT_FOUND));
  });
});

describe("the billing portal", () => {
  let f: Fixture & { w: Place };
  beforeAll(async () => {
    f = await place("billing", "team");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_int");
    vi.stubEnv("STRIPE_PRICE_TEAM", "price_team");
  });
  afterAll(() => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    vi.stubEnv("STRIPE_PRICE_TEAM", "");
  });

  it("opens for the owner and the person in charge of billing, on the workspace's own Stripe customer", async () => {
    await prisma.subscription.create({
      data: { workspaceId: f.workspaceId, customerId: "cus_42", subscriptionId: "sub_42", status: "active", plan: "team", seats: 2 },
    });
    await signIn(f, "owner");
    expect(await actions.billingPortalAction(f.w.ws.slug)).toEqual({ ok: true, data: "https://billing.stripe.com/p/session" });
    const form = new URLSearchParams(outbound.find((r) => r.url.endsWith("/billing_portal/sessions"))!.body);
    expect(form.get("customer")).toBe("cus_42");
    expect(form.get("return_url")).toBe(`https://app.example.org/w/${f.w.ws.slug}/settings/billing`);
    await signIn(f, "billing");
    expect(await actions.billingPortalAction(f.w.ws.slug)).toMatchObject(ok);
  });

  it("is refused to an administrator, who does not handle the money", async () => {
    await signIn(f, "admin");
    expect(await actions.billingPortalAction(f.w.ws.slug)).toEqual(failed(DENIED));
    expect(outbound).toEqual([]);
  });

  it("has nothing to open without a subscription, nor where billing is not set up", async () => {
    const free = await place("billing-free", "community");
    await signIn(free, "owner");
    expect(await actions.billingPortalAction(free.w.ws.slug)).toEqual(failed(NOT_FOUND));
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    try {
      await signIn(f, "owner");
      expect(await actions.billingPortalAction(f.w.ws.slug)).toEqual(failed(NOT_IN_PLAN));
    } finally {
      vi.stubEnv("STRIPE_SECRET_KEY", "sk_test");
    }
    expect(outbound).toEqual([]);
  });
});

describe("testing a connector", () => {
  it("sends a test through it for those managing the connectors, and says what the service answered", async () => {
    const f = await place("connector", "community");
    await signIn(f, "member");
    expect(await actions.testConnectorAction(f.w.ws.slug, f.connectorId)).toEqual(failed(DENIED));
    expect(outbound).toEqual([]);

    await signIn(f, "admin");
    expect(await actions.testConnectorAction(f.w.ws.slug, f.connectorId)).toMatchObject(ok);
    expect(outbound.map((r) => [r.method, r.url])).toEqual([["POST", "https://hooks.example.org/ronde"]]);
    expect(JSON.parse(outbound[0]!.body)).toMatchObject({ event: "test" });

    hookStatus = 500;
    try {
      expect(await actions.testConnectorAction(f.w.ws.slug, f.connectorId)).toEqual(
        failed(t("connectorRefused", { host: "hooks.example.org", status: 500 })),
      );
    } finally {
      hookStatus = 200;
    }
    expect(await actions.testConnectorAction(f.w.ws.slug, UNKNOWN)).toEqual(failed(NOT_FOUND));
  });
});

describe("an LDAP directory in the cloud", () => {
  const input = (url: string) => ({
    url,
    startTls: false,
    bindDn: "cn=ronde,dc=acme,dc=test",
    bindPassword: "secret",
    baseDn: "dc=acme,dc=test",
    userFilter: "(mail={{email}})",
    emailAttribute: "mail",
    nameAttribute: "cn",
    phoneAttribute: "",
    teamAttribute: "",
    birthdayAttribute: "",
    enabled: true,
  });
  let f: Fixture & { w: Place };
  beforeAll(async () => {
    f = await place("ldap", "enterprise");
  });
  // The guard on private networks is on, as in the cloud
  beforeEach(() => vi.stubEnv("RONDE_ALLOW_PRIVATE_URLS", "0"));
  afterAll(() => vi.stubEnv("RONDE_ALLOW_PRIVATE_URLS", "1"));

  it("is never saved on the server's own network", async () => {
    await signIn(f, "owner");
    for (const url of ["ldaps://10.0.0.5:636", "ldap://192.168.1.4", "ldaps://127.0.0.1", "ldaps://localhost:636", "ldaps://[::1]:636"])
      expect(await actions.saveLdapAction(f.w.ws.slug, input(url)), url).toEqual(failed(t("ldapUrlInvalid")));
    expect(await prisma.ldapDirectory.count({ where: { workspaceId: f.workspaceId } })).toBe(0);
    // A public address is taken (no connection is made to save it)
    expect(await actions.saveLdapAction(f.w.ws.slug, input("ldaps://93.184.216.34:636"))).toMatchObject(ok);
    expect(await prisma.ldapDirectory.findUniqueOrThrow({ where: { workspaceId: f.workspaceId } })).toMatchObject({
      url: "ldaps://93.184.216.34:636",
    });
  });

  it("is saved and tested by the administrators only", async () => {
    await signIn(f, "member");
    expect(await actions.saveLdapAction(f.w.ws.slug, input("ldaps://93.184.216.34"))).toEqual(failed(DENIED));
    expect(await actions.testLdapAction(f.w.ws.slug, "ines@acme.test")).toEqual(failed(DENIED));
  });

  it("saved before on a private address is not probed by the test", async () => {
    await prisma.ldapDirectory.update({ where: { workspaceId: f.workspaceId }, data: { url: "ldaps://10.0.0.5:636" } });
    await signIn(f, "owner");
    expect(await actions.testLdapAction(f.w.ws.slug, "ines@acme.test")).toEqual(failed(t("ldapUrlInvalid")));
    await prisma.ldapDirectory.deleteMany({ where: { workspaceId: f.workspaceId } });
    expect(await actions.testLdapAction(f.w.ws.slug, "ines@acme.test")).toEqual(failed(NOT_FOUND));
  });
});

describe("guest links", () => {
  it("are listed, made and revoked by those managing the meeting's people, and a revoked one stops working", async () => {
    const f = await place("guests", "community");
    const slug = f.w.ws.slug;
    for (const who of [await person(f, "Paul", "participant"), await person(f, "Cyril", "observer"), await person(f, "Zoe")]) {
      await signIn(f, "member", who);
      expect(await actions.listGuestLinksAction(slug, f.meetingId)).toEqual(failed(DENIED));
      expect(await actions.createGuestLinkAction(slug, f.meetingId, { label: "Client", days: 7 })).toEqual(failed(DENIED));
    }
    expect(await prisma.guestLink.count({ where: { meetingId: f.meetingId } })).toBe(0);

    // A member of the workspace hosting the meeting manages its guests
    await signIn(f, "member", await person(f, "Hana", "host"));
    const made = await actions.createGuestLinkAction(slug, f.meetingId, { label: "Client", days: 7 });
    expect(made).toMatchObject({ ok: true, data: { url: expect.stringMatching(/^https:\/\/app\.example\.org\/g\/g_[\w-]{32}$/) } });
    const { id, url } = (made as { data: { id: string; url: string } }).data;
    const token = url.slice(url.lastIndexOf("/") + 1);
    expect(await guestContext(token)).not.toBeNull();
    expect(await actions.listGuestLinksAction(slug, f.meetingId)).toMatchObject({
      ok: true,
      data: [{ id, label: "Client", expired: false }],
    });
    expect(await actions.createGuestLinkAction(slug, f.meetingId, { label: "Too long", days: 91 })).toEqual(
      failed(t("invalidRequest", { details: "days" })),
    );

    await signIn(f, "member", await person(f, "Ravi", "participant"));
    expect(await actions.revokeGuestLinkAction(slug, f.meetingId, id)).toEqual(failed(DENIED));
    expect(await guestContext(token)).not.toBeNull();

    await signIn(f, "owner");
    expect(await actions.revokeGuestLinkAction(slug, f.meetingId, id)).toMatchObject(ok);
    expect(await guestContext(token)).toBeNull();
    expect(await actions.listGuestLinksAction(slug, f.meetingId)).toEqual({ ok: true, data: [] });
    expect(await actions.revokeGuestLinkAction(slug, f.meetingId, id)).toEqual(failed(NOT_FOUND));
  });
});

describe("an action's status from the list of actions", () => {
  it("moves one's own actions in a meeting one takes part in, and nothing else", async () => {
    const f = await place("actions", "community");
    const other = await place("actions-other", "community");
    const pia = await person(f, "Pia", "participant");
    const own = await prisma.action.create({ data: { workspaceId: f.workspaceId, meetingId: f.meetingId, text: "Mine", ownerId: pia.id } });
    await signIn(f, "member", pia);

    expect(await actions.updateActionAction(f.w.ws.slug, own.id, { status: "done" })).toMatchObject(ok);
    expect(await prisma.action.findUniqueOrThrow({ where: { id: own.id } })).toMatchObject({ status: "done", doneAt: expect.any(Date) });
    expect(await actions.updateActionAction(f.w.ws.slug, own.id, { status: "open" })).toMatchObject(ok);
    expect(await prisma.action.findUniqueOrThrow({ where: { id: own.id } })).toMatchObject({ status: "open", doneAt: null });
    // Someone else's action in the same meeting
    expect(await actions.updateActionAction(f.w.ws.slug, f.actionId, { status: "done" })).toEqual(failed(t("ownActionsOnly")));
    // An action of another workspace, named by its id
    expect(await actions.updateActionAction(f.w.ws.slug, other.actionId, { status: "done" })).toEqual(failed(DENIED));
    expect(await prisma.action.findUniqueOrThrow({ where: { id: other.actionId } })).toMatchObject({ status: "open" });

    // The owner of an action who is not in its meeting any more
    await prisma.meetingParticipant.deleteMany({ where: { meetingId: f.meetingId, personId: pia.id } });
    expect(await actions.updateActionAction(f.w.ws.slug, own.id, { status: "done" })).toEqual(failed(DENIED));
    expect(await prisma.action.findUniqueOrThrow({ where: { id: own.id } })).toMatchObject({ status: "open" });

    // The host moves anyone's
    await signIn(f, "owner");
    expect(await actions.updateActionAction(f.w.ws.slug, f.actionId, { status: "doing" })).toMatchObject(ok);
    expect(await prisma.action.findUniqueOrThrow({ where: { id: f.actionId } })).toMatchObject({ status: "doing" });
  });

  it("adds an action to one's own list and says where it stands, in a meeting one takes part in", async () => {
    const f = await place("own-actions", "community");
    const other = await place("own-actions-other", "community");
    const pia = await person(f, "Pia", "participant");
    await signIn(f, "member", pia);
    // The session of the fixture, in 2030, not started yet
    await prisma.session.updateMany({ where: { meetingId: f.meetingId }, data: { startedAt: null } });

    expect(await actions.addOwnActionAction(f.w.ws.slug, f.meetingId, "  Chase the supplier ")).toMatchObject(ok);
    const own = await prisma.action.findFirstOrThrow({ where: { meetingId: f.meetingId, ownerId: pia.id } });
    expect(own).toMatchObject({ text: "Chase the supplier", status: "open" });
    // Decided today, not on the date of a session still to come (no time zone is ahead of Kiritimati)
    expect(own.originDate! <= localDate(Date.now(), "Pacific/Kiritimati")).toBe(true);
    expect(await actions.updateActionAction(f.w.ws.slug, own.id, { progress: "Sent a reminder" })).toMatchObject(ok);
    expect(await prisma.action.findUniqueOrThrow({ where: { id: own.id } })).toMatchObject({ progress: "Sent a reminder" });
    // Someone else's action, a meeting of another workspace
    expect(await actions.updateActionAction(f.w.ws.slug, f.actionId, { progress: "Not mine" })).toEqual(failed(t("ownActionsOnly")));
    expect(await actions.addOwnActionAction(f.w.ws.slug, other.meetingId, "Elsewhere")).toEqual(failed(DENIED));
    expect(await actions.addOwnActionAction(f.w.ws.slug, f.meetingId, " ")).toMatchObject({ ok: false });
    // No session under way: still dated, so it is counted as carried over the next ones
    await prisma.session.updateMany({ where: { meetingId: f.meetingId }, data: { status: "archived" } });
    expect(await actions.addOwnActionAction(f.w.ws.slug, f.meetingId, "Between sessions")).toMatchObject(ok);
    const between = await prisma.action.findFirstOrThrow({ where: { text: "Between sessions" } });
    expect(between).toMatchObject({ originDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), projectId: null });
  });
});
