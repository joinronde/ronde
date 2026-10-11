import { useTranslations } from "next-intl";
import { Icon } from "./icons";

/** Marks a link that opens in a new tab: the external icon for the eyes, the same news for screen readers */
export function NewTab({ size = 13 }: { size?: number }) {
  const t = useTranslations("app");
  return (
    <>
      <Icon name="external" size={size} />
      <span className="sr-only">{t("newTab")}</span>
    </>
  );
}
