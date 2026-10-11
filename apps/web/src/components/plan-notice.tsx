import { EDITIONS, FEATURES, type FeatureId } from "@ronde/editions";
import { getTranslations } from "next-intl/server";
import { env } from "@/lib/server/env";
import { isCloud } from "@/lib/server/license";
import { Icon } from "./shell/icons";
import { NewTab } from "./shell/new-tab";

/** Features with a pitch of their own on their locked page */
const PITCHED = [
  "reporting.workspace",
  "reporting.portfolio",
  "compliance.auditLog",
  "permissions.customRoles",
  "identity.domainCapture",
] as const;

/**
 * A page of a paid feature the workspace does not have. Administrators see what the plan brings, what else
 * comes with it and where to get it (unless the suggestions are turned off); everyone else only whom to ask.
 */
export async function PlanNotice({ feature, plansUrl }: { feature: FeatureId; plansUrl: string | null }) {
  const t = await getTranslations("planNotice");
  const tm = await getTranslations("modules");
  const tf = await getTranslations("features");
  const label = (id: FeatureId) => tf(id as "identity.saml");
  const edition = FEATURES[feature].edition as "team" | "enterprise";
  const editionName = tm(`editions.${edition}`);
  // What else the plan brings: its own shipped features first
  const also = (Object.keys(FEATURES) as FeatureId[])
    .filter((id) => id !== feature && FEATURES[id].available && EDITIONS.indexOf(FEATURES[id].edition) === EDITIONS.indexOf(edition))
    .slice(0, 6);
  const pitch = (PITCHED as readonly string[]).includes(feature) ? t(`pitch.${feature.replace(".", "_") as "reporting_workspace"}`) : null;
  return (
    <section className={`plan-notice ${edition}`} aria-labelledby="plan-notice-title">
      <div className="plan-notice-art" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <div className="plan-notice-body">
        <span className="plan-pill">{t("badge", { edition: editionName })}</span>
        <h1 id="plan-notice-title">{label(feature)}</h1>
        {pitch && <p className="plan-notice-lead">{pitch}</p>}
        <p>{tm("upgrade.comesWith", { feature: label(feature), edition: editionName })}</p>
        {plansUrl ? (
          <>
            {also.length > 0 && (
              <>
                <h2>{t("also", { edition: editionName })}</h2>
                <ul className="plan-notice-list">
                  {also.map((id) => (
                    <li key={id}>{label(id)}</li>
                  ))}
                </ul>
              </>
            )}
            <div className="plan-notice-actions">
              <a
                data-umami-event="upgrade_click"
                data-umami-event-from="plan-notice"
                className="btn primary"
                href={plansUrl}
                {...(isCloud() ? {} : { target: "_blank", rel: "noopener" })}
              >
                {isCloud() ? t("upgrade", { edition: editionName }) : `${tm("upgrade.plans")} ↗`}
              </a>
              <a className="btn ghost" href={`${env.siteUrl()}/education`} target="_blank" rel="noopener">
                <Icon name="school" size={15} />
                {t("education")}
                <NewTab />
              </a>
            </div>
          </>
        ) : (
          <p className="hint">{t("askAdmin")}</p>
        )}
      </div>
    </section>
  );
}
