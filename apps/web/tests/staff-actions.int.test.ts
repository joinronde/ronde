import { prisma, refreshPlan, refreshPlans } from "@ronde/db";
import { describe, expect, it } from "vitest";
import { auth } from "@/lib/server/auth";
import { workspace } from "./fixtures";

// What the back-office of the cloud changes in the app: plans granted by hand, accounts disabled

describe("plans granted by the Ronde team", () => {
  it("raise the plan while they run, and give it back when they end or are revoked", async () => {
    const w = await workspace(`grant-${Date.now().toString(36)}`);
    const grant = await prisma.planGrant.create({
      data: { workspaceId: w.ws.id, plan: "enterprise", reason: "education", createdBy: "staff@example.org" },
    });
    expect(await refreshPlan(w.ws.id)).toBe("enterprise");
    // A paid Team subscription does not lower an Enterprise grant
    await prisma.subscription.create({ data: { workspaceId: w.ws.id, customerId: `cus_${w.ws.id}`, status: "active" } });
    expect(await refreshPlan(w.ws.id)).toBe("enterprise");
    await prisma.planGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
    expect(await refreshPlan(w.ws.id)).toBe("team");
    // A grant that ended yesterday: the hourly job puts the workspace back
    await prisma.subscription.update({ where: { workspaceId: w.ws.id }, data: { status: "canceled" } });
    await prisma.planGrant.create({
      data: {
        workspaceId: w.ws.id,
        plan: "team",
        reason: "trial",
        createdBy: "staff@example.org",
        endsAt: new Date(Date.now() - 86_400_000),
      },
    });
    await prisma.workspace.update({ where: { id: w.ws.id }, data: { plan: "team" } });
    expect(await refreshPlans()).toBeGreaterThanOrEqual(1);
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: w.ws.id } })).plan).toBe("community");
  });
});

describe("accounts disabled by the Ronde team", () => {
  it("cannot open a session, whatever the way of signing in", async () => {
    const w = await workspace(`off-${Date.now().toString(36)}`);
    const ctx = await auth.$context;
    expect(await ctx.internalAdapter.createSession(w.user.id)).toMatchObject({ userId: w.user.id });
    await prisma.user.update({ where: { id: w.user.id }, data: { disabledAt: new Date() } });
    await expect(ctx.internalAdapter.createSession(w.user.id)).rejects.toMatchObject({ body: { code: "ACCOUNT_DISABLED" } });
  });
});
