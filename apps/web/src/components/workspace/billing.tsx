"use client";

import { formatters, type Locale } from "@ronde/i18n";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { billingPortalAction, checkoutAction } from "@/app/w/[ws]/actions";
import { FormAlert } from "@/components/auth/fields";
import type { BillingView as Billing } from "@/lib/server/billing";
import { track } from "@/lib/shared/track";
import { NewTab } from "../shell/new-tab";

/**
 * The plan of the workspace in the cloud: Community for free, Team per person who took part in a meeting in the
 * last 30 days, monthly or yearly, paid with Stripe
 */
export function BillingView({
  slug,
  billing: b,
  checkout,
  siteUrl,
}: {
  slug: string;
  billing: Billing;
  checkout: string | null;
  siteUrl: string;
}) {
  const t = useTranslations("billing");
  const fmt = formatters(useLocale() as Locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const team = b.plan === "team" || b.plan === "enterprise";
  const paid = b.source === "subscription";
  // A plan given by the Ronde team for a while (a trial): it can be paid for before it ends
  const canPay = !paid && (!team || (b.source === "grant" && !!b.grantEndsAt && !b.education));
  // Back from Stripe with the subscription paid
  useEffect(() => {
    if (checkout === "done") track("subscription_started");
  }, [checkout]);
  const go = async (action: () => Promise<{ ok: true; data: string } | { ok: false; error: string }>) => {
    setBusy(true);
    const res = await action();
    if (!res.ok) {
      setBusy(false);
      return setError(res.error);
    }
    window.location.assign(res.data);
  };
  return (
    <div className="stack billing">
      {checkout === "done" && <p className="note-box ok">{t("thanks")}</p>}
      {checkout === "cancelled" && <p className="note-box">{t("cancelled")}</p>}
      <FormAlert>{error}</FormAlert>
      <section className={`panel billing-plan${team ? " team" : ""}`} aria-labelledby="plan-title">
        <p className="lbl-s">{t("current")}</p>
        <h2 id="plan-title">{t(`plans.${b.plan === "enterprise" ? "enterprise" : team ? "team" : "community"}`)}</h2>
        <p className="muted">{!team ? t("communityIntro") : paid ? t("teamIntro") : b.education ? t("grantedEducation") : t("granted")}</p>
        {canPay && b.source === "grant" && b.grantEndsAt && (
          <p className="hint">{t("grantEnds", { date: fmt.date(b.grantEndsAt.slice(0, 10)) })}</p>
        )}
        {paid && b.status && (
          <dl className="billing-facts">
            <dt>{t("status")}</dt>
            <dd>
              {t(`statuses.${["active", "trialing", "past_due", "canceled"].includes(b.status) ? b.status : "other"}` as "statuses.active")}
            </dd>
            <dt>{t("seats")}</dt>
            <dd>{t("seatsValue", { paid: b.seats, active: b.activeSeats })}</dd>
            {b.currentPeriodEnd && (
              <>
                <dt>{b.cancelAtPeriodEnd ? t("endsOn") : t("renewsOn")}</dt>
                <dd>{fmt.date(b.currentPeriodEnd.slice(0, 10))}</dd>
              </>
            )}
          </dl>
        )}
        <div className="controls">
          {canPay && (
            <>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                aria-busy={busy}
                onClick={() => {
                  track("checkout_started", { interval: "month" });
                  void go(() => checkoutAction(slug, "month"));
                }}
              >
                {t("upgradeMonthly")}
              </button>
              {b.yearly && (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    track("checkout_started", { interval: "year" });
                    void go(() => checkoutAction(slug, "year"));
                  }}
                >
                  {t("upgradeYearly")}
                </button>
              )}
            </>
          )}
          {b.hasCustomer && (
            <button type="button" className="btn" disabled={busy} onClick={() => void go(() => billingPortalAction(slug))}>
              {t("portal")}
            </button>
          )}
          <a className="link" href={`${siteUrl}/pricing`} target="_blank" rel="noopener">
            {t("compare")}
            <NewTab />
          </a>
        </div>
        {canPay && <p className="hint">{t("seatsHint", { count: b.activeSeats })}</p>}
      </section>
      {!b.education && (
        <section className="panel billing-edu" aria-labelledby="edu-title">
          <h2 id="edu-title">🎓 {t("eduTitle")}</h2>
          <p className="muted">{t("eduText")}</p>
          <a className="btn" href={`${siteUrl}/education`} target="_blank" rel="noopener">
            {t("eduCta")}
            <NewTab />
          </a>
        </section>
      )}
    </div>
  );
}
