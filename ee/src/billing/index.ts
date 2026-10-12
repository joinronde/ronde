// Ronde Enterprise Edition. Copyright (c) Ronde. Licensed under the Ronde Enterprise License (see ee/LICENSE).
import { createHmac, timingSafeEqual } from "node:crypto";
import type { BillingAccess, BillingEvent, BillingSubscription, CheckoutInput, EnterpriseEdition } from "@ronde/editions/ee";

// Billing of the Ronde cloud with Stripe: Checkout to subscribe, the customer portal to manage, webhooks to
// learn what changed. The REST API is called directly; webhook signatures are checked with HMAC.

const API = "https://api.stripe.com/v1";
/** Webhooks older than this are refused (replays) */
const TOLERANCE_S = 300;

export class BillingError extends Error {}

/** Stripe takes form bodies with bracketed keys: line_items[0][price]=… */
function form(fields: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) p.set(k, String(v));
  return p.toString();
}

async function call(
  a: BillingAccess,
  path: string,
  fields: Record<string, string | number | boolean | undefined>,
  method: "POST" | "DELETE" = "POST",
) {
  const res = await (a.fetch ?? fetch)(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${a.secretKey}`, "content-type": "application/x-www-form-urlencoded" },
    body: form(fields),
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) throw new BillingError(body.error?.message ?? `Stripe answered ${res.status}`);
  return body;
}

/** A GET; null when Stripe does not know the object */
async function get(a: BillingAccess, path: string): Promise<(Record<string, unknown> & { data?: unknown[] }) | null> {
  const res = await (a.fetch ?? fetch)(`${API}${path}`, {
    headers: { authorization: `Bearer ${a.secretKey}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return null;
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) throw new BillingError(body.error?.message ?? `Stripe answered ${res.status}`);
  return body;
}

export async function customer(a: BillingAccess, i: { workspaceId: string; email: string }): Promise<string> {
  const r = await call(a, "/customers", { email: i.email, "metadata[workspaceId]": i.workspaceId });
  return String(r.id);
}

export async function checkout(a: BillingAccess, i: CheckoutInput): Promise<{ url: string; id: string }> {
  const r = await call(a, "/checkout/sessions", {
    mode: "subscription",
    "line_items[0][price]": i.priceId,
    "line_items[0][quantity]": Math.max(1, i.seats),
    client_reference_id: i.workspaceId,
    "metadata[workspaceId]": i.workspaceId,
    "subscription_data[metadata][workspaceId]": i.workspaceId,
    // A known customer keeps the name, address and VAT number entered here, which the tax needs
    ...(i.customerId
      ? { customer: i.customerId, "customer_update[name]": "auto", "customer_update[address]": "auto" }
      : { customer_email: i.email }),
    allow_promotion_codes: true,
    billing_address_collection: "required",
    "automatic_tax[enabled]": true,
    // A company's VAT number: reverse charge within the EU, and on the invoice
    "tax_id_collection[enabled]": true,
    success_url: i.successUrl,
    cancel_url: i.cancelUrl,
  });
  return { url: String(r.url), id: String(r.id) };
}

export async function closeCheckout(a: BillingAccess, sessionId: string): Promise<"complete" | "closed"> {
  const path = `/checkout/sessions/${encodeURIComponent(sessionId)}`;
  const session = await get(a, path);
  if (session?.status === "complete") return "complete";
  if (session?.status === "open") await call(a, `${path}/expire`, {});
  return "closed";
}

/** What Ronde keeps of a Stripe subscription */
function readSubscription(o: StripeObject): BillingSubscription {
  const item = o.items?.data?.[0];
  const cancelAt = typeof o.cancel_at === "number" ? o.cancel_at : null;
  const interval = item?.price?.recurring?.interval;
  return {
    id: String(o.id),
    customerId: typeof o.customer === "string" ? o.customer : null,
    workspaceId: o.metadata?.workspaceId ?? null,
    status: String(o.status ?? ""),
    seats: item?.quantity ?? 1,
    priceId: item?.price?.id ?? null,
    interval: interval === "month" || interval === "year" ? interval : null,
    // Set to end on a date: that date is when it ends
    currentPeriodEnd: cancelAt ?? o.current_period_end ?? item?.current_period_end ?? null,
    cancelAtPeriodEnd: !!o.cancel_at_period_end || cancelAt !== null,
  };
}

