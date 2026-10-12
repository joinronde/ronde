import "server-only";
import { grantRuns, PAYING_STATUSES, Prisma, prisma, refreshPlan } from "@ronde/db";
import type { BillingEvent, BillingSubscription } from "@ronde/editions/ee";
import { enterprise } from "@/ee-bridge";
import type { WorkspaceContext } from "./authz";
import { env } from "./env";
import { AccessError, OpError } from "./errors";
import { isCloud } from "./license";
import { publicUrl } from "./public-url";
import { umamiEvent } from "./umami";

// Billing of the Ronde cloud (Stripe): a workspace subscribes to Team, monthly or yearly, for the people who
// took part in its meetings; Stripe's webhooks keep its plan. Self-hosted instances have no billing: their
// license decides.

// Without the webhook's secret Ronde would never learn about payments: billing stays off
export const billingOn = () => isCloud() && !!env.stripeSecretKey() && !!env.stripePriceTeam() && !!env.stripeWebhookSecret();

const access = () => ({ secretKey: env.stripeSecretKey() });

/** Statuses that keep the Team plan: paying, trying it, or a payment being retried */
const PAYING = PAYING_STATUSES;
/** Statuses of a subscription that is over: a new one may start */
const ENDED = ["canceled", "incomplete_expired"];
const live = (s: { subscriptionId: string | null; status: string } | null) => !!s?.subscriptionId && !ENDED.includes(s.status);

/** The plan a price brings: only the prices Ronde sells (another one is not taken for Team) */
function planOfPrice(priceId: string | null): string | null {
  return priceId && [env.stripePriceTeam(), env.stripePriceTeamYearly()].includes(priceId) ? "team" : null;
}

/** How far back taking part in a meeting counts */
const ACTIVE_DAYS = 30;

type SessionSeen = {
  startedAt: Date | null;
  order: string[];
  absent: string[];
  spent: unknown;
  record: unknown;
};

/**
 * Who took part in a session: in a live one, the people of its round who were there (not absent; when turns
 * were timed, the ones who had a turn or wrote something); in an async one, the people who wrote their check-in.
 * Observers are never in the round.
 */
export function tookPart(s: SessionSeen): string[] {
  const r = (s.record ?? null) as {
    participants?: { id: string }[];
    absent?: { id: string }[];
    spent?: Record<string, number>;
    checkIns?: Record<string, { items?: unknown[] }>;
  } | null;
  const wrote = new Set(
    Object.entries(r?.checkIns ?? {})
      .filter(([, c]) => (c.items?.length ?? 0) > 0)
      .map(([id]) => id),
  );
  if (!s.startedAt) return [...wrote];
  const round = r?.participants ? r.participants.map((p) => p.id) : s.order;
  const away = new Set(r?.absent ? r.absent.map((p) => p.id) : s.absent);
  const spent = (r?.spent ?? s.spent ?? {}) as Record<string, number>;
  const present = round.filter((id) => !away.has(id));
  const timed = present.some((id) => (spent[id] ?? 0) > 0);
  return timed ? present.filter((id) => (spent[id] ?? 0) > 0 || wrote.has(id)) : present;
}

/**
 * People who count as seats: the people of the workspace who took part in one of its sessions in the last 30
 * days (see tookPart), counted once. Someone invited who never came, or away for the month, costs nothing.
 */
export async function activeSeats(workspaceId: string, now = Date.now()): Promise<number> {
  const since = new Date(now - ACTIVE_DAYS * 86_400_000);
  const sessions = await prisma.session.findMany({
    where: {
      workspaceId,
      // A session of the sample meeting costs nothing
      meeting: { sample: false },
      // Live sessions by when they started, async ones by when they were published
      OR: [
        { startedAt: { gte: since, lte: new Date(now) } },
        { startedAt: null, status: "archived", archivedAt: { gte: since, lte: new Date(now) } },
      ],
    },
    select: { startedAt: true, order: true, absent: true, spent: true, record: true },
  });
  const people = new Set(sessions.flatMap(tookPart));
  if (!people.size) return 0;
  return prisma.person.count({ where: { workspaceId, id: { in: [...people] } } });
}

/** How often a workspace pays: every month, or every year for a lower price */
export type BillingInterval = "month" | "year";

export interface BillingView {
  plan: string;
  /** Where the plan comes from: a subscription, or the Ronde team (education, a gesture, a trial) */
  source: "subscription" | "grant" | null;
  /** The end of the plan given by the Ronde team, when it ends */
  grantEndsAt: string | null;
  /** Given by the Ronde team for education */
  education: boolean;
  status: string | null;
  seats: number;
  activeSeats: number;
  interval: BillingInterval | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
  /** The yearly price is offered */
  yearly: boolean;
}

