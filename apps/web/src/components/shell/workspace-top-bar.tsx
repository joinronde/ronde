"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { TopBar } from "./app-shell";

/** Top bar of the workspace pages: the workspace, then the page */
export function WorkspaceTopBar({ workspace }: { workspace: { slug: string; name: string } }) {
  const t = useTranslations("shell");
  const path = usePathname();
  const base = `/w/${workspace.slug}`;
  const pages: [string, string][] = [
    ["/meetings/new", t("newMeeting")],
    ["/meetings", t("meetings")],
    ["/decisions", t("decisions")],
    ["/projects", t("projects")],
    ["/templates", t("templates")],
    ["/kudos", t("kudos")],
    ["/people", t("people")],
    ["/insights", t("insights")],
    ["/calendar", t("calendar")],
    ["/actions", t("actions")],
    ["/settings", t("settings")],
  ];
  const page = pages.find(([p]) => path.startsWith(`${base}${p}`))?.[1] ?? t("home");
  return <TopBar crumbs={[{ label: workspace.name, href: base }, { label: page }]} />;
}
