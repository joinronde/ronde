import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cancel, checkout, closeCheckout, event, liveSubscriptions, setSeats, subscription } from "../src/billing";

// Billing of the cloud: Stripe Checkout for a workspace, webhooks checked before they count

const SECRET = "whsec_test";
const NOW = Date.parse("2026-10-08T12:00:00Z");
const signed = (payload: string, at = NOW / 1000, secret = SECRET) =>
  `t=${at},v1=${createHmac("sha256", secret).update(`${at}.${payload}`).digest("hex")}`;

const subscriptionEvent = JSON.stringify({
  id: "evt_1",
  type: "customer.subscription.updated",
  data: {
    object: {
      id: "sub_1",
      object: "subscription",
      customer: "cus_1",
      status: "active",
      cancel_at_period_end: false,
      metadata: { workspaceId: "ws_1" },
      items: { data: [{ quantity: 7, current_period_end: 1_800_000_000, price: { id: "price_team" } }] },
    },
  },
});

describe("billing", () => {
  it("reads a subscription event signed by Stripe", () => {
    expect(event(subscriptionEvent, signed(subscriptionEvent), SECRET, NOW)).toEqual({
      id: "evt_1",
      type: "customer.subscription.updated",
      workspaceId: "ws_1",
      customerId: "cus_1",
      subscriptionId: "sub_1",
      payment: null,
    });
    // A checkout, an invoice: the subscription they belong to
    const done = JSON.stringify({
      id: "evt_3",
      type: "checkout.session.completed",
      data: { object: { object: "checkout.session", customer: "cus_1", subscription: "sub_9", client_reference_id: "ws_1" } },
    });
    expect(event(done, signed(done), SECRET, NOW)).toMatchObject({ workspaceId: "ws_1", subscriptionId: "sub_9" });
    const failed = JSON.stringify({
      id: "evt_4",
      type: "invoice.payment_failed",
      data: { object: { object: "invoice", customer: "cus_1", parent: { subscription_details: { subscription: "sub_9" } } } },
    });
    expect(event(failed, signed(failed), SECRET, NOW)).toMatchObject({ subscriptionId: "sub_9", payment: null });
  });

  it("reads what a paid invoice brought, for the revenue figures", () => {
    const paid = JSON.stringify({
      id: "evt_2",
      type: "invoice.paid",
      data: { object: { object: "invoice", customer: "cus_1", amount_paid: 2800, currency: "eur" } },
    });
    expect(event(paid, signed(paid), SECRET, NOW)).toMatchObject({ customerId: "cus_1", payment: { amount: 28, currency: "EUR" } });
  });

  it("refuses a forged, altered or replayed webhook", () => {
    expect(event(subscriptionEvent, signed(subscriptionEvent, NOW / 1000, "whsec_other"), SECRET, NOW)).toBeNull();
    expect(event(subscriptionEvent.replace("active", "trialing"), signed(subscriptionEvent), SECRET, NOW)).toBeNull();
    expect(event(subscriptionEvent, signed(subscriptionEvent, NOW / 1000 - 3600), SECRET, NOW)).toBeNull();
    // A signature with characters beyond ASCII (as long in characters, longer in bytes): refused, not a crash
    expect(event(subscriptionEvent, `t=${NOW / 1000},v1=${"é".repeat(64)}`, SECRET, NOW)).toBeNull();
    // No secret set: nothing is taken, even signed with an empty key
    expect(event(subscriptionEvent, signed(subscriptionEvent, NOW / 1000, ""), "", NOW)).toBeNull();
  });

  /** A Stripe answering GETs from a table of objects, and recording what is asked */
  const stripe = (objects: Record<string, unknown>) => {
    const calls: { method: string; url: string }[] = [];
    const fetch = (async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url });
      const path = new URL(url).pathname + new URL(url).search;
      if (method === "GET")
        return path in objects ? Response.json(objects[path]) : Response.json({ error: { message: "No such object" } }, { status: 404 });
      if (method === "DELETE" && path in objects) return Response.json({ ...(objects[path] as object), status: "canceled" });
      if (method === "DELETE") return Response.json({ error: { message: "No such subscription: 'sub_x'" } }, { status: 404 });
      return Response.json({ id: "ok" });
    }) as unknown as typeof globalThis.fetch;
    return { calls, access: { secretKey: "sk_test", fetch } };
  };
  const sub = (id: string, status: string, extra: object = {}) => ({
    id,
    object: "subscription",
    customer: "cus_1",
    status,
    metadata: { workspaceId: "ws_1" },
    current_period_end: 1_800_000_000,
    items: { data: [{ quantity: 3, price: { id: "price_year", recurring: { interval: "year" } } }] },
    ...extra,
  });

  it("reads a subscription as Stripe has it now, its end when it is set to end", async () => {
    const { access } = stripe({
      "/v1/subscriptions/sub_1": sub("sub_1", "active"),
      "/v1/subscriptions/sub_2": sub("sub_2", "active", { cancel_at: 1_850_000_000 }),
    });
    expect(await subscription(access, "sub_1")).toEqual({
      id: "sub_1",
      customerId: "cus_1",
      workspaceId: "ws_1",
      status: "active",
      seats: 3,
      priceId: "price_year",
      interval: "year",
      currentPeriodEnd: 1_800_000_000,
      cancelAtPeriodEnd: false,
    });
    expect(await subscription(access, "sub_2")).toMatchObject({ currentPeriodEnd: 1_850_000_000, cancelAtPeriodEnd: true });
    expect(await subscription(access, "sub_none")).toBeNull();
  });

  it("lists a customer's subscriptions that are not over, and ends one", async () => {
    const { access, calls } = stripe({
      "/v1/subscriptions?customer=cus_1&status=all&limit=20": {
        data: [sub("sub_1", "canceled"), sub("sub_2", "past_due"), sub("sub_3", "incomplete_expired")],
      },
      "/v1/subscriptions/sub_2": sub("sub_2", "past_due"),
    });
    expect((await liveSubscriptions(access, "cus_1")).map((x) => x.id)).toEqual(["sub_2"]);
    await cancel(access, "sub_2");
    expect(calls.at(-1)).toMatchObject({ method: "DELETE", url: "https://api.stripe.com/v1/subscriptions/sub_2" });
    // Already gone: fine
    await expect(cancel(access, "sub_x")).resolves.toBeUndefined();
  });

  it("closes a checkout left open, and says when it was paid already", async () => {
    const { access, calls } = stripe({
      "/v1/checkout/sessions/cs_open": { id: "cs_open", status: "open" },
      "/v1/checkout/sessions/cs_paid": { id: "cs_paid", status: "complete" },
    });
    expect(await closeCheckout(access, "cs_open")).toBe("closed");
    expect(calls.at(-1)).toMatchObject({ method: "POST", url: "https://api.stripe.com/v1/checkout/sessions/cs_open/expire" });
    expect(await closeCheckout(access, "cs_paid")).toBe("complete");
    expect(await closeCheckout(access, "cs_gone")).toBe("closed");
  });

  it("opens Checkout for the workspace, its seats and its people", async () => {
    let body = "";
    const fetch = (async (_url: string, init: RequestInit) => {
      body = String(init.body);
      return Response.json({ url: "https://checkout.stripe.com/c/pay/x" });
    }) as unknown as typeof globalThis.fetch;
    const r = await checkout(
      { secretKey: "sk_test", fetch },
      {
        workspaceId: "ws_1",
        priceId: "price_team",
        seats: 5,
        email: "owner@acme.com",
        successUrl: "https://app/ok",
        cancelUrl: "https://app/no",
      },
    );
    expect(r.url).toBe("https://checkout.stripe.com/c/pay/x");
    const f = new URLSearchParams(body);
    expect([
      f.get("mode"),
      f.get("line_items[0][quantity]"),
      f.get("client_reference_id"),
      f.get("subscription_data[metadata][workspaceId]"),
      f.get("customer_email"),
      f.get("automatic_tax[enabled]"),
      f.get("tax_id_collection[enabled]"),
    ]).toEqual(["subscription", "5", "ws_1", "ws_1", "owner@acme.com", "true", "true"]);
  });

  // A subscription as Stripe returns it, then what Ronde sent to change it
  const seatsChange = async (item: Record<string, unknown>, seats: number) => {
    const calls: { url: string; body: string }[] = [];
    const fetch = (async (url: string, init: RequestInit = {}) => {
      calls.push({ url, body: String(init.body ?? "") });
      return Response.json(calls.length === 1 ? { items: { data: [{ id: "si_1", quantity: 7, ...item }] } } : {});
    }) as unknown as typeof globalThis.fetch;
    const paid = await setSeats({ secretKey: "sk_test", fetch }, "sub_1", seats, NOW);
    const f = calls[1] ? new URLSearchParams(calls[1].body) : null;
    return { paid, sent: f && [f.get("items[0][id]"), f.get("items[0][quantity]"), f.get("proration_behavior")] };
  };
  const monthly = { price: { recurring: { interval: "month" } } };
  const yearly = (daysLeft: number) => ({
    price: { recurring: { interval: "year" } },
    current_period_end: NOW / 1000 + daysLeft * 86_400,
  });

  it("follows the people on a monthly plan, prorated", async () => {
    expect(await seatsChange(monthly, 9)).toEqual({ paid: 9, sent: ["si_1", "9", "create_prorations"] });
    expect(await seatsChange(monthly, 4)).toEqual({ paid: 4, sent: ["si_1", "4", "create_prorations"] });
    expect(await seatsChange(monthly, 7)).toEqual({ paid: 7, sent: null });
  });

  it("charges a seat more at once on a yearly plan, and takes a seat less off at the renewal", async () => {
    expect(await seatsChange(yearly(200), 9)).toEqual({ paid: 9, sent: ["si_1", "9", "always_invoice"] });
    expect(await seatsChange(yearly(200), 4)).toEqual({ paid: 7, sent: null });
    expect(await seatsChange(yearly(1), 4)).toEqual({ paid: 4, sent: ["si_1", "4", "none"] });
  });
});
