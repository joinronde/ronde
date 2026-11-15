import { createHmac, randomBytes } from "node:crypto";
import { prisma } from "@ronde/db";
import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { meeting, workspace } from "./fixtures";

// The ways into a workspace and out of a dead end, signed in for real: the home page, the notice of a suspended
// workspace, the onboarding page and the account's list of workspaces

let request: Record<string, string> = {};
let lastWorkspace: string | undefined;
/** Other cookies of the browser, by name */
let jar: Record<string, string> = {};
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(request),
  cookies: async () => ({
    get: (name: string) =>
      name === "ronde-ws" && lastWorkspace ? { name, value: lastWorkspace } : jar[name] ? { name, value: jar[name] } : undefined,
    set: () => {},
    delete: () => {},
    getAll: () => [],
  }),
}));
vi.mock("next-intl/server", async () => {
  const { translator } = await import("@ronde/i18n");
  return {
    getTranslations: async (ns: Parameters<typeof translator>[1]) => translator("en", ns),
    getLocale: async () => "en",
  };
});

const { env } = await import("@/lib/server/env");
const Home = (await import("@/app/page")).default;
const Suspended = (await import("@/app/suspended/page")).default;
const OnboardingPage = (await import("@/app/onboarding/page")).default;
const AccountWorkspacesPage = (await import("@/app/account/workspaces/page")).default;
const InvitationPage = (await import("@/app/(auth)/invite/[token]/page")).default;
const GuestScreenPage = (await import("@/app/g/[token]/page")).default;
const SignUpPage = (await import("@/app/(auth)/sign-up/page")).default;
const TwoFactorPage = (await import("@/app/(auth)/sign-in/two-factor/page")).default;
const { failureKey } = await import("@/lib/auth-client");
const { hashToken } = await import("@/lib/server/workspaces");
const WorkspaceHome = (await import("@/app/w/[ws]/(shell)/(workspace)/page")).default;
const SettingsPage = (await import("@/app/w/[ws]/(shell)/(workspace)/settings/page")).default;
const BillingPage = (await import("@/app/w/[ws]/(shell)/(workspace)/settings/billing/page")).default;
const PlansPage = (await import("@/app/w/[ws]/(shell)/(workspace)/settings/plans/page")).default;
const ProjectsPage = (await import("@/app/w/[ws]/(shell)/(workspace)/projects/page")).default;
const { shellData } = await import("@/lib/server/shell");
const StatsPage = (await import("@/app/w/[ws]/(shell)/m/[meeting]/(app)/stats/page")).default;
const { inviteAction, changeRoleAction, removePersonAction } = await import("@/app/w/[ws]/actions");
const { workspaceContext } = await import("@/lib/server/authz");

const signOut = () => {
  request = { "accept-language": "en" };
};

/** Opens a real session for the user: the row Better Auth reads, and the cookie it signs */
async function signIn(userId: string) {
  request = { "accept-language": "en" };
  const token = crypto.randomUUID().replaceAll("-", "");
  await prisma.authSession.create({ data: { id: crypto.randomUUID(), token, userId, expiresAt: new Date(Date.now() + 86_400_000) } });
  const signature = createHmac("sha256", env.authSecret()).update(token).digest("base64");
  request.cookie = `ronde.session_token=${encodeURIComponent(`${token}.${signature}`)}`;
}

/** Where a page redirects: the path Next's redirect() carries */
async function redirectOf(page: Promise<unknown>): Promise<string | null> {
  try {
    await page;
    return null;
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw e;
    return digest.split(";")[2] ?? null;
  }
}

/** The text a page shows, and the links and controls it offers, read from its element tree */
function walk(node: ReactNode, visit: (props: Record<string, unknown>, type: unknown) => void) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
  if (!isValidElement(node)) return;
  const props = node.props as Record<string, unknown>;
  visit(props, node.type);
  walk(props.children as ReactNode, visit);
}
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (!isValidElement(node)) return "";
  const props = node.props as { children?: ReactNode; label?: string };
  return `${props.label ?? ""}${textOf(props.children)}`;
}
function hrefsOf(node: ReactNode): string[] {
  const out: string[] = [];
  walk(node, (props) => {
    if (typeof props.href === "string") out.push(props.href);
  });
  return out;
}

