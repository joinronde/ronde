import { createHmac } from "node:crypto";
import { prisma } from "@ronde/db";
import { translator } from "@ronde/i18n";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { type Fixture, meeting, workspace } from "./fixtures";

// The real access layer, signed in the way a browser is: a Better Auth session row and its signed cookie.
// Nothing here mocks authorize(), requireUser(), workspaceContext() or requireMeeting(): who gets in and who
// is refused is decided by the code that runs in production.

let request: Record<string, string> = {};
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(request),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
}));

const { env } = await import("@/lib/server/env");
const { authorize, requireUser, workspaceContext, currentUser } = await import("@/lib/server/authz");
const { meetingContext, requireMeeting } = await import("@/lib/server/meeting/context");
const actions = await import("@/app/w/[ws]/actions");
const projectActions = await import("@/app/w/[ws]/project-actions");
const routes = {
  audit: await import("@/app/api/w/[ws]/audit/route"),
  search: await import("@/app/api/w/[ws]/search/route"),
  actionsExport: await import("@/app/api/w/[ws]/actions/export/route"),
  decisionsExport: await import("@/app/api/w/[ws]/decisions/export/route"),
  projectsExport: await import("@/app/api/w/[ws]/projects/export/route"),
  inbox: await import("@/app/api/w/[ws]/inbox/route"),
  avatar: await import("@/app/api/w/[ws]/avatar/[id]/route"),
  logo: await import("@/app/api/w/[ws]/logo/route"),
  projectLogo: await import("@/app/api/w/[ws]/projects/[id]/logo/route"),
};
const meetingRoutes = {
  people: await import("@/app/api/w/[ws]/m/[meeting]/people/route"),
  history: await import("@/app/api/w/[ws]/m/[meeting]/history/route"),
  historyMine: await import("@/app/api/w/[ws]/m/[meeting]/history/mine/route"),
  draft: await import("@/app/api/w/[ws]/m/[meeting]/draft/route"),
  stats: await import("@/app/api/w/[ws]/m/[meeting]/stats/route"),
  transcript: await import("@/app/api/w/[ws]/m/[meeting]/transcript/route"),
  decisions: await import("@/app/api/w/[ws]/m/[meeting]/decisions/route"),
  github: await import("@/app/api/w/[ws]/m/[meeting]/github/route"),
  gitlabProjects: await import("@/app/api/w/[ws]/m/[meeting]/gitlab/projects/route"),
};

const t = translator("en", "errors");
const refused = (key: Parameters<typeof t>[0]) => ({ ok: false, error: t(key) });

/** Opens a real session for the user: the row Better Auth reads, and the cookie it signs */
async function signIn(userId: string | null) {
  request = { "accept-language": "en" };
  if (!userId) return;
  const token = crypto.randomUUID().replaceAll("-", "");
  await prisma.authSession.create({ data: { id: crypto.randomUUID(), token, userId, expiresAt: new Date(Date.now() + 86_400_000) } });
  const signature = createHmac("sha256", env.authSecret()).update(token).digest("base64");
  request.cookie = `ronde.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

type Route = (req: Request, ctx: { params: Promise<never> }) => Promise<Response>;
/** Calls a route handler as Next does, and reads its status and error message */
async function call(handler: Route, params: Record<string, string>, init?: RequestInit, query = "") {
  const res = await handler(new Request(`http://localhost:3000/api/x${query}`, init), {
    params: Promise.resolve(params) as Promise<never>,
  });
  const body = res.status >= 400 ? await res.text() : "";
  return { status: res.status, error: body ? (JSON.parse(body) as { error?: string }).error : undefined };
}
const denied = { status: 403, error: t("accessDenied") };
const signedOut = { status: 401, error: t("signInRequired") };

const run = Date.now().toString(36);
let n = 0;
let w: Awaited<ReturnType<typeof workspace>>;
/** Meeting A: the member below takes part in it. Meeting B: same workspace, without them */
let a: Fixture;
let b: Fixture;
let other: Awaited<ReturnType<typeof workspace>>;
const people: Record<"admin" | "member" | "guest", { userId: string; personId: string }> = {} as never;

