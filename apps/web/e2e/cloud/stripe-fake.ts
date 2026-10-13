import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";

// A fake Stripe for the browser tests of billing: the few API calls Ronde makes (customers, Checkout, the
// customer portal, subscriptions), a checkout page with a "Pay" button and a portal with a "Cancel" button. Paying
// or cancelling sends the app the signed webhook Stripe would. The server reaches it through STRIPE_API_BASE.

export const STRIPE_PORT = Number(process.env.E2E_STRIPE_PORT ?? 12111);
export const STRIPE_WEBHOOK_SECRET = "whsec_e2e_fake";

type Sub = { id: string; customer: string; workspaceId: string; price: string; quantity: number; status: string };
type Checkout = {
  id: string;
  status: "open" | "complete" | "expired";
  customer: string;
  workspaceId: string;
  price: string;
  quantity: number;
  successUrl: string;
  cancelUrl: string;
};

const DAY = 86_400;

/** A body signed as Stripe signs its webhooks: Stripe-Signature t=…,v1=HMAC(secret, "t.body") */
export function signed(payload: string, secret = STRIPE_WEBHOOK_SECRET) {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;
}

const read = (req: IncomingMessage) =>
  new Promise<string>((ok) => {
    let b = "";
    req.on("data", (c) => {
      b += c;
    });
    req.on("end", () => ok(b));
  });

const page = (title: string, body: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`;

export function startFakeStripe() {
  const subs = new Map<string, Sub>();
  const checkouts = new Map<string, Checkout>();
  const calls: string[] = [];
  let n = 0;
  // Unique across runs: the test database keeps the customers of earlier runs
  const run = Date.now().toString(36);
  const id = (prefix: string) => `${prefix}_${run}${++n}`;

  const subObject = (s: Sub) => ({
    id: s.id,
    object: "subscription",
    customer: s.customer,
    status: s.status,
    metadata: { workspaceId: s.workspaceId },
    current_period_end: Math.floor(Date.now() / 1000) + 30 * DAY,
    cancel_at_period_end: false,
    items: {
      data: [
        {
          id: `si_${s.id}`,
          quantity: s.quantity,
          price: { id: s.price, recurring: { interval: s.price.endsWith("yearly") ? "year" : "month" } },
        },
      ],
    },
  });

  /** Sends the app the event Stripe would, signed, at the origin it gave as its return address */
  async function webhook(appUrl: string, type: string, object: object) {
    const payload = JSON.stringify({ id: id("evt"), type, data: { object } });
    const res = await fetch(new URL("/api/billing/webhook", appUrl), {
      method: "POST",
      headers: { "content-type": "application/json", "stripe-signature": signed(payload) },
      body: payload,
    });
    if (!res.ok) throw new Error(`webhook ${type} answered ${res.status}`);
  }

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${STRIPE_PORT}`);
    const body = new URLSearchParams(req.method === "GET" ? "" : await read(req));
    const json = (status: number, o: object) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(o));
    };
    const html = (h: string) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(h);
    };
    const redirect = (to: string) => {
      res.writeHead(303, { location: to });
      res.end();
    };
    const p = url.pathname;
    calls.push(`${req.method} ${p}`);
    try {
      // The API, as Ronde calls it
      if (p.startsWith("/v1/") && req.headers.authorization !== "Bearer sk_test_fake")
        return json(401, { error: { message: "Invalid API key" } });
      if (req.method === "POST" && p === "/v1/customers") return json(200, { id: id("cus") });
      if (req.method === "POST" && p === "/v1/checkout/sessions") {
        const c: Checkout = {
          id: id("cs"),
          status: "open",
          customer: body.get("customer") ?? id("cus"),
          workspaceId: body.get("metadata[workspaceId]") ?? "",
          price: body.get("line_items[0][price]") ?? "",
          quantity: Number(body.get("line_items[0][quantity]") ?? 1),
          successUrl: body.get("success_url") ?? "",
          cancelUrl: body.get("cancel_url") ?? "",
        };
        checkouts.set(c.id, c);
        return json(200, { id: c.id, url: `http://127.0.0.1:${STRIPE_PORT}/pay/${c.id}` });
      }
      const cs = p.match(/^\/v1\/checkout\/sessions\/([^/]+)(\/expire)?$/);
      if (cs) {
        const c = checkouts.get(cs[1]!);
        if (!c) return json(404, { error: { message: "No such checkout session" } });
        if (cs[2]) c.status = "expired";
        return json(200, { id: c.id, status: c.status });
      }
      if (req.method === "GET" && p === "/v1/subscriptions")
        return json(200, { data: [...subs.values()].filter((s) => s.customer === url.searchParams.get("customer")).map(subObject) });
      const sub = p.match(/^\/v1\/subscriptions\/([^/]+)$/);
      if (sub) {
        const s = subs.get(sub[1]!);
        if (!s) return json(404, { error: { message: "No such subscription" } });
        if (req.method === "DELETE") s.status = "canceled";
        if (req.method === "POST" && body.has("items[0][quantity]")) s.quantity = Number(body.get("items[0][quantity]"));
        return json(200, subObject(s));
      }
      if (req.method === "POST" && p === "/v1/billing_portal/sessions") {
        const back = encodeURIComponent(body.get("return_url") ?? "");
        return json(200, { url: `http://127.0.0.1:${STRIPE_PORT}/portal/${body.get("customer")}?return=${back}` });
      }

      // The pages a person sees at Stripe
      const pay = p.match(/^\/pay\/([^/]+)$/);
      if (pay) {
        const c = checkouts.get(pay[1]!);
        if (!c || c.status !== "open") return html(page("Checkout expired", ""));
        if (req.method === "GET")
          return html(
            page(
              "Fake Stripe Checkout",
              `<p>${c.quantity} × ${c.price}</p><form method="post"><button>Pay</button></form><a href="${c.cancelUrl}">Back</a>`,
            ),
          );
        const s: Sub = {
          id: id("sub"),
          customer: c.customer,
          workspaceId: c.workspaceId,
          price: c.price,
          quantity: c.quantity,
          status: "active",
        };
        subs.set(s.id, s);
        c.status = "complete";
        await webhook(c.successUrl, "checkout.session.completed", {
          id: c.id,
          object: "checkout.session",
          customer: c.customer,
          subscription: s.id,
          client_reference_id: c.workspaceId,
          metadata: { workspaceId: c.workspaceId },
        });
        return redirect(c.successUrl);
      }
      const portal = p.match(/^\/portal\/([^/]+)$/);
      if (portal) {
        const back = url.searchParams.get("return") ?? "";
        const live = [...subs.values()].filter((s) => s.customer === portal[1] && s.status !== "canceled");
        if (req.method === "GET")
          return html(
            page(
              "Fake Stripe portal",
              `<p>${live.length} subscription(s)</p><form method="post"><button>Cancel the subscription</button></form><a href="${back}">Return to Ronde</a>`,
            ),
          );
        for (const s of live) {
          s.status = "canceled";
          await webhook(back, "customer.subscription.deleted", subObject(s));
        }
        return redirect(back);
      }
      return json(404, { error: { message: `Unknown path ${p}` } });
    } catch (e) {
      return json(500, { error: { message: String(e) } });
    }
  });

  return {
    calls,
    subs,
    listen: () => new Promise<void>((ok) => server.listen(STRIPE_PORT, "127.0.0.1", () => ok())),
    close: () => new Promise<void>((ok) => server.close(() => ok())),
  };
}
