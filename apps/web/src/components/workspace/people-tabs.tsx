"use client";

import { Contact, FolderTree } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const TABS = [
  ["people", "persons", Contact],
  ["teams", "teams", FolderTree],
] as const;

/** The directory: its people and its teams, two tabs of the same "Directory" entry */
export function PeopleTabs({ slug }: { slug: string }) {
  const t = useTranslations("shell");
  const path = usePathname();
  return (
    <nav className="tabs settings-tabs meetings-tabs" aria-label={t("people")}>
      {TABS.map(([page, label, TabIcon]) => {
        const href = `/w/${slug}/${page}`;
        return (
          <Link key={page} href={href} aria-current={path === href ? "page" : undefined}>
            <TabIcon size={16} strokeWidth={2} aria-hidden="true" />
            {t(label)}
          </Link>
        );
      })}
    </nav>
  );
}

/** Pages under the directory's tabs, for the side menu to keep "Directory" current there */
export const PEOPLE_PAGES = TABS.map(([page]) => `/${page}`);