async function seat(role: "admin" | "member" | "guest", personId?: string) {
  const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `${role}-${run}-${++n}@authz.test`, name: role } });
  const person = personId
    ? await prisma.person.update({ where: { id: personId }, data: { userId: user.id, email: user.email } })
    : await prisma.person.create({ data: { workspaceId: w.ws.id, userId: user.id, email: user.email, firstName: role } });
  await prisma.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: user.id, personId: person.id, role } });
  return { userId: user.id, personId: person.id };
}

beforeAll(async () => {
  w = await workspace(`authz-${run}`);
  a = await meeting(w, "Meeting A");
  b = await meeting(w, "Meeting B");
  people.admin = await seat("admin");
  people.member = await seat("member", a.memberId);
  people.guest = await seat("guest");
  other = await workspace(`authz-other-${run}`);
});
afterEach(() => vi.unstubAllEnvs());

describe("the signed-in user", () => {
  it("comes from a valid session cookie, and nobody is signed in without one", async () => {
    await signIn(null);
    expect(await currentUser()).toBeNull();
    await expect(requireUser()).rejects.toMatchObject({ status: 401, key: "signInRequired" });
    await signIn(w.user.id);
    expect(await requireUser()).toMatchObject({ id: w.user.id, email: w.user.email, instanceRole: "user" });
  });

  it("is nobody when the cookie's signature was tampered with", async () => {
    await signIn(w.user.id);
    request.cookie = request.cookie!.replace(/\.[^.]+$/, `.${encodeURIComponent("AAAA")}`);
    await expect(requireUser()).rejects.toMatchObject({ status: 401, key: "signInRequired" });
  });

  it("is nobody once the session has expired", async () => {
    await signIn(w.user.id);
    await prisma.authSession.updateMany({ where: { userId: w.user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(requireUser()).rejects.toMatchObject({ status: 401, key: "signInRequired" });
  });

  it("is nobody while the account is disabled, whatever session it still holds", async () => {
    const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `off-${run}@authz.test`, name: "Off" } });
    await signIn(user.id);
    expect(await currentUser()).toMatchObject({ id: user.id });
    await prisma.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
    expect(await currentUser()).toBeNull();
  });

  it("is vouched for by a trusted proxy's header on a self-hosted server, never in the cloud", async () => {
    vi.stubEnv("AUTH_TRUSTED_EMAIL_HEADER", "X-Forwarded-Email");
    await signIn(null);
    request["x-forwarded-email"] = w.user.email;
    expect(await currentUser()).toMatchObject({ id: w.user.id });
    vi.stubEnv("RONDE_CLOUD", "1");
    expect(await currentUser()).toBeNull();
  });
});

describe("authorize", () => {
  it("lets each role do what it holds, and refuses the rest with a 403", async () => {
    await signIn(w.user.id);
    expect((await authorize(w.ws.slug, "workspace.delete")).member.role).toBe("owner");
    await signIn(people.admin.userId);
    expect((await authorize(w.ws.slug, "members.manage")).member.role).toBe("admin");
    await expect(authorize(w.ws.slug, "workspace.delete")).rejects.toMatchObject({ status: 403, key: "accessDenied" });
    await signIn(people.member.userId);
    expect((await authorize(w.ws.slug, "people.read")).member.personId).toBe(a.memberId);
    await expect(authorize(w.ws.slug, "people.invite")).rejects.toMatchObject({ status: 403, key: "accessDenied" });
    await signIn(people.guest.userId);
    expect((await authorize(w.ws.slug)).member.role).toBe("guest");
    await expect(authorize(w.ws.slug, "people.read")).rejects.toMatchObject({ status: 403, key: "accessDenied" });
  });

  it("refuses someone from another workspace, and a 401 comes before anything when signed out", async () => {
    await signIn(other.user.id);
    expect(await workspaceContext(w.ws.slug)).toBeNull();
    await expect(authorize(w.ws.slug)).rejects.toMatchObject({ status: 403, key: "accessDenied" });
    await signIn(null);
    await expect(authorize(w.ws.slug)).rejects.toMatchObject({ status: 401, key: "signInRequired" });
  });

  it("refuses a member whose seat is suspended", async () => {
    const seatOf = await seat("member");
    await signIn(seatOf.userId);
    expect(await workspaceContext(w.ws.slug)).not.toBeNull();
    await prisma.workspaceMember.update({ where: { personId: seatOf.personId }, data: { status: "suspended" } });
    await expect(authorize(w.ws.slug)).rejects.toMatchObject({ status: 403, key: "accessDenied" });
  });
});