export async function subscription(a: BillingAccess, subscriptionId: string): Promise<BillingSubscription | null> {
  const o = await get(a, `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  return o ? readSubscription(o as StripeObject) : null;
}

/** Statuses of a subscription that is over */
const ENDED = ["canceled", "incomplete_expired"];

export async function liveSubscriptions(a: BillingAccess, customerId: string): Promise<BillingSubscription[]> {
  const r = await get(a, `/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=20`);
  return ((r?.data ?? []) as StripeObject[]).map(readSubscription).filter((x) => !ENDED.includes(x.status));
}

export async function cancel(a: BillingAccess, subscriptionId: string): Promise<void> {
  try {
    await call(a, `/subscriptions/${encodeURIComponent(subscriptionId)}`, {}, "DELETE");
  } catch (e) {
    // Already over: nothing left to end
    if (e instanceof BillingError && /canceled|No such subscription/i.test(e.message)) return;
    throw e;
  }
}

export async function portal(a: BillingAccess, i: { customerId: string; returnUrl: string }): Promise<{ url: string }> {
  const r = await call(a, "/billing_portal/sessions", { customer: i.customerId, return_url: i.returnUrl });
  return { url: String(r.url) };
}

/** Two days before a yearly renewal, fewer seats can go down for the coming year */
const RENEWAL_MS = 2 * 86_400_000;

export async function setSeats(a: BillingAccess, subscriptionId: string, seats: number, now = Date.now()): Promise<number> {
  // The subscription's first item carries the per-seat price
  const res = await (a.fetch ?? fetch)(`${API}/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    headers: { authorization: `Bearer ${a.secretKey}` },
    signal: AbortSignal.timeout(20_000),
  });
  const sub = (await res.json()) as {
    current_period_end?: number;
    items?: { data?: { id: string; quantity?: number; current_period_end?: number; price?: { recurring?: { interval?: string } } }[] };
  };
  const item = sub.items?.data?.[0];
  if (!res.ok || !item) throw new BillingError("subscription not found");
  const paid = item.quantity ?? 1;
  const want = Math.max(1, seats);
  if (want === paid) return paid;
  const update = (proration: string) =>
    call(a, `/subscriptions/${encodeURIComponent(subscriptionId)}`, {
      "items[0][id]": item.id,
      "items[0][quantity]": want,
      proration_behavior: proration,
    });
  // Monthly: the seats follow the people, prorated on the next invoice
  if (item.price?.recurring?.interval !== "year") {
    await update("create_prorations");
    return want;
  }
  // Yearly: a seat more is charged at once for what is left of the year; a seat less waits for the renewal
  if (want > paid) {
    await update("always_invoice");
    return want;
  }
  const end = (item.current_period_end ?? sub.current_period_end ?? 0) * 1000;
  if (end - now > RENEWAL_MS) return paid;
  await update("none");
  return want;
}

type StripeObject = Record<string, unknown> & {
  id?: string;
  object?: string;
  customer?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
  status?: string;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  current_period_end?: number;
  subscription?: string | { id?: string } | null;
  parent?: { subscription_details?: { subscription?: string | null } | null } | null;
  items?: {
    data?: { quantity?: number; current_period_end?: number; price?: { id?: string; recurring?: { interval?: string } } }[];
  };
  amount_paid?: number;
  currency?: string;
};

export function event(payload: string, signature: string, secret: string, now = Date.now()): BillingEvent | null {
  // Without a secret, anyone could sign
  if (!secret) return null;
  // Stripe-Signature: t=<timestamp>,v1=<hmac>[,v1=…]
  const parts = Object.fromEntries(
    signature
      .split(",")
      .map((kv) => kv.split("="))
      .filter((kv) => kv.length === 2)
      .map(([k, v]) => [k, v]),
  ) as Record<string, string>;
  const t = Number(parts.t);
  const sent = signature
    .split(",")
    .filter((kv) => kv.startsWith("v1="))
    .map((kv) => kv.slice(3));
  if (!t || !sent.length || Math.abs(now / 1000 - t) > TOLERANCE_S) return null;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  // Compared as bytes: a character beyond ASCII must not make two lengths differ there and throw
  const ok = sent.some((s) => Buffer.byteLength(s) === expected.length && timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) return null;
  let e: { id: string; type: string; data?: { object?: StripeObject } };
  try {
    e = JSON.parse(payload);
  } catch {
    return null;
  }
  const o = e.data?.object ?? {};
  // The subscription the event is about: itself, or the one a checkout or an invoice belongs to
  const ref = o.object === "subscription" ? o.id : (o.subscription ?? o.parent?.subscription_details?.subscription);
  const subscriptionId = typeof ref === "string" ? ref : (ref?.id ?? null);
  return {
    id: e.id,
    type: e.type,
    workspaceId: o.metadata?.workspaceId ?? o.client_reference_id ?? null,
    customerId: typeof o.customer === "string" ? o.customer : null,
    subscriptionId: subscriptionId || null,
    payment:
      o.object === "invoice" && e.type === "invoice.paid"
        ? { amount: Number(o.amount_paid ?? 0) / 100, currency: String(o.currency ?? "eur").toUpperCase() }
        : null,
  };
}

export const billing: EnterpriseEdition["billing"] = {
  customer,
  checkout,
  closeCheckout,
  subscription,
  liveSubscriptions,
  cancel,
  portal,
  event,
  setSeats,
};