const run = Date.now().toString(36);
let n = 0;
let w: Awaited<ReturnType<typeof workspace>>;
beforeEach(async () => {
  lastWorkspace = undefined;
  jar = {};
  w = await workspace(`access-${run}-${++n}`);
});
const suspend = (id: string) => prisma.workspace.update({ where: { id }, data: { suspendedAt: new Date() } });
/** A second workspace the same account belongs to, with the given role */
async function alsoIn(userId: string, role: "owner" | "member" = "owner") {
  const other = await workspace(`access-${run}-${n}-b`);
  const person = await prisma.person.create({
    data: { workspaceId: other.ws.id, userId, email: `also-${n}@access.test`, firstName: "Also" },
  });
  await prisma.workspaceMember.create({ data: { workspaceId: other.ws.id, userId, personId: person.id, role } });
  return other;
}

describe("a suspended workspace", () => {
  it("is not where the home page leads: without another workspace, onboarding", async () => {
    await suspend(w.ws.id);
    await signIn(w.user.id);
    lastWorkspace = w.ws.slug;
    expect(await redirectOf(Home())).toBe("/onboarding");
  });

  it("is passed over for the account's other workspace, even when it was the last one opened", async () => {
    const other = await alsoIn(w.user.id);
    await suspend(w.ws.id);
    await signIn(w.user.id);
    lastWorkspace = w.ws.slug;
    expect(await redirectOf(Home())).toBe(`/w/${other.ws.slug}`);
  });

  it("offers its owner a new workspace and a way to sign out, and does not tell them the owners know why", async () => {
    await suspend(w.ws.id);
    await signIn(w.user.id);
    const page = await Suspended({ searchParams: Promise.resolve({ w: w.ws.slug }) });
    const text = textOf(page);
    expect(text).toContain("suspended by the administrator of this service");
    expect(text).not.toContain("Its owners know why");
    expect(text).toContain("Sign out");
    expect(hrefsOf(page)).toContain("/onboarding");
    // No other workspace to go back to: "/" would only come back here
    expect(hrefsOf(page)).not.toContain("/");
  });

  it("tells a member its owners know why, and leads back to their other workspaces", async () => {
    const member = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `m-${run}-${n}@access.test`, name: "Mia" } });
    const person = await prisma.person.create({ data: { workspaceId: w.ws.id, userId: member.id, email: member.email, firstName: "Mia" } });
    await prisma.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: member.id, personId: person.id, role: "member" } });
    await alsoIn(member.id, "member");
    await suspend(w.ws.id);
    await signIn(member.id);
    const page = await Suspended({ searchParams: Promise.resolve({ w: w.ws.slug }) });
    expect(textOf(page)).toContain("Its owners know why");
    expect(hrefsOf(page)).toContain("/");
  });

  it("is marked suspended on the onboarding page and in the account's workspaces", async () => {
    await suspend(w.ws.id);
    await signIn(w.user.id);
    const onboarding = (await OnboardingPage({ searchParams: Promise.resolve({}) })) as { props: { workspaces: unknown[] } };
    expect(onboarding.props.workspaces).toEqual([{ slug: w.ws.slug, name: w.ws.name, suspended: true }]);
    const account = (await AccountWorkspacesPage()) as { props: { workspaces: unknown[] } };
    expect(account.props.workspaces).toEqual([expect.objectContaining({ slug: w.ws.slug, suspended: true })]);
  });
});

