import "server-only";
import { PAYING_STATUSES, Prisma, prisma, refreshPlan } from "@ronde/db";
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

export const billingOn = () => isCloud() && !!env.stripeSecretKey() && !!env.stripePriceTeam();

const access = () => ({ secretKey: env.stripeSecretKey() });

/** Statuses that keep the Team plan: paying, trying it, or a payment being retried */
const PAYING = PAYING_STATUSES;

/** How far back taking part in a meeting counts */
const ACTIVE_DAYS = 30;

/**
 * People who count as seats: the members who took part in a session of the workspace in the last 30 days,
 * present at it (not marked absent). Someone invited who never came, or away for the month, costs nothing.
 */
export async function activeSeats(workspaceId: string, now = Date.now()): Promise<number> {
  const sessions = await prisma.session.findMany({
    // A session of the sample meeting costs nothing
    where: { workspaceId, startedAt: { gte: new Date(now - ACTIVE_DAYS * 86_400_000) }, meeting: { sample: false } },
    select: { absent: true, meeting: { select: { participants: { select: { personId: true } } } } },
  });
  const present = new Set(sessions.flatMap((x) => x.meeting.participants.map((p) => p.personId).filter((id) => !x.absent.includes(id))));
  if (!present.size) return 0;
  return prisma.workspaceMember.count({ where: { workspaceId, status: "active", personId: { in: [...present] } } });
}

/** How often a workspace pays: every month, or every year for a lower price */
export type BillingInterval = "month" | "year";

export interface BillingView {
  plan: string;
  status: string | null;
  seats: number;
  activeSeats: number;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  hasCustomer: boolean;
  /** The yearly price is offered */
  yearly: boolean;
}

export async function billingView(ctx: WorkspaceContext): Promise<BillingView> {
  const [sub, seats] = await Promise.all([ctx.db.subscription.findFirst(), activeSeats(ctx.workspace.id)]);
  return {
    plan: ctx.workspace.plan,
    status: sub?.status ?? null,
    seats: sub?.seats ?? 0,
    activeSeats: seats,
    currentPeriodEnd: sub?.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: !!sub?.cancelAtPeriodEnd,
    hasCustomer: !!sub?.customerId,
    yearly: !!env.stripePriceTeamYearly(),
  };
}

function requireBilling(ctx: WorkspaceContext) {
  if (!billingOn()) throw new AccessError(403, "featureNotInPlan");
  if (!ctx.can("workspace.manage")) throw new AccessError(403, "accessDenied");
}

/** Stripe Checkout for the Team plan, monthly or yearly, with as many seats as active people (one at least) */
export async function startCheckout(ctx: WorkspaceContext, interval: BillingInterval = "month"): Promise<string> {
  requireBilling(ctx);
  const priceId = interval === "year" ? env.stripePriceTeamYearly() : env.stripePriceTeam();
  if (!priceId) throw new OpError("notFound");
  const sub = await ctx.db.subscription.findFirst();
  if (sub && PAYING.includes(sub.status)) throw new OpError("alreadySubscribed");
  const page = await publicUrl(`/w/${ctx.workspace.slug}/settings/billing`);
  const { url } = await enterprise.billing.checkout(access(), {
    workspaceId: ctx.workspace.id,
    priceId,
    seats: await activeSeats(ctx.workspace.id),
    email: ctx.user.email,
    ...(sub?.customerId ? { customerId: sub.customerId } : {}),
    successUrl: `${page}?checkout=done`,
    cancelUrl: `${page}?checkout=cancelled`,
  });
  return url;
}

/** Stripe's customer portal: invoices, payment method, cancellation */
export async function openPortal(ctx: WorkspaceContext): Promise<string> {
  requireBilling(ctx);
  const sub = await ctx.db.subscription.findFirst();
  if (!sub?.customerId) throw new OpError("notFound");
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
  // Which workspace: the metadata Ronde put on the checkout and the subscription, or the known customer
  const known = e.customerId ? await prisma.subscription.findUnique({ where: { customerId: e.customerId } }) : null;
  const workspaceId = e.workspaceId ?? known?.workspaceId ?? null;
  if (!workspaceId || !(await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } }))) return 200;

  if (e.type === "checkout.session.completed" && e.customerId)
    await prisma.subscription.upsert({
      where: { workspaceId },
      create: { workspaceId, customerId: e.customerId },
      update: { customerId: e.customerId },
    });

  // A paid invoice, first or renewed: the revenue of the audience measure (the webhook must send invoice.paid)
  if (e.payment && e.payment.amount > 0)
    await umamiEvent("payment", { revenue: e.payment.amount, currency: e.payment.currency }, "/settings/billing");

  if (e.subscription && e.customerId) {
    const s = e.subscription;
    const status = e.type === "customer.subscription.deleted" ? "canceled" : s.status;
    const data = {
      customerId: e.customerId,
      subscriptionId: s.id,
      status,
      plan: "team",
      seats: s.seats,
      currentPeriodEnd: s.currentPeriodEnd ? new Date(s.currentPeriodEnd * 1000) : null,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    };
    await prisma.subscription.upsert({ where: { workspaceId }, create: { workspaceId, ...data }, update: data });
    // The plan follows the subscription, unless the Ronde team granted a higher one (education, a gesture…)
    await refreshPlan(workspaceId);
  }
  return 200;
}

/** Every day: the paid seats follow the active people of each subscribed workspace (yearly: see setSeats) */
export async function syncSeats(): Promise<number> {
  if (!billingOn()) return 0;
  const subs = await prisma.subscription.findMany({ where: { status: { in: PAYING }, subscriptionId: { not: null } } });
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
