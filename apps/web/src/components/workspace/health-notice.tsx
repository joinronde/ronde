import { useTranslations } from "next-intl";
import { NewTab } from "../shell/new-tab";

/**
 * Under a template for care teams, in Ronde's cloud: no identifiable patient data there, and where to read how to
 * host Ronde oneself (the free edition: nothing is sold here)
 */
export function HealthDataNotice({ guide }: { guide: string }) {
  const t = useTranslations("gallery");
  return (
    <p className="hint warn">
      {t("healthNotice")}{" "}
      <a className="link" href={guide} target="_blank" rel="noopener">
        {t("healthGuide")}
        <NewTab />
      </a>
    </p>
  );
}
