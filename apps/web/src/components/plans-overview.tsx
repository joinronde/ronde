import { type Edition, FEATURES, type Feature, type FeatureId } from "@ronde/editions";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/server/env";
import { isCloud } from "@/lib/server/license";
import { Icon } from "./shell/icons";
import { NewTab } from "./shell/new-tab";

const PAID = ["team", "enterprise"] as const;

/** What each paid plan adds, from the shipped features; the workspace's own plan is marked */
export async function PlansOverview({ edition, plansUrl }: { edition: Edition; plansUrl: string }) {
  const t = await getTranslations("plansPage");
  const tm = await getTranslations("modules");
  const tn = await getTranslations("planNotice");
  const tf = await getTranslations("features");
  // What the cloud cannot offer (a self-hosted server's own Teams app) is left out there
  const cloud = isCloud();
  const features = (plan: (typeof PAID)[number]) =>
    (Object.keys(FEATURES) as FeatureId[]).filter((id) => {
      const f: Feature = FEATURES[id];
      return f.available && f.edition === plan && !(cloud && f.selfHostedOnly);
    });
  return (
    <section className="plans-overview" aria-labelledby="plans-title">
      <h2 id="plans-title">{t("title")}</h2>
      <p className="muted">{t("intro")}</p>
      <div className="plans-cards">
        {PAID.map((plan) => (
          <article key={plan} className={`plan-card ${plan}`} aria-current={edition === plan ? "true" : undefined}>
            <header>
              <h3>{tm(`editions.${plan}`)}</h3>
              {edition === plan && <span className="pill">{t("current")}</span>}
            </header>
            <p className="hint">{plan === "team" ? t("teamLead") : t("enterpriseLead")}</p>
            <ul>
              {features(plan).map((id) => (
                <li key={id}>
                  <Icon name="check" size={14} /> {tf(id as "identity.saml")}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <div className="plan-notice-actions">
        <a
          data-umami-event="upgrade_click"
          data-umami-event-from="plans-overview"
          className="btn primary"
          href={plansUrl}
          target="_blank"
          rel="noopener"
        >
          {tm("upgrade.plans")}
          <NewTab />
        </a>
        <a className="btn ghost" href={`${env.siteUrl()}/education`} target="_blank" rel="noopener">
          <Icon name="school" size={15} />
          {tn("education")}
          <NewTab />
        </a>
      </div>
      <p className="hint">{t("license")}</p>
    </section>
  );
}