describe("an invitation link that no longer opens a seat", () => {
  /** An invitation to the workspace, sent by its owner, and the token of its link */
  async function invitation(data: { expiresAt?: Date; acceptedAt?: Date; revokedAt?: Date } = {}) {
    const token = randomBytes(32).toString("base64url");
    await prisma.invitation.create({
      data: {
        workspaceId: w.ws.id,
        email: `lena-${run}-${n}@access.test`,
        role: "member",
        tokenHash: hashToken(token),
        invitedById: w.user.id,
        expiresAt: data.expiresAt ?? new Date(Date.now() + 86_400_000),
        acceptedAt: data.acceptedAt ?? null,
        revokedAt: data.revokedAt ?? null,
      },
    });
    return token;
  }
  const open = (token: string) => InvitationPage({ params: Promise.resolve({ token }) });

  /** The account the invitation was sent to, signed in */
  const invitee = async () => {
    const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `lena-${run}-${n}@access.test`, name: "Lena" } });
    await signIn(user.id);
  };

  it("says an accepted invitation was used, without naming the workspace to someone signed out", async () => {
    const token = await invitation({ acceptedAt: new Date() });
    signOut();
    const page = await open(token);
    expect(textOf(page)).toContain("already accepted");
    expect(textOf(page)).not.toContain("invalid or was revoked");
    expect(textOf(page)).not.toContain(w.ws.name);
    expect(hrefsOf(page)).toEqual(["/sign-in"]);
  });

  it("names the workspace of an accepted invitation to the account it was sent to", async () => {
    const token = await invitation({ acceptedAt: new Date() });
    await invitee();
    expect(textOf(await open(token))).toContain(`This invitation to ${w.ws.name} was already accepted`);
  });

  it("leads to signing in once expired, and names who to ask only to the account it was sent to", async () => {
    const token = await invitation({ expiresAt: new Date(Date.now() - 1000) });
    signOut();
    const page = await open(token);
    expect(textOf(page)).toContain("has expired");
    expect(textOf(page)).not.toContain(w.user.name!);
    expect(hrefsOf(page)).toEqual(["/sign-in"]);
    await invitee();
    expect(textOf(await open(token))).toContain(`Ask ${w.user.name} for a new one`);
  });

  it("offers a signed-in visitor their own workspaces when it was revoked", async () => {
    const token = await invitation({ revokedAt: new Date() });
    const visitor = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `v-${run}-${n}@access.test`, name: "Vera" } });
    await signIn(visitor.id);
    const page = await open(token);
    expect(textOf(page)).toContain("Open my workspaces");
    expect(hrefsOf(page)).toEqual(["/"]);
  });
});

describe("signing up from an invitation", () => {
  async function invitation(data: { revokedAt?: Date } = {}) {
    const token = randomBytes(32).toString("base64url");
    const email = `nina-${run}-${n}@access.test`;
    await prisma.invitation.create({
      data: {
        workspaceId: w.ws.id,
        email,
        role: "member",
        tokenHash: hashToken(token),
        invitedById: w.user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        revokedAt: data.revokedAt ?? null,
      },
    });
    return { token, email };
  }
  const signUp = (next: string, email?: string) => SignUpPage({ searchParams: Promise.resolve({ next, email }) });

  it("keeps the invitation's context: the workspace, who invites, and the address it was sent to", async () => {
    const { token, email } = await invitation();
    signOut();
    const form = (await signUp(`/invite/${token}`, "typed-over@access.test")) as { props: Record<string, unknown> };
    expect(form.props.invitation).toEqual({ token, workspace: w.ws.name, inviter: w.user.name, email });
  });

  it("does not open the form for an invitation that no longer works, on an instance by invitation", async () => {
    const before = process.env.SIGNUP_POLICY;
    process.env.SIGNUP_POLICY = "invite-only";
    try {
      const { token } = await invitation({ revokedAt: new Date() });
      signOut();
      expect(await redirectOf(signUp(`/invite/${token}`))).toBe(`/invite/${token}`);
      expect(await redirectOf(signUp("/invite/made-up"))).toBe("/invite/made-up");
    } finally {
      process.env.SIGNUP_POLICY = before;
    }
  });
});

