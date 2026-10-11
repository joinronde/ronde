import { createHmac } from "node:crypto";
import { prisma } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { activeSeats, handleWebhook, startCheckout } from "@/lib/server/billing";
import { featureOn } from "@/lib/server/license";
import { upgradeTarget } from "@/lib/server/plans";
import { invite } from "@/lib/server/workspaces";
import { type Fixture, meeting, workspace } from "./fixtures";

// Billing of the cloud: a workspace subscribes with Stripe Checkout, webhooks move it to Team and back

const SECRET = "whsec_int";
let f: Fixture;
const sign = (payload: string) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", SECRET).update(`${t}.${payload}`).digest("hex")}`;
};
const subscriptionEvent = (id: string, type: string, status: string) =>
  JSON.stringify({
    id,
    type,
    data: {
      object: {
        id: "sub_int",
        object: "subscription",
        customer: "cus_int",
        status,
        metadata: { workspaceId: f.workspaceId },
        items: { data: [{ quantity: 2, price: { id: "price_team" }, current_period_end: 1_900_000_000 }] },
      },
    },
  });

beforeAll(async () => {
  Object.assign(process.env, {
    RONDE_CLOUD: "1",
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_WEBHOOK_SECRET: SECRET,
    STRIPE_PRICE_TEAM: "price_team",
    APP_URL: "https://app.example.org",
  });
  f = await meeting(await workspace(`bill-${Date.now().toString(36)}`), "Weekly");
});

afterAll(() => {
  for (const k of ["RONDE_CLOUD", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_TEAM"]) delete process.env[k];
  vi.unstubAllGlobals();
});

describe("billing", () => {
  it("sends the owner to Stripe Checkout for the active people of the workspace", async () => {
    let body = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        body = String(init.body);
        return Response.json({ url: "https://checkout.stripe.com/c/pay/int" });
      }),
    );
    expect(await startCheckout(f.ctx.ws)).toBe("https://checkout.stripe.com/c/pay/int");
    const form = new URLSearchParams(body);
    expect([form.get("client_reference_id"), form.get("line_items[0][quantity]")]).toEqual([f.workspaceId, "1"]);
    expect(form.get("success_url")).toContain(`/w/${f.ctx.ws.workspace.slug}/settings/billing?checkout=done`);
  });

  it("is handed out by the owner only, and the people who pay find the plans on the billing page", async () => {
    const ws = f.ctx.ws.workspace;
    expect(upgradeTarget(ws, "owner")).toBe(`/w/${ws.slug}/settings/billing`);
    expect(upgradeTarget(ws, "billing")).toBe(`/w/${ws.slug}/settings/billing`);
    // An administrator cannot pay: the public pricing, to show the owner
    expect(upgradeTarget(ws, "admin")).toMatch(/\/pricing$/);
    expect(upgradeTarget(ws, "organizer")).toBeNull();
    // A cloud without payments set up (staging): no billing page to go to, the public pricing for everyone
    const key = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    expect(upgradeTarget(ws, "owner")).toMatch(/\/pricing$/);
    process.env.STRIPE_SECRET_KEY = key;
    const asAdmin = { ...f.ctx.ws, member: { ...f.ctx.ws.member, role: "admin" as const } };
    await expect(invite(asAdmin, { firstName: "Bea", email: "bea@bill.test", role: "billing" })).rejects.toMatchObject({ status: 403 });
    await invite(f.ctx.ws, { firstName: "Bea", email: "bea@bill.test", role: "billing" });
    expect((await prisma.invitation.findFirstOrThrow({ where: { email: "bea@bill.test" } })).role).toBe("billing");
  });

  it("counts as seats the members who took part in a session in the last 30 days", async () => {
    expect(await activeSeats(f.workspaceId)).toBe(1);
    expect(await activeSeats(f.workspaceId, Date.now() + 31 * 86_400_000)).toBe(0);
    await prisma.session.update({ where: { id: f.sessionId }, data: { absent: [f.hostPersonId] } });
    expect(await activeSeats(f.workspaceId)).toBe(0);
    await prisma.session.update({ where: { id: f.sessionId }, data: { absent: [] } });
  });

  it("takes the yearly price when asked", async () => {
    process.env.STRIPE_PRICE_TEAM_YEARLY = "price_team_yearly";
    let body = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        body = String(init.body);
        return Response.json({ url: "https://checkout.stripe.com/c/pay/year" });
      }),
    );
    await startCheckout(f.ctx.ws, "year");
    expect(new URLSearchParams(body).get("line_items[0][price]")).toBe("price_team_yearly");
    delete process.env.STRIPE_PRICE_TEAM_YEARLY;
  });

  it("moves the workspace to Team once Stripe says the subscription is active, once per event", async () => {
    const payload = subscriptionEvent("evt_int_1", "customer.subscription.created", "active");
    expect(await handleWebhook(payload, sign(payload))).toBe(200);
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } });
    expect(ws.plan).toBe("team");
    expect(featureOn("modules.aiAssistant", ws)).toBe(true);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { workspaceId: f.workspaceId } });
    expect([sub.customerId, sub.subscriptionId, sub.seats, sub.status]).toEqual(["cus_int", "sub_int", 2, "active"]);
    // Stripe sends it again: nothing changes twice
    expect(await handleWebhook(payload, sign(payload))).toBe(200);
    expect(await prisma.stripeEvent.count({ where: { id: "evt_int_1" } })).toBe(1);
  });

  it("refuses a webhook it cannot verify", async () => {
    const payload = subscriptionEvent("evt_int_x", "customer.subscription.deleted", "canceled");
    expect(await handleWebhook(payload, "t=1,v1=deadbeef")).toBe(400);
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).plan).toBe("team");
  });

  it("goes back to Community when the subscription ends", async () => {
    const payload = subscriptionEvent("evt_int_2", "customer.subscription.deleted", "canceled");
    expect(await handleWebhook(payload, sign(payload))).toBe(200);
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).plan).toBe("community");
  });
});
