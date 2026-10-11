"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

export type SettingsTab = "general" | "security" | "roles" | "audit" | "billing" | "plans";

/** Sections of the workspace settings, as tabs (one page each) */
export function WorkspaceSettingsTabs({
  slug,
  tabs,
  locked = {},
}: {
  slug: string;
  tabs: SettingsTab[];
  /** Tabs of a paid plan the workspace lacks, with that plan's name */
  locked?: Partial<Record<SettingsTab, string>>;
}) {
  const t = useTranslations("workspace.settings.tabs");
  const path = usePathname();
  const base = `/w/${slug}/settings`;
  const href = (tab: SettingsTab) => (tab === "general" ? base : `${base}/${tab}`);
  return (
    <nav className="tabs settings-tabs" aria-label={t("label")}>
      {tabs.map((tab) => (
        <Link
          key={tab}
          href={href(tab)}
          aria-current={(tab === "general" ? path === base : path.startsWith(href(tab))) ? "page" : undefined}
        >
          {t(tab)}
          {locked[tab] && <span className="plan-badge">{locked[tab]}</span>}
        </Link>
      ))}
    </nav>
  );
}