describe("the onboarding page", () => {
  it("shows the account it is signed in with, and an invitation waiting for an address not proven yet", async () => {
    const user = await prisma.user.create({
      data: { id: crypto.randomUUID(), email: `olga-${run}-${n}@access.test`, name: "Olga", emailVerified: false },
    });
    await prisma.invitation.create({
      data: {
        workspaceId: w.ws.id,
        email: user.email,
        role: "member",
        tokenHash: hashToken(randomBytes(32).toString("base64url")),
        invitedById: w.user.id,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await signIn(user.id);
    const page = (await OnboardingPage({ searchParams: Promise.resolve({}) })) as { props: Record<string, unknown> };
    expect(page.props).toMatchObject({ email: user.email, invitations: [], invitationsByLink: 1 });
  });
});

describe("the two-step verification page", () => {
  const open = () => TwoFactorPage({ searchParams: Promise.resolve({}) });

  it("sends back to sign in, saying why, when no sign-in is waiting for its code", async () => {
    signOut();
    expect(await redirectOf(open())).toBe("/sign-in?error=TWO_FACTOR_EXPIRED");
    // A code sent once the challenge is gone is not "invalid": the sign-in expired
    expect(failureKey({ code: "INVALID_TWO_FACTOR_COOKIE" })).toBe("twoFactorExpired");
  });

  it("offers another account, and says what to do without the app or the codes", async () => {
    signOut();
    jar["ronde.two_factor"] = "signed-challenge";
    const page = await open();
    expect(hrefsOf(page)).toContain("/sign-in");
    expect(textOf(page)).toContain("Use another account");
    expect(textOf(page)).toContain("Ask the administrator of your workspace");
  });
});

describe("the first steps of a new member", () => {
  it("are their own: no meeting to create nor session to run in a workspace that has its meetings", async () => {
    const m = await meeting(w, "Weekly");
    const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `pia-${run}-${n}@access.test`, name: "Pia" } });
    const person = await prisma.person.create({ data: { workspaceId: w.ws.id, userId: user.id, email: user.email, firstName: "Pia" } });
    await prisma.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: user.id, personId: person.id, role: "member" } });
    await prisma.meetingParticipant.create({
      data: { workspaceId: w.ws.id, meetingId: m.meetingId, personId: person.id, role: "participant", position: 2 },
    });
    await signIn(user.id);
    const home = (await WorkspaceHome({ params: Promise.resolve({ ws: w.ws.slug }) })) as { props: { steps: { key: string }[] } };
    expect(home.props.steps.map((s) => s.key)).toEqual(["checkIn"]);
  });

  it("stay those of a host for whoever starts the workspace", async () => {
    await signIn(w.user.id);
    const home = (await WorkspaceHome({ params: Promise.resolve({ ws: w.ws.slug }) })) as { props: { steps: { key: string }[] } };
    expect(home.props.steps.map((s) => s.key)).toEqual(["meeting", "invite", "checkIn", "session"]);
  });
});

/** Someone of the workspace with the given role, signed in */
async function withRole(role: "admin" | "organizer" | "member" | "billing" | "guest") {
  const user = await prisma.user.create({
    data: { id: crypto.randomUUID(), email: `${role}-${run}-${n}@access.test`, name: `Role ${role}` },
  });
  const person = await prisma.person.create({ data: { workspaceId: w.ws.id, userId: user.id, email: user.email, firstName: role } });
  await prisma.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: user.id, personId: person.id, role } });
  await signIn(user.id);
  return prisma.user.findUniqueOrThrow({ where: { id: user.id } });
}
const params = () => Promise.resolve({ ws: w.ws.slug });
/** Someone of the workspace with the given role, not signed in: their seat */
async function withRoleNoSignIn(role: "owner" | "admin" | "member") {
  const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `seat-${role}-${run}-${n}@access.test`, name: role } });
  const person = await prisma.person.create({ data: { workspaceId: w.ws.id, userId: user.id, email: user.email, firstName: role } });
  await prisma.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: user.id, personId: person.id, role } });
  return { userId: user.id, personId: person.id };
}