export async function billingView(ctx: WorkspaceContext): Promise<BillingView> {
  const now = new Date();
  const [sub, seats, grants] = await Promise.all([
    ctx.db.subscription.findFirst(),
    activeSeats(ctx.workspace.id),
    prisma.planGrant.findMany({ where: { workspaceId: ctx.workspace.id } }),
  ]);
  const running = grants.filter((g) => grantRuns(g, now));
  const paying = !!sub?.subscriptionId && PAYING.includes(sub.status);
  const grant = running.find((g) => g.plan === ctx.workspace.plan);
  return {
    plan: ctx.workspace.plan,
    source: paying && sub?.plan === ctx.workspace.plan ? "subscription" : grant ? "grant" : null,
    grantEndsAt: grant?.endsAt?.toISOString() ?? null,
    education: running.some((g) => g.reason === "education"),
    status: sub?.subscriptionId ? sub.status : null,
    seats: sub?.seats ?? 0,
    activeSeats: seats,
    interval: sub?.interval === "year" ? "year" : sub?.interval === "month" ? "month" : null,
    currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: !!sub?.cancelAtPeriodEnd,
    hasCustomer: !!sub?.subscriptionId,
    yearly: !!env.stripePriceTeamYearly(),
  };
}

function requireBilling(ctx: WorkspaceContext) {
  if (!billingOn()) throw new AccessError(403, "featureNotInPlan");
  if (!ctx.can("workspace.billing")) throw new AccessError(403, "accessDenied");
}

/** One billing change of a workspace at a time (two clicks, two owners, a webhook) */
async function withBillingLock<T>(workspaceId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:${workspaceId}`}))`;
      return fn(tx);
    },
    { timeout: 90_000, maxWait: 30_000 },
  );
}

/**
 * Stripe Checkout for the Team plan, monthly or yearly, with as many seats as active people (one at least).
 * One subscription per workspace: refused while one is not over (even one Ronde has not heard of yet), and the
 * Checkout page opened before is closed.
 */
export async function startCheckout(ctx: WorkspaceContext, interval: BillingInterval = "month"): Promise<string> {
  requireBilling(ctx);
  const priceId = interval === "year" ? env.stripePriceTeamYearly() : env.stripePriceTeam();
  if (!priceId) throw new OpError("notFound");
  const workspaceId = ctx.workspace.id;
  const page = await publicUrl(`/w/${ctx.workspace.slug}/settings/billing`);
  const seats = await activeSeats(workspaceId);
  const { url, adopted } = await withBillingLock(workspaceId, async (tx) => {
    const sub = await tx.subscription.findUnique({ where: { workspaceId } });
    if (live(sub)) throw new OpError("alreadySubscribed");
    // The workspace's own customer, made once: whatever happens, its subscriptions are found by it
    const customerId = sub?.customerId ?? (await enterprise.billing.customer(access(), { workspaceId, email: ctx.user.email }));
    if (!sub) await tx.subscription.create({ data: { workspaceId, customerId } });
    // A subscription Stripe has but Ronde missed (a webhook still on its way): taken, not doubled
    const other = (await enterprise.billing.liveSubscriptions(access(), customerId))[0];
    if (other) return { url: null, adopted: other };
    if (sub?.checkoutSessionId && (await enterprise.billing.closeCheckout(access(), sub.checkoutSessionId)) === "complete")
      throw new OpError("subscriptionStarting");
    const session = await enterprise.billing.checkout(access(), {
      workspaceId,
      priceId,
      seats,
      email: ctx.user.email,
      customerId,
      successUrl: `${page}?checkout=done`,
      cancelUrl: `${page}?checkout=cancelled`,
    });
    await tx.subscription.update({ where: { workspaceId }, data: { checkoutSessionId: session.id } });
    return { url: session.url, adopted: null };
  });
  if (adopted) {
    await keepSubscription(workspaceId, adopted);
    throw new OpError("alreadySubscribed");
  }
  return url!;
}

/** Stripe's customer portal: invoices, payment method, cancellation */
export async function openPortal(ctx: WorkspaceContext): Promise<string> {
  requireBilling(ctx);
  const sub = await ctx.db.subscription.findFirst();
  if (!sub?.subscriptionId) throw new OpError("notFound");
  const { url } = await enterprise.billing.portal(access(), {
    customerId: sub.customerId,
    returnUrl: await publicUrl(`/w/${ctx.workspace.slug}/settings/billing`),
  });
  return url;
}

/**
 * A Stripe webhook: checked, counted once (Stripe sends again until it gets an answer), then the
 * subscription of its workspace and the workspace's plan follow. Returns the HTTP status to answer.
 */