describe("workspace actions", () => {
  it("are refused to a member: inviting, changing roles, deleting the workspace, saving connectors, creating roles", async () => {
    await signIn(people.member.userId);
    expect(await actions.inviteAction(w.ws.slug, { firstName: "Nina", email: `nina-${run}@authz.test`, role: "member" })).toEqual(
      refused("accessDenied"),
    );
    expect(await actions.changeRoleAction(w.ws.slug, a.memberId, "admin")).toEqual(refused("accessDenied"));
    expect(await actions.deleteWorkspaceAction(w.ws.slug, w.ws.slug)).toEqual(refused("accessDenied"));
    expect(
      await actions.saveConnectorAction(w.ws.slug, { kind: "webhook", name: "Mine", config: { url: "https://hooks.example.org/x" } }),
    ).toEqual(refused("accessDenied"));
    expect(await actions.saveRoleAction(w.ws.slug, { name: "Boss", description: "", permissions: [] })).toEqual(refused("accessDenied"));
    expect(await actions.addJobCategoryAction(w.ws.slug, "Sales")).toEqual(refused("accessDenied"));
    // Nothing was written
    expect(await prisma.invitation.count({ where: { workspaceId: w.ws.id } })).toBe(0);
    expect(await prisma.workspaceMember.findUniqueOrThrow({ where: { personId: a.memberId } })).toMatchObject({ role: "member" });
    expect(await prisma.workspace.findUniqueOrThrow({ where: { id: w.ws.id } })).toMatchObject({ deletedAt: null });
    expect(await prisma.connector.count({ where: { workspaceId: w.ws.id, name: "Mine" } })).toBe(0);
    expect(await prisma.customRole.count({ where: { workspaceId: w.ws.id } })).toBe(0);
  });

  it("are refused to a member on the portfolio's management, and to a guest on creating projects", async () => {
    await signIn(people.member.userId);
    expect(await projectActions.deleteProjectAction(w.ws.slug, a.projectId)).toEqual(refused("accessDenied"));
    expect(await projectActions.addThemeAction(w.ws.slug, "Growth")).toEqual(refused("accessDenied"));
    await signIn(people.guest.userId);
    expect(await projectActions.createProjectAction(w.ws.slug, { name: "Guest project" } as never)).toEqual(refused("accessDenied"));
    expect(await prisma.project.count({ where: { id: a.projectId } })).toBe(1);
    expect(await prisma.project.count({ where: { workspaceId: w.ws.id, name: "Guest project" } })).toBe(0);
  });

  it("leave deleting the workspace to its owner, not its administrators", async () => {
    await signIn(people.admin.userId);
    expect(await actions.deleteWorkspaceAction(w.ws.slug, w.ws.slug)).toEqual(refused("accessDenied"));
    // The owner gets past the permission, to the confirmation
    await signIn(w.user.id);
    expect(await actions.deleteWorkspaceAction(w.ws.slug, "not-the-slug")).toEqual(refused("confirmationMismatch"));
  });

  it("are refused to someone of another workspace, and to someone signed out", async () => {
    await signIn(other.user.id);
    expect(await actions.addPersonAction(w.ws.slug, { firstName: "Intruder", email: `intruder-${run}@authz.test` })).toEqual(
      refused("accessDenied"),
    );
    expect(await actions.leaveWorkspaceAction(w.ws.slug)).toEqual(refused("accessDenied"));
    await signIn(null);
    expect(await actions.addPersonAction(w.ws.slug, { firstName: "Intruder", email: `intruder-${run}@authz.test` })).toEqual(
      refused("signInRequired"),
    );
    expect(await prisma.person.count({ where: { workspaceId: w.ws.id, firstName: "Intruder" } })).toBe(0);
  });
});