describe("what a role is offered", () => {
  it("gives a guest no way to the directory, which would only send them home without a word", async () => {
    const member = await withRole("member");
    expect((await shellData(member as never, w.ws.slug)).can).toMatchObject({ people: true });
    const guest = await withRole("guest");
    expect((await shellData(guest as never, w.ws.slug)).can).toMatchObject({ people: false });
    const settings = (await SettingsPage({ params: params() })) as { props: { categories: unknown } };
    // The teams of the directory, and their "Manage the teams" link, are not theirs to see
    expect(settings.props.categories).toBeNull();
  });

  it("does not show a member the projects' dashboard tab of a plan the workspace lacks", async () => {
    await withRole("member");
    const page = (await ProjectsPage({ params: params(), searchParams: Promise.resolve({ view: "dashboard" }) })) as {
      props: { view: string; dashboardShown: boolean };
    };
    expect(page.props).toMatchObject({ view: "board", dashboardShown: false });
  });

  it("leads the billing address, without payments, to the plans; the plans open to whoever pays", async () => {
    await signIn(w.user.id);
    expect(await redirectOf(BillingPage({ params: params(), searchParams: Promise.resolve({}) }))).toBe(`/w/${w.ws.slug}/settings/plans`);
    await withRole("billing");
    expect(await redirectOf(PlansPage({ params: params() }))).toBeNull();
  });

  it("keeps a page not found of the workspace in its frame, with a way back", async () => {
    const WorkspaceNotFound = (await import("@/app/w/[ws]/(shell)/(workspace)/not-found")).default;
    const page = await WorkspaceNotFound();
    expect(textOf(page)).toContain("Page not found");
    expect(hrefsOf(page)).toEqual(["/"]);
  });
});

describe("a custom role (Enterprise)", () => {
  /** In the cloud, the workspace on Enterprise, a member holding a custom role with these permissions */
  async function holding(permissions: string[], builtIn: "member" | "guest" = "member") {
    process.env.RONDE_CLOUD = "1";
    await prisma.workspace.update({ where: { id: w.ws.id }, data: { plan: "enterprise" } });
    const role = await prisma.customRole.create({ data: { workspaceId: w.ws.id, name: `Role ${n}`, permissions } });
    const user = await prisma.user.create({ data: { id: crypto.randomUUID(), email: `cr-${run}-${n}@access.test`, name: "Cara" } });
    const person = await prisma.person.create({ data: { workspaceId: w.ws.id, userId: user.id, email: user.email, firstName: "Cara" } });
    await prisma.workspaceMember.create({
      data: { workspaceId: w.ws.id, userId: user.id, personId: person.id, role: builtIn, customRoleId: role.id },
    });
    await signIn(user.id);
  }
  afterEach(() => {
    delete process.env.RONDE_CLOUD;
  });

  it("“Auditor” reads the statistics of a meeting it does not run", async () => {
    const m = await meeting(w, "Weekly");
    await holding(["meeting.read", "history.read", "stats.read"]);
    expect(await redirectOf(StatsPage({ params: Promise.resolve({ ws: w.ws.slug, meeting: m.meetingId }) }))).toBeNull();
  });

  it("“People manager” invites members and changes a member's role", async () => {
    const other = await prisma.person.create({ data: { workspaceId: w.ws.id, email: `x-${run}-${n}@access.test`, firstName: "Xavi" } });
    const xUser = await prisma.user.create({ data: { id: crypto.randomUUID(), email: other.email, name: "Xavi" } });
    await prisma.person.update({ where: { id: other.id }, data: { userId: xUser.id } });
    await prisma.workspaceMember.create({ data: { workspaceId: w.ws.id, userId: xUser.id, personId: other.id, role: "member" } });
    await holding(["people.read", "people.invite", "members.manage"]);
    const invited = await inviteAction(w.ws.slug, { email: `new-${run}-${n}@access.test`, firstName: "Nora", role: "member" });
    expect(invited.ok).toBe(true);
    expect(await changeRoleAction(w.ws.slug, other.id, "guest")).toEqual({ ok: true, data: null });
    // Never more than a member
    expect((await changeRoleAction(w.ws.slug, other.id, "admin")).ok).toBe(false);
  });

  it("never lets a guest raise their own role, nor invite above it", async () => {
    await holding(["people.read", "people.invite", "members.manage"], "guest");
    const me = await prisma.workspaceMember.findFirstOrThrow({ where: { workspaceId: w.ws.id, role: "guest" } });
    expect((await changeRoleAction(w.ws.slug, me.personId, "member")).ok).toBe(false);
    expect((await prisma.workspaceMember.findUniqueOrThrow({ where: { id: me.id } })).role).toBe("guest");
    const invited = await inviteAction(w.ws.slug, { email: `up-${run}-${n}@access.test`, firstName: "Up", role: "member" });
    expect(invited.ok).toBe(false);
  });

  it("lets nobody raise their own role, while stepping down stays possible", async () => {
    await holding(["people.read", "members.manage"]);
    const me = await prisma.workspaceMember.findFirstOrThrow({ where: { workspaceId: w.ws.id, customRoleId: { not: null } } });
    expect(await changeRoleAction(w.ws.slug, me.personId, "guest")).toEqual({ ok: true, data: null });
  });

  it("“People manager” with people.manage alone removes a member, not an admin", async () => {
    const member = await withRoleNoSignIn("member");
    const admin = await withRoleNoSignIn("admin");
    await holding(["people.read", "people.manage"]);
    expect(await removePersonAction(w.ws.slug, member.personId)).toEqual({ ok: true, data: null });
    expect((await removePersonAction(w.ws.slug, admin.personId)).ok).toBe(false);
  });

  it("creating meetings holds where the workspace keeps that to its administrators", async () => {
    await prisma.workspace.update({ where: { id: w.ws.id }, data: { settings: { meetingCreation: "admins" } } });
    await holding(["meeting.create"]);
    expect((await workspaceContext(w.ws.slug))?.can("meeting.create")).toBe(true);
  });
});

