import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkout, event, setSeats } from "../src/billing";

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
      subscription: {
        id: "sub_1",
        status: "active",
        seats: 7,
        priceId: "price_team",
        currentPeriodEnd: 1_800_000_000,
        cancelAtPeriodEnd: false,
      },
      payment: null,
    });
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
