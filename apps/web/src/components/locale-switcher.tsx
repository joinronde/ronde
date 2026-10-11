"use client";

import { LOCALE_COOKIE, type Locale, localeNames, locales } from "@ronde/i18n";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { Icon } from "./shell/icons";
import { Menu } from "./workspace/menu";

/** Language of the interface, kept for a year in a cookie; the server renders the next pages in it */
export function LocaleSwitcher({ up = false }: { up?: boolean }) {
  const t = useTranslations("app");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, start] = useTransition();
  const change = (next: Locale) => {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    start(() => router.refresh());
  };
  return (
    <Menu
      label={t("language")}
      up={up}
      align="start"
      className="pick-menu"
      button={
        <>
          <Icon name="globe" />
          <span>{localeNames[locale]}</span>
          <Icon name="chevronDown" size={16} />
        </>
      }
    >
      {(close) => (
        <ul className="menu-list" aria-busy={pending}>
          {locales.map((l) => (
            <li key={l}>
              <button
                type="button"
                className="menu-item"
                lang={l}
                aria-current={l === locale ? "true" : undefined}
                onClick={() => {
                  close();
                  if (l !== locale) change(l);
                }}
              >
                <span>{localeNames[l]}</span>
                {l === locale && <Icon name="check" size={16} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Menu>
  );
}