describe("the last owner", () => {
  it("stays when two owners leave at the same moment", async () => {
    const second = await withRoleNoSignIn("owner");
    const { memberContext } = await import("@/lib/server/authz");
    const { leaveWorkspace } = await import("@/lib/server/workspaces");
    // Each in their own browser: two requests at once
    const [a, b] = await Promise.all([memberContext(w.ws.id, w.user.id), memberContext(w.ws.id, second.userId)]);
    const results = await Promise.allSettled([leaveWorkspace(a!), leaveWorkspace(b!)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.workspaceMember.count({ where: { workspaceId: w.ws.id, role: "owner" } })).toBe(1);
  });

  it("stays when two owners step each other down at the same moment", async () => {
    const second = await withRoleNoSignIn("owner");
    const { memberContext } = await import("@/lib/server/authz");
    const { changeRole } = await import("@/lib/server/workspaces");
    const [a, b] = await Promise.all([memberContext(w.ws.id, w.user.id), memberContext(w.ws.id, second.userId)]);
    await Promise.allSettled([changeRole(a!, second.personId, "admin"), changeRole(b!, w.host.id, "admin")]);
    expect(await prisma.workspaceMember.count({ where: { workspaceId: w.ws.id, role: "owner" } })).toBe(1);
  });
});

describe("a guest link that no longer works", () => {
  it("says so in its own words, without sending a person with no account to sign in", async () => {
    signOut();
    // A 404, with its own notice
    await expect(GuestScreenPage({ params: Promise.resolve({ token: "no-such-link" }) })).rejects.toMatchObject({
      digest: "NEXT_HTTP_ERROR_FALLBACK;404",
    });
    const GuestLinkGone = (await import("@/app/g/[token]/not-found")).default;
    const page = await GuestLinkGone();
    expect(textOf(page)).toContain("expired or was removed");
    expect(hrefsOf(page)).toEqual([]);
  });
});