describe("workspace routes", () => {
  const ws = () => ({ ws: w.ws.slug });
  const reads = (): [string, Route, Record<string, string>, RequestInit?][] => [
    ["audit", routes.audit.GET, ws()],
    ["search", routes.search.GET, ws()],
    ["actions export", routes.actionsExport.GET, ws()],
    ["decisions export", routes.decisionsExport.GET, ws()],
    ["projects export", routes.projectsExport.GET, ws()],
    ["inbox", routes.inbox.GET, ws()],
    ["inbox read", routes.inbox.POST, ws(), { method: "POST", body: "{}" }],
    ["avatar", routes.avatar.GET, { ...ws(), id: a.hostPersonId }],
    ["avatar upload", routes.avatar.PUT, { ...ws(), id: a.hostPersonId }, { method: "PUT", body: "x" }],
    ["avatar removal", routes.avatar.DELETE, { ...ws(), id: a.hostPersonId }, { method: "DELETE" }],
    ["logo upload", routes.logo.PUT, ws(), { method: "PUT", body: "x" }],
    ["logo removal", routes.logo.DELETE, ws(), { method: "DELETE" }],
    ["project logo", routes.projectLogo.GET, { ...ws(), id: a.projectId }],
  ];

  it("answer the workspace's people", async () => {
    await signIn(w.user.id);
    expect(await call(routes.search.GET, ws(), undefined, "?q=Meeting")).toMatchObject({ status: 200 });
    expect(await call(routes.inbox.GET, ws())).toMatchObject({ status: 200 });
    expect(await call(routes.actionsExport.GET, ws())).toMatchObject({ status: 200 });
  });

  it("refuse someone of another workspace, every one of them", async () => {
    await signIn(other.user.id);
    for (const [name, handler, params, init] of reads())
      expect({ name, ...(await call(handler, params, init)) }).toEqual({ name, ...denied });
  });

  it("answer 401 to someone signed out, every one of them", async () => {
    await signIn(null);
    for (const [name, handler, params, init] of reads())
      expect({ name, ...(await call(handler, params, init)) }).toEqual({ name, ...signedOut });
  });

  it("refuse a member the audit log and the workspace's logo", async () => {
    await signIn(people.member.userId);
    expect(await call(routes.audit.GET, ws())).toEqual(denied);
    expect(await call(routes.logo.DELETE, ws(), { method: "DELETE" })).toEqual(denied);
  });
});

describe("a suspended workspace", () => {
  it("is out of reach of its own owner, actions and routes alike", async () => {
    const s = await workspace(`authz-suspended-${run}`);
    await signIn(s.user.id);
    expect(await call(routes.search.GET, { ws: s.ws.slug })).toMatchObject({ status: 200 });
    await prisma.workspace.update({ where: { id: s.ws.id }, data: { suspendedAt: new Date() } });
    expect(await workspaceContext(s.ws.slug)).toBeNull();
    expect(await call(routes.search.GET, { ws: s.ws.slug })).toEqual(denied);
    expect(await actions.addJobCategoryAction(s.ws.slug, "Sales")).toEqual(refused("accessDenied"));
    expect(await prisma.jobCategory.count({ where: { workspaceId: s.ws.id } })).toBe(0);
  });
});

