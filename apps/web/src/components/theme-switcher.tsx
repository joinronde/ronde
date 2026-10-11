"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Icon, type IconName } from "./shell/icons";

const THEMES: { id: "system" | "light" | "dark"; icon: IconName }[] = [
  { id: "light", icon: "sun" },
  { id: "dark", icon: "moon" },
  { id: "system", icon: "monitor" },
];

/** Light, dark or the device's theme, before signing in: kept in a cookie, applied at once */
export function ThemeSwitcher() {
  const t = useTranslations("account");
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    setTheme(current === "light" || current === "dark" ? current : "system");
  }, []);
  const choose = (next: typeof theme) => {
    setTheme(next);
    if (next === "system") {
      delete document.documentElement.dataset.theme;
      document.cookie = "ronde-theme=; path=/; max-age=0; samesite=lax";
    } else {
      document.documentElement.dataset.theme = next;
      document.cookie = `ronde-theme=${next}; path=/; max-age=31536000; samesite=lax`;
    }
  };
  return (
    <div className="theme-switch" role="radiogroup" aria-label={t("theme")}>
      {THEMES.map((x) => (
        <button
          key={x.id}
          type="button"
          role="radio"
          aria-checked={theme === x.id}
          title={t(`themes.${x.id}`)}
          onClick={() => choose(x.id)}
        >
          <Icon name={x.icon} />
          <span className="sr-only">{t(`themes.${x.id}`)}</span>
        </button>
      ))}
    </div>
  );
}