export async function handleWebhook(payload: string, signature: string): Promise<number> {
  if (!billingOn()) return 404;
  const e = enterprise.billing.event(payload, signature, env.stripeWebhookSecret());
  if (!e) return 400;
  try {
    await prisma.stripeEvent.create({ data: { id: e.id, type: e.type } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return 200;
    throw err;
  }
  try {
    await applyEvent(e);
  } catch (err) {
    // Not taken into account: forgotten, so that Stripe's next try counts
    await prisma.stripeEvent.delete({ where: { id: e.id } }).catch(() => {});
    throw err;
  }
  return 200;
}

async function applyEvent(e: BillingEvent) {
  // Which workspace: its known customer, or the metadata Ronde put on the checkout and the subscription
  const known = e.customerId ? await prisma.subscription.findUnique({ where: { customerId: e.customerId } }) : null;
  const workspaceId = known?.workspaceId ?? e.workspaceId ?? null;
  if (!workspaceId || !(await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } }))) return;

  // A paid invoice, first or renewed: the revenue of the audience measure (the webhook must send invoice.paid)
  if (e.payment && e.payment.amount > 0)
    await umamiEvent("payment", { revenue: e.payment.amount, currency: e.payment.currency }, "/settings/billing");

  if (!e.subscriptionId) return;
  // The subscription as Stripe has it now: events come in any order, a late one tells nothing older
  const s = await enterprise.billing.subscription(access(), e.subscriptionId);
  if (s) await keepSubscription(workspaceId, s);
  else if (e.type === "customer.subscription.deleted")
    await prisma.subscription.updateMany({ where: { workspaceId, subscriptionId: e.subscriptionId }, data: { status: "canceled" } });
  await refreshPlan(workspaceId);
}

/** Records a subscription as the workspace's, unless another one not over already is */
async function keepSubscription(workspaceId: string, s: BillingSubscription) {
  await withBillingLock(workspaceId, async (tx) => {
    const row = await tx.subscription.findUnique({ where: { workspaceId } });
    if (row?.subscriptionId && row.subscriptionId !== s.id && live(row)) {
      if (!ENDED.includes(s.status))
        console.error(`[billing] workspace ${workspaceId}: subscription ${s.id} besides ${row.subscriptionId}, left to the team`);
      return;
    }
    const plan = planOfPrice(s.priceId);
    if (!plan) console.error(`[billing] subscription ${s.id}: price ${s.priceId} is not one Ronde sells`);
    const data = {
      subscriptionId: s.id,
      status: s.status,
      plan: plan ?? "community",
      seats: s.seats,
      interval: s.interval,
      currentPeriodEnd: s.currentPeriodEnd ? new Date(s.currentPeriodEnd * 1000) : null,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
      checkoutSessionId: null,
    };
    if (row) await tx.subscription.update({ where: { workspaceId }, data });
    else if (s.customerId) await tx.subscription.create({ data: { workspaceId, customerId: s.customerId, ...data } });
  });
  await refreshPlan(workspaceId);
}

/** The workspace is deleted: its subscription ends now (refused, the deletion waits: nobody pays for nothing) */
export async function endSubscription(workspaceId: string): Promise<void> {
  const sub = await prisma.subscription.findUnique({ where: { workspaceId } });
  if (!live(sub)) return;
  if (!billingOn()) throw new OpError("billingUnreachable");
  try {
    await enterprise.billing.cancel(access(), sub!.subscriptionId!);
  } catch (e) {
    console.error(`[billing] ending the subscription of workspace ${workspaceId}`, e);
    throw new OpError("billingUnreachable");
  }
  await prisma.subscription.update({ where: { workspaceId }, data: { status: "canceled", cancelAtPeriodEnd: false } });
  await refreshPlan(workspaceId);
}

/** Every day: the paid seats follow the active people of each subscribed workspace (yearly: see setSeats) */
export async function syncSeats(): Promise<number> {
  if (!billingOn()) return 0;
  const subs = await prisma.subscription.findMany({
    where: { status: { in: PAYING }, subscriptionId: { not: null }, workspace: { deletedAt: null } },
  });
  let changed = 0;
  for (const s of subs) {
    const seats = Math.max(1, await activeSeats(s.workspaceId));
    if (seats === s.seats) continue;
    try {
      const paid = await enterprise.billing.setSeats(access(), s.subscriptionId!, seats);
      if (paid === s.seats) continue;
      await prisma.subscription.update({ where: { workspaceId: s.workspaceId }, data: { seats: paid } });
      changed++;
    } catch (e) {
      console.error(`[billing] seats of workspace ${s.workspaceId}`, e);
    }
  }
  return changed;
}
