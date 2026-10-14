import { can, type Permission } from "@ronde/core/permissions";
import { prisma, scoped } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "@/lib/server/authz";
import { meeting, workspace } from "./fixtures";

// Every paid feature refuses a workspace whose plan lacks it, through the actions and routes people use, and
// lets the plan that includes it through. In the cloud, where each workspace has its own plan.

let current: WorkspaceContext;
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {}, getAll: () => [] }),
}));
// The person signed in: the owner of the workspace the test is on
vi.mock("@/lib/server/authz", async (original) => {
  const real = await original<typeof import("@/lib/server/authz")>();
  return { ...real, authorize: async () => current, requireUser: async () => current.user, currentUser: async () => current.user };
});

const actions = await import("@/app/w/[ws]/actions");
const { GET: auditCsv } = await import("@/app/api/w/[ws]/audit/route");
const { PUT: putLogo } = await import("@/app/api/w/[ws]/logo/route");
const { GET: portfolioCsv } = await import("@/app/api/w/[ws]/projects/export/route");
const { runOp } = await import("@/lib/server/meeting/ops");
const { syncProject } = await import("@/lib/server/project-import");

const NOT_IN_PLAN = "This feature is not included in your plan.";
const run = Date.now().toString(36);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

type Plan = "community" | "team" | "enterprise";
const contexts = new Map<Plan, WorkspaceContext>();

async function contextOn(plan: Plan): Promise<WorkspaceContext> {
  const w = await workspace(`gates-${plan}-${run}`);
  await prisma.workspace.update({ where: { id: w.ws.id }, data: { plan } });
  const principal = { userId: w.user.id, personId: w.host.id, workspaceId: w.ws.id, workspaceRole: "owner" as const };
  return {
    user: { id: w.user.id, name: w.user.name, email: w.user.email, image: null, locale: null, timezone: null, instanceRole: "user" },
    workspace: { id: w.ws.id, slug: w.ws.slug, name: w.ws.name, locale: "en", timezone: "UTC", plan, settings: {} },
    member: { id: w.member.id, personId: w.host.id, role: "owner" },
    principal,
    db: scoped(prisma, w.ws.id),
    can: (p: Permission) => can(principal, p),
  };
}

beforeAll(async () => {
  process.env.RONDE_CLOUD = "1";
  for (const plan of ["community", "team", "enterprise"] as const) contexts.set(plan, await contextOn(plan));
});
afterAll(() => {
  delete process.env.RONDE_CLOUD;
});

/** The error an action gives on that plan (null: none) */
async function errorOn(plan: Plan, call: (slug: string) => Promise<{ ok: boolean; error?: string } | Response>) {
  current = contexts.get(plan)!;
  const res = await call(current.workspace.slug);
  if (res instanceof Response) return res.status === 403 ? ((await res.json()) as { error?: string }).error : null;
  return res.ok ? null : (res.error ?? null);
}

const params = (slug: string) => ({ params: Promise.resolve({ ws: slug }) });