describe("meetings", () => {
  const at = (f: Fixture) => ({ ws: w.ws.slug, meeting: f.meetingId });
  const all = (): [string, Route, string?][] => [
    ["people", meetingRoutes.people.GET],
    ["history", meetingRoutes.history.GET],
    ["history mine", meetingRoutes.historyMine.GET],
    ["draft", meetingRoutes.draft.GET],
    ["stats", meetingRoutes.stats.GET],
    ["transcript", meetingRoutes.transcript.GET, "?date=2030-01-07"],
    ["decisions", meetingRoutes.decisions.GET],
    ["github", meetingRoutes.github.GET],
    ["gitlab projects", meetingRoutes.gitlabProjects.GET],
  ];

  it("are reached by their participants, with their role", async () => {
    await signIn(people.member.userId);
    expect(await meetingContext(w.ws.slug, a.meetingId)).toMatchObject({ role: "participant", viewer: { memberId: a.memberId } });
    expect((await requireMeeting(w.ws.slug, a.meetingId, "history.read")).meeting.id).toBe(a.meetingId);
    expect(await call(meetingRoutes.history.GET, at(a))).toMatchObject({ status: 200 });
    expect(await call(meetingRoutes.historyMine.GET, at(a))).toMatchObject({ status: 200 });
  });

  it("of the same workspace stay out of reach of a participant of another one", async () => {
    await signIn(people.member.userId);
    expect(await meetingContext(w.ws.slug, b.meetingId)).toBeNull();
    await expect(requireMeeting(w.ws.slug, b.meetingId)).rejects.toMatchObject({ status: 403, key: "accessDenied" });
    for (const [name, handler, query] of all())
      expect({ name, ...(await call(handler, at(b), undefined, query)) }).toEqual({ name, ...denied });
    expect(await projectActions.followProjectAction(w.ws.slug, b.meetingId, a.projectId, true)).toEqual(refused("accessDenied"));
  });

  it("keep running and configuring to their hosts", async () => {
    await signIn(people.member.userId);
    await expect(requireMeeting(w.ws.slug, a.meetingId, "session.run")).rejects.toMatchObject({ status: 403, key: "hostOnly" });
    await expect(requireMeeting(w.ws.slug, a.meetingId, "meeting.configure")).rejects.toMatchObject({ status: 403, key: "accessDenied" });
    expect(await call(meetingRoutes.people.GET, at(a))).toEqual(denied);
    expect(await call(meetingRoutes.draft.GET, at(a))).toEqual(denied);
    expect(await call(meetingRoutes.stats.GET, at(a))).toEqual(denied);
    // The full list of GitLab projects is for whoever configures the meeting
    expect(await call(meetingRoutes.gitlabProjects.GET, at(a))).toEqual(denied);
    expect(await projectActions.followProjectAction(w.ws.slug, a.meetingId, a.projectId, false)).toEqual(refused("accessDenied"));
    expect(await prisma.meetingProject.count({ where: { meetingId: a.meetingId, projectId: a.projectId } })).toBe(1);
  });

  it("are all reached by the workspace's administrators, participants or not", async () => {
    await signIn(people.admin.userId);
    expect(await meetingContext(w.ws.slug, b.meetingId)).toMatchObject({ role: null, viewer: { isAdmin: true } });
    expect(await call(meetingRoutes.people.GET, at(b))).toMatchObject({ status: 200 });
    expect(await call(meetingRoutes.stats.GET, at(b))).toMatchObject({ status: 200 });
  });

  it("are not reached by a guest of the workspace who takes no part in them", async () => {
    await signIn(people.guest.userId);
    expect(await meetingContext(w.ws.slug, a.meetingId)).toBeNull();
    expect(await call(meetingRoutes.history.GET, at(a))).toEqual(denied);
  });

  it("of another workspace stay out of reach, whatever workspace the address names", async () => {
    await signIn(other.user.id);
    for (const [name, handler, query] of all())
      expect({ name, ...(await call(handler, at(a), undefined, query)) }).toEqual({ name, ...denied });
    // The stranger's own workspace in the address, another workspace's meeting: not found in theirs
    expect(await meetingContext(other.ws.slug, a.meetingId)).toBeNull();
    expect(await call(meetingRoutes.history.GET, { ws: other.ws.slug, meeting: a.meetingId })).toEqual(denied);
  });

  it("answer 401 to someone signed out", async () => {
    await signIn(null);
    await expect(requireMeeting(w.ws.slug, a.meetingId)).rejects.toMatchObject({ status: 401, key: "signInRequired" });
    for (const [name, handler, query] of all())
      expect({ name, ...(await call(handler, at(a), undefined, query)) }).toEqual({ name, ...signedOut });
  });

  it("archived are out of reach, even of their host", async () => {
    const f = await meeting(w, "Archived");
    await prisma.meeting.update({ where: { id: f.meetingId }, data: { archivedAt: new Date() } });
    await signIn(w.user.id);
    expect(await meetingContext(w.ws.slug, f.meetingId)).toBeNull();
    expect(await call(meetingRoutes.history.GET, at(f))).toEqual(denied);
  });
});
