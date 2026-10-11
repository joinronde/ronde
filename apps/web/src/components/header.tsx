"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { withBasePath } from "@/lib/shared/base-path";
import { useRonde } from "./ronde-provider";
import { TopBar } from "./shell/app-shell";
import { Icon } from "./shell/icons";
import { NewTab } from "./shell/new-tab";
import { SwipeRow } from "./swipe-row";

// Top of the meeting pages: where you are (workspace / meeting / page), the video call, the connection,
// then the meeting's tabs. Participants have a single page, "My screen", with its own tabs: no tab row.

const TABS = [
  { href: "/control", key: "control" },
  { href: "/me", key: "me" },
  { href: "/history", key: "history" },
  { href: "/stats", key: "stats" },
  { href: "/decisions", key: "decisions" },
  { href: "/settings", key: "settings" },
] as const;

/** Link of the video call: Ronde's own entry (BigBlueButton) under the base path; Jitsi gets the person's name */
function joinLink(settings: { videoUrl: string; video: { provider: string } }, name: string): string {
  const url = settings.videoUrl;
  if (url.startsWith("/")) return withBasePath(url);
  if (settings.video.provider === "jitsi" && name) return `${url}#userInfo.displayName=${encodeURIComponent(JSON.stringify(name))}`;
  return url;
}

const PAGE_ACTIONS = "page-actions";

/** Buttons of the current page, shown at the end of the tab row */
export function PageActions({ children }: { children: React.ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById(PAGE_ACTIONS)), []);
  return slot ? createPortal(children, slot) : null;
}

export function MeetingFrame() {
  const t = useTranslations("header");
  const tPages = useTranslations("pages");
  const path = usePathname();
  const { s, connected } = useRonde();
  // Lost for more than a moment: the stream opening at each page load must not flash a warning
  const [lost, setLost] = useState(false);
  useEffect(() => {
    if (connected) return setLost(false);
    const timer = setTimeout(() => setLost(true), 2500);
    return () => clearTimeout(timer);
  }, [connected]);
  const base = s.context.path;
  const tabs = s.viewer.isHost
    ? TABS.filter(
        (n) =>
          (n.href !== "/me" || s.viewer.memberId) &&
          (n.href !== "/decisions" || s.modules.decisions) &&
          (n.href !== "/settings" || s.viewer.isAdmin),
      )
    : [];
  const current = TABS.find((n) => path.startsWith(base + n.href));
  return (
    <>
      {/* The page's title, for screen readers and the outline: the breadcrumb shows it to everyone else */}
      <h1 className="sr-only">{current ? `${s.settings.teamName} · ${tPages(current.key)}` : s.settings.teamName}</h1>
      <TopBar
        crumbs={[
          { label: s.context.workspace.name, href: `/w/${s.context.workspace.slug}` },
          // On a phone, the meeting's name alone: the tabs under it already say which page this is
          { label: s.settings.teamName, href: base, phone: true },
          ...(current ? [{ label: tPages(current.key) }] : []),
        ]}
      >
        {/* The connection to the server only shows when it is lost: "Connected" all the time was noise */}
        {lost && (
          <span className="sync off" role="status">
            <i />
            <span>{t("reconnecting")}</span>
          </span>
        )}
        {s.settings.videoUrl && (
          <a className="btn soft sm" href={joinLink(s.settings, s.viewer.name)} target="_blank" rel="noopener" title={t("videoHint")}>
            <Icon name="video" size={16} />
            <span className="hide-sm">{t("joinVideo")}</span>
            <NewTab />
          </a>
        )}
      </TopBar>
      {tabs.length > 0 && (
        <div className="page-tabs">
          {/* Swiped on a phone, with a hint on the side where more pages wait */}
          <SwipeRow nav className="tabs" aria-label={t("navigation")} data-tour="nav" selected={path}>
            {tabs.map((n) => (
              <Link
                key={n.href}
                href={base + n.href}
                aria-current={path.startsWith(base + n.href) ? "page" : undefined}
                data-tour={n.key === "settings" ? "settings-tab" : undefined}
              >
                {tPages(n.key)}
              </Link>
            ))}
          </SwipeRow>
          {/* The page's actions and the shared screen, together: beside the tabs when they fit, under them otherwise */}
          <div className="tabs-end">
            <div className="tabs-actions" id={PAGE_ACTIONS} />
            <a className="btn sm" href={withBasePath(`${base}/screen`)} target="_blank" rel="noopener" title={t("screenHint")}>
              <Icon name="screen" size={16} />
              <span className="hide-sm">{tPages("screen")}</span>
              <NewTab />
            </a>
          </div>
        </div>
      )}
    </>
  );
}