const CASES: [
  feature: string,
  plan: Exclude<Plan, "community">,
  call: (slug: string) => Promise<{ ok: boolean; error?: string } | Response>,
][] = [
  ["branding.customLogo", "team", (slug) => putLogo(new Request("http://x", { method: "PUT", body: PNG }), params(slug))],
  ["compliance.auditLog (CSV)", "team", (slug) => auditCsv(new Request(`http://x/api/w/${slug}/audit`), params(slug))],
  ["reporting.portfolio (CSV)", "team", (slug) => portfolioCsv(new Request(`http://x/api/w/${slug}/projects/export`), params(slug))],
  ["reporting.scheduled", "team", (slug) => actions.saveReportsAction(slug, { frequency: "weekly", recipients: "admins", emails: "" })],
  ["modules.aiAssistant", "team", (slug) => actions.saveAiAction(slug, { enabled: true, model: "claude-sonnet-5-5" })],
  [
    "modules.transcription",
    "team",
    (slug) =>
      actions.saveTranscriptionAction(slug, { enabled: false, baseUrl: "https://api.openai.com/v1", model: "whisper-1", language: "" }),
  ],
  ["integrations.writeBack", "team", (slug) => actions.testTrackerAction(slug, "00000000-0000-7000-8000-000000000000")],
  // A Zoom account (a BigBlueButton server comes with every edition)
  [
    "integrations.videoLinks",
    "team",
    (slug) => actions.saveVideoAccountAction(slug, { kind: "zoom", name: "Zoom", config: { accountId: "", clientId: "" }, secret: "" }),
  ],
  ["scheduling.calendarSync", "team", (slug) => actions.testCalendarAccountAction(slug, "00000000-0000-7000-8000-000000000000")],
  ["integrations.wikis", "team", (slug) => actions.testWikiAction(slug, "00000000-0000-7000-8000-000000000000")],
  ["integrations.slack", "team", (slug) => actions.setSlackRemindersAction(slug, true)],
  [
    "integrations.sms",
    "team",
    (slug) =>
      actions.saveConnectorAction(slug, {
        kind: "sms",
        name: "SMS",
        config: { accountSid: `AC${"a".repeat(32)}`, from: "+33600000000" },
        secret: "t".repeat(32),
      }),
  ],
  ["compliance.auditStream", "enterprise", (slug) => actions.setAuditStreamAction(slug, "00000000-0000-7000-8000-000000000000")],
  ["permissions.customRoles", "enterprise", (slug) => actions.saveRoleAction(slug, { name: "Auditor", description: "", permissions: [] })],
  ["identity.domainCapture", "enterprise", (slug) => actions.addDomainAction(slug, `gates-${run}.test`)],
  ["identity.saml", "enterprise", (slug) => actions.removeSsoProviderAction(slug, "00000000-0000-7000-8000-000000000000")],
  ["identity.ldap", "enterprise", (slug) => actions.removeLdapAction(slug)],
  ["identity.scim", "enterprise", (slug) => actions.createScimTokenAction(slug, "Okta")],
];

describe("plans", () => {
  it.each(CASES)("%s is refused without its plan, and allowed with %s", async (_feature, plan, call) => {
    expect(await errorOn("community", call)).toBe(NOT_IN_PLAN);
    expect(await errorOn(plan, call)).not.toBe(NOT_IN_PLAN);
    // An Enterprise feature is not part of Team
    if (plan === "enterprise") expect(await errorOn("team", call)).toBe(NOT_IN_PLAN);
  });

  it("refuses a notification workflow, and a project kept in sync, without Team", async () => {
    const f = await meeting(await workspace(`gates-ops-${run}`), "Weekly");
    const rule = await prisma.notificationRule.findFirstOrThrow({ where: { meetingId: f.meetingId } });
    const save = (plan: Plan) =>
      runOp(
        { ...f.ctx, ws: { ...f.ctx.ws, workspace: { ...f.ctx.ws.workspace, plan } } },
        {
          op: "notifications.save",
          rules: [
            {
              connectorId: rule.connectorId,
              event: "minutes.published",
              target: {},
              options: {},
              conditions: [{ field: "openActions", op: ">", value: 0 }],
              message: null,
              enabled: true,
            },
          ],
        },
      );
    await expect(save("community")).rejects.toMatchObject({ key: "featureNotInPlan" });
    // Testing a leftover SMS connector from a meeting sends nothing without Team
    const sms = await prisma.connector.create({
      data: { workspaceId: f.workspaceId, kind: "sms", name: "SMS", config: { accountSid: `AC${"a".repeat(32)}`, from: "+33600000000" } },
    });
    await expect(runOp(f.ctx, { op: "notifications.test", connectorId: sms.id, target: {} })).rejects.toMatchObject({
      key: "featureNotInPlan",
    });
    await expect(save("team")).resolves.not.toThrow();
    await expect(syncProject({ ...f.ctx.ws, workspace: { ...f.ctx.ws.workspace, plan: "community" } }, f.projectId)).rejects.toMatchObject({
      key: "featureNotInPlan",
    });
  });
});
