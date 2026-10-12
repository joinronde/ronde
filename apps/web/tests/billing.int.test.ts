import { createHmac } from "node:crypto";
import { can, type Permission, type WorkspaceRole } from "@ronde/core/permissions";
import { prisma } from "@ronde/db";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "@/lib/server/authz";
import { activeSeats, handleWebhook, startCheckout, syncSeats } from "@/lib/server/billing";
import { featureOn } from "@/lib/server/license";
import { upgradeTarget } from "@/lib/server/plans";
import { deleteWorkspace, invite } from "@/lib/server/workspaces";
import { type Fixture, meeting, workspace } from "./fixtures";

// Billing of the cloud: a workspace subscribes with Stripe Checkout, webhooks move it to Team and back. Against a
// Stripe kept in memory: its customers, subscriptions and Checkout pages, as the API answers them.

const SECRET = "whsec_int";
const sign = (payload: string) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", SECRET).update(`${t}.${payload}`).digest("hex")}`;
};

type Sub = {
  id: string;
  customer: string;
  status: string;
  price: string;
  interval: "month" | "year";
  quantity: number;
  workspaceId: string;
};
const stripe = {
  customers: [] as { id: string; email: string; workspaceId: string }[],
  subscriptions: new Map<string, Sub>(),
  sessions: new Map<string, { id: string; status: "open" | "complete" | "expired"; customer: string }>(),
  calls: [] as { method: string; path: string; body: URLSearchParams }[],
  /** The next request to this path answers 500 (Stripe or the network failing) */
  failing: new Set<string>(),
};
const subObject = (s: Sub) => ({
  id: s.id,
  object: "subscription",
  customer: s.customer,
  status: s.status,
  metadata: { workspaceId: s.workspaceId },
  current_period_end: 1_900_000_000,
  items: { data: [{ id: `si_${s.id}`, quantity: s.quantity, price: { id: s.price, recurring: { interval: s.interval } } }] },
});
const fakeStripe = vi.fn(async (url: string, init: RequestInit = {}) => {
  const u = new URL(url);
  const method = init.method ?? "GET";
  const path = u.pathname.replace(/^\/v1/, "");
  const body = new URLSearchParams(String(init.body ?? ""));
  stripe.calls.push({ method, path, body });
  if (stripe.failing.delete(`${method} ${path}`)) return Response.json({ error: { message: "Stripe is down" } }, { status: 500 });
  if (method === "POST" && path === "/customers") {
    const c = { id: `cus_${stripe.customers.length + 1}`, email: body.get("email")!, workspaceId: body.get("metadata[workspaceId]")! };
    stripe.customers.push(c);
    return Response.json({ id: c.id });
  }
  if (method === "POST" && path === "/checkout/sessions") {
    const id = `cs_${stripe.sessions.size + 1}`;
    stripe.sessions.set(id, { id, status: "open", customer: body.get("customer")! });
    return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` });
  }
  const session = /^\/checkout\/sessions\/([^/]+)(\/expire)?$/.exec(path);
  if (session) {
    const s = stripe.sessions.get(session[1]!);
    if (!s) return Response.json({ error: { message: "No such session" } }, { status: 404 });
    if (session[2]) s.status = "expired";
    return Response.json(s);
  }
  if (method === "GET" && path === "/subscriptions")
    return Response.json({
      data: [...stripe.subscriptions.values()].filter((s) => s.customer === u.searchParams.get("customer")).map(subObject),
    });
  const sub = /^\/subscriptions\/([^/]+)$/.exec(path);
  if (sub) {
    const s = stripe.subscriptions.get(sub[1]!);
    if (!s) return Response.json({ error: { message: "No such subscription" } }, { status: 404 });
    if (method === "DELETE") s.status = "canceled";
    if (method === "POST" && body.get("items[0][quantity]")) s.quantity = Number(body.get("items[0][quantity]"));
    return Response.json(subObject(s));
  }
  if (method === "POST" && path === "/billing_portal/sessions") return Response.json({ url: "https://billing.stripe.com/p/session" });
  throw new Error(`unexpected ${method} ${path}`);
});

/** A subscription Stripe now has (the customer paid on the Checkout page) */
function paid(workspaceId: string, o: Partial<Sub> = {}): Sub {
  const customer = stripe.customers.find((c) => c.workspaceId === workspaceId)!.id;
  const s: Sub = {
    id: `sub_${stripe.subscriptions.size + 1}`,
    customer,
    status: "active",
    price: "price_team",
    interval: "month",
    quantity: 2,
    workspaceId,
    ...o,
  };
  stripe.subscriptions.set(s.id, s);
  return s;
}
let events = 0;
/** The webhook Stripe sends about a subscription: only its id and kind matter, Ronde reads the rest from Stripe */
const webhook = (type: string, s: Pick<Sub, "id" | "customer" | "workspaceId">, id = `evt_${++events}_${Date.now()}`) => {
  const payload = JSON.stringify({
    id,
    type,
    data: { object: { id: s.id, object: "subscription", customer: s.customer, status: "stale", metadata: { workspaceId: s.workspaceId } } },
  });
  return handleWebhook(payload, sign(payload));
};
const planOf = async (id: string) => (await prisma.workspace.findUniqueOrThrow({ where: { id } })).plan;

/** The workspace as a person of that role sees it */
const as = (f: Fixture, role: WorkspaceRole): WorkspaceContext => {
  const principal = { ...f.ctx.ws.principal, workspaceRole: role };
  return { ...f.ctx.ws, member: { ...f.ctx.ws.member, role }, principal, can: (p: Permission) => can(principal, p) };
};

let f: Fixture;
beforeAll(async () => {
  Object.assign(process.env, {
    RONDE_CLOUD: "1",
    STRIPE_SECRET_KEY: "sk_test",
    STRIPE_WEBHOOK_SECRET: SECRET,
    STRIPE_PRICE_TEAM: "price_team",
    STRIPE_PRICE_TEAM_YEARLY: "price_team_yearly",
    APP_URL: "https://app.example.org",
  });
  vi.stubGlobal("fetch", fakeStripe);
});
beforeEach(async () => {
  f = await meeting(await workspace(`bill-${Date.now().toString(36)}-${++events}`), "Weekly");
});
afterAll(() => {
  for (const k of ["RONDE_CLOUD", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_TEAM", "STRIPE_PRICE_TEAM_YEARLY"])
    delete process.env[k];
  vi.unstubAllGlobals();
});

describe("checkout", () => {
  it("sends the owner, or the person in charge of billing, to Stripe Checkout for the people who took part", async () => {
    const url = await startCheckout(f.ctx.ws);
    expect(url).toMatch(/^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_/);
    const form = stripe.calls.findLast((c) => c.path === "/checkout/sessions")!.body;
    // Its own customer, made once, carries the workspace
    const customer = stripe.customers.find((c) => c.workspaceId === f.workspaceId)!;
    expect([form.get("customer"), form.get("client_reference_id"), form.get("line_items[0][quantity]")]).toEqual([
      customer.id,
      f.workspaceId,
      "2",
    ]);
    expect(form.get("success_url")).toContain(`/w/${f.ctx.ws.workspace.slug}/settings/billing?checkout=done`);
    // The billing role pays; an administrator does not
    await expect(startCheckout(as(f, "billing"), "year")).resolves.toMatch(/checkout\.stripe\.com/);
    expect(stripe.calls.findLast((c) => c.path === "/checkout/sessions")!.body.get("line_items[0][price]")).toBe("price_team_yearly");
    await expect(startCheckout(as(f, "admin"))).rejects.toMatchObject({ status: 403 });
    expect(stripe.customers.filter((c) => c.workspaceId === f.workspaceId)).toHaveLength(1);
  });

  it("closes the Checkout page opened before, and never opens a second subscription", async () => {
    await startCheckout(f.ctx.ws);
    const first = [...stripe.sessions.values()].at(-1)!;
    await startCheckout(f.ctx.ws);
    expect(first.status).toBe("expired");
    // Paid on the newest page, before Ronde heard of it: a new click finds it and takes it, without a new page
    const s = paid(f.workspaceId);
    const pages = stripe.sessions.size;
    await expect(startCheckout(f.ctx.ws)).rejects.toMatchObject({ key: "alreadySubscribed" });
    expect(stripe.sessions.size).toBe(pages);
    expect(await planOf(f.workspaceId)).toBe("team");
    expect(await prisma.subscription.findUniqueOrThrow({ where: { workspaceId: f.workspaceId } })).toMatchObject({ subscriptionId: s.id });
  });

  it("says a payment is on its way when the page opened before was just paid", async () => {
    await startCheckout(f.ctx.ws);
    [...stripe.sessions.values()].at(-1)!.status = "complete";
    await expect(startCheckout(f.ctx.ws)).rejects.toMatchObject({ key: "subscriptionStarting" });
  });

  it("is handed out by the owner and the billing role only, and the people who pay find the plans on the billing page", async () => {
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
    await expect(invite(as(f, "admin"), { firstName: "Bea", email: "bea@bill.test", role: "billing" })).rejects.toMatchObject({
      status: 403,
    });
    await invite(f.ctx.ws, { firstName: "Bea", email: "bea@bill.test", role: "billing" });
    expect((await prisma.invitation.findFirstOrThrow({ where: { email: "bea@bill.test", workspaceId: f.workspaceId } })).role).toBe(
      "billing",
    );
  });
});

describe("seats", () => {
  const session = (data: object) =>
    prisma.session.create({
      data: { workspaceId: f.workspaceId, meetingId: f.meetingId, date: `2026-0${++events % 9 || 1}-1${events % 9}`, ...data },
    });

  it("count the people who were there in the last 30 days, account or not, once", async () => {
    // The fixture's session: the host and a person of the directory without an account, both there
    expect(await activeSeats(f.workspaceId)).toBe(2);
    expect(await activeSeats(f.workspaceId, Date.now() + 31 * 86_400_000)).toBe(0);
    // Marked absent: not counted
    await prisma.session.update({ where: { id: f.sessionId }, data: { absent: [f.memberId] } });
    expect(await activeSeats(f.workspaceId)).toBe(1);
  });

  it("count in a timed round only the people who had a turn or wrote something, never an observer", async () => {
    const observer = await prisma.person.create({
      data: { workspaceId: f.workspaceId, email: `obs-${events}@bill.test`, firstName: "Obs" },
    });
    await prisma.meetingParticipant.create({
      data: { workspaceId: f.workspaceId, meetingId: f.meetingId, personId: observer.id, role: "observer" },
    });
    // The host spoke; the other person, invited, never came (nobody marked them absent)
    await prisma.session.update({ where: { id: f.sessionId }, data: { spent: { [f.hostPersonId]: 90_000 } } });
    expect(await activeSeats(f.workspaceId)).toBe(1);
  });

  it("count in an async meeting the people who wrote their check-in", async () => {
    await prisma.session.update({ where: { id: f.sessionId }, data: { startedAt: new Date(Date.now() - 40 * 86_400_000) } });
    await session({
      status: "archived",
      archivedAt: new Date(),
      record: {
        participants: [{ id: f.hostPersonId }, { id: f.memberId }],
        checkIns: { [f.memberId]: { items: [{ id: "i" }] }, [f.hostPersonId]: { items: [] } },
      },
    });
    expect(await activeSeats(f.workspaceId)).toBe(1);
  });

  it("follow the people every day, not for a deleted workspace", async () => {
    await startCheckout(f.ctx.ws);
    const s = paid(f.workspaceId, { quantity: 5 });
    await webhook("customer.subscription.created", s);
    expect(await syncSeats()).toBeGreaterThanOrEqual(1);
    expect(s.quantity).toBe(2);
    await prisma.workspace.update({ where: { id: f.workspaceId }, data: { deletedAt: new Date() } });
    s.quantity = 9;
    await prisma.subscription.update({ where: { workspaceId: f.workspaceId }, data: { seats: 9 } });
    await syncSeats();
    expect(s.quantity).toBe(9);
  });
});

describe("webhooks", () => {
  it("move the workspace to Team once Stripe has the subscription active, once per event", async () => {
    await startCheckout(f.ctx.ws);
    const s = paid(f.workspaceId);
    expect(await webhook("customer.subscription.created", s, `evt_once_${f.workspaceId}`)).toBe(200);
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } });
    expect(ws.plan).toBe("team");
    expect(featureOn("modules.aiAssistant", ws)).toBe(true);
    expect(await prisma.subscription.findUniqueOrThrow({ where: { workspaceId: f.workspaceId } })).toMatchObject({
      subscriptionId: s.id,
      seats: 2,
      status: "active",
      interval: "month",
      checkoutSessionId: null,
    });
    expect(await webhook("customer.subscription.created", s, `evt_once_${f.workspaceId}`)).toBe(200);
    expect(await prisma.stripeEvent.count({ where: { id: `evt_once_${f.workspaceId}` } })).toBe(1);
  });

  it("read the subscription as Stripe has it now: a late event says nothing older", async () => {
    await startCheckout(f.ctx.ws);
    const s = paid(f.workspaceId);
    await webhook("customer.subscription.created", s);
    s.status = "canceled";
    await webhook("customer.subscription.deleted", s);
    expect(await planOf(f.workspaceId)).toBe("community");
    // The "updated" sent before the end arrives last: the subscription is still over
    await webhook("customer.subscription.updated", s);
    expect(await planOf(f.workspaceId)).toBe("community");
  });

  it("count an event only once it is taken into account: a failure is tried again", async () => {
    await startCheckout(f.ctx.ws);
    const s = paid(f.workspaceId);
    stripe.failing.add(`GET /subscriptions/${s.id}`);
    await expect(webhook("customer.subscription.created", s, `evt_retry_${f.workspaceId}`)).rejects.toThrow();
    expect(await planOf(f.workspaceId)).toBe("community");
    expect(await webhook("customer.subscription.created", s, `evt_retry_${f.workspaceId}`)).toBe(200);
    expect(await planOf(f.workspaceId)).toBe("team");
  });

  it("give Team only for a price Ronde sells, and keep the subscription in place when another one shows up", async () => {
    await startCheckout(f.ctx.ws);
    const odd = paid(f.workspaceId, { price: "price_other" });
    await webhook("customer.subscription.created", odd);
    expect(await planOf(f.workspaceId)).toBe("community");
    odd.status = "canceled";
    await webhook("customer.subscription.deleted", odd);
    const s = paid(f.workspaceId);
    await webhook("customer.subscription.created", s);
    const second = paid(f.workspaceId);
    await webhook("customer.subscription.created", second);
    // Ending the second one does not end the workspace's plan
    second.status = "canceled";
    await webhook("customer.subscription.deleted", second);
    expect(await prisma.subscription.findUniqueOrThrow({ where: { workspaceId: f.workspaceId } })).toMatchObject({
      subscriptionId: s.id,
      status: "active",
    });
    expect(await planOf(f.workspaceId)).toBe("team");
  });

  it("refuse a webhook they cannot verify, and everything without the webhook's secret", async () => {
    const payload = JSON.stringify({ id: "evt_forged", type: "customer.subscription.deleted", data: { object: {} } });
    expect(await handleWebhook(payload, "t=1,v1=deadbeef")).toBe(400);
    process.env.STRIPE_WEBHOOK_SECRET = "";
    const t = Math.floor(Date.now() / 1000);
    expect(await handleWebhook(payload, `t=${t},v1=${createHmac("sha256", "").update(`${t}.${payload}`).digest("hex")}`)).toBe(404);
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  });
});

describe("deleting a paying workspace", () => {
  it("ends its subscription first, and is refused while Stripe cannot be reached", async () => {
    await startCheckout(f.ctx.ws);
    const s = paid(f.workspaceId);
    await webhook("customer.subscription.created", s);
    stripe.failing.add(`DELETE /subscriptions/${s.id}`);
    await expect(deleteWorkspace(f.ctx.ws, f.ctx.ws.workspace.slug)).rejects.toMatchObject({ key: "billingUnreachable" });
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).deletedAt).toBeNull();
    await deleteWorkspace(f.ctx.ws, f.ctx.ws.workspace.slug);
    expect(s.status).toBe("canceled");
    expect((await prisma.workspace.findUniqueOrThrow({ where: { id: f.workspaceId } })).deletedAt).not.toBeNull();
  });
});
