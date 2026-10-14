"use client";

import { Logo } from "@ronde/ui/logo";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { FeedbackDialog, type FeedbackTo, forgetFeedbackDraft } from "@/components/feedback";
import { PersonFace } from "@/components/person-face";
import { authClient } from "@/lib/auth-client";
import { withBasePath } from "@/lib/shared/base-path";
import { LAST_WORKSPACE_COOKIE } from "@/lib/shared/cookies";
import { initials } from "@/lib/shared/initials";
import { MEETING_MARK_EVENT, type MeetingMarkChange } from "@/lib/shared/meeting-mark";
import { liveFirst } from "@/lib/shared/meetings-list";
import { MeetingMark } from "../meeting-mark";
import { Menu } from "../workspace/menu";
import { PEOPLE_PAGES } from "../workspace/people-tabs";
import { Icon, type IconName } from "./icons";
import { InboxBell } from "./inbox-bell";
import { ModKey } from "./mod-key";
import { SearchPalette, useSearchShortcut } from "./search-palette";

// The frame of every signed-in page (workspace, meetings, account, administration): a sidebar to move
// around, a top bar saying where you are. The shared screen and the phone remote stay full-screen.

export interface ShellData {
  /** The current workspace; its logo (path of the image) replaces Ronde's when it has one */
  workspace: { slug: string; name: string; logo?: string | null } | null;
  workspaces: { slug: string; name: string }[];
  meetings: { id: string; name: string; icon: string; image: number | null; live: boolean }[];
  can: { manage: boolean; createMeeting: boolean; projects: boolean; insights: boolean };
  /** Paid pages the plan lacks, with the plan that has them (shown to administrators) */
  locked: { insights: "team" | "enterprise" | null };
  /** Follow-up actions the person still has to do */
  openActions: number;
  /** Who reads the messages of "Send feedback" (null: no button) */
  feedback: FeedbackTo | null;
  /** The account; its person in the current workspace gives the photo of the menu */
  user: { name: string; email: string; instanceAdmin: boolean; personId: string | null; color: number; avatar: number | null };
}

const COLLAPSED_KEY = "ronde:sidebar-collapsed";
const noop = () => {};

const ShellContext = createContext<{
  openSidebar: () => void;
  openSearch: (() => void) | null;
  openFeedback: (() => void) | null;
  slug: string | null;
}>({
  openSidebar: () => {},
  openSearch: null,
  openFeedback: null,
  slug: null,
});

// The pages that show faces still import it from here
export { initials };

export function AppShell({ data: fromServer, children }: { data: ShellData; children: React.ReactNode }) {
  const t = useTranslations("shell");
  // The open meeting's name, mark and live state, as soon as they change on its pages (the server's list comes
  // back with the next navigation)
  const [marks, setMarks] = useState<Record<string, MeetingMarkChange>>({});
  useEffect(() => setMarks({}), [fromServer]);
  useEffect(() => {
    const on = (e: Event) => {
      const m = (e as CustomEvent<MeetingMarkChange>).detail;
      setMarks((all) => ({ ...all, [m.id]: m }));
    };
    window.addEventListener(MEETING_MARK_EVENT, on);
    return () => window.removeEventListener(MEETING_MARK_EVENT, on);
  }, []);
  const data = Object.keys(marks).length
    ? { ...fromServer, meetings: fromServer.meetings.map((m) => (marks[m.id] ? { ...m, ...marks[m.id] } : m)) }
    : fromServer;
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const openSearch = useCallback(() => setSearch(true), []);
  const openFeedback = useCallback(() => setFeedback(true), []);
  useSearchShortcut(data.workspace ? openSearch : noop);
  // The sidebar folded to icons is a per-device choice
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {}
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      } catch {}
      return !c;
    });
  };
  // A page opened from the sidebar closes it on phones
  useEffect(() => setOpen(false), [path]);
  // Remember this workspace for the next visit of the home page
  useEffect(() => {
    if (data.workspace) document.cookie = `${LAST_WORKSPACE_COOKIE}=${data.workspace.slug}; path=/; max-age=31536000; samesite=lax`;
  }, [data.workspace]);

  return (
    <ShellContext.Provider
      value={{
        openSidebar: () => setOpen(true),
        openSearch: data.workspace ? openSearch : null,
        openFeedback: data.feedback ? openFeedback : null,
        slug: data.workspace?.slug ?? null,
      }}
    >
      <a className="skip-link" href="#main">
        {t("skipToContent")}
      </a>
      <div className="app" data-collapsed={collapsed || undefined}>
        <aside className="side" data-open={open || undefined} aria-label={t("sidebar")}>
          <div className="side-top">
            <WorkspaceSwitcher data={data} />
            <button
              type="button"
              className="side-btn side-fold"
              onClick={toggle}
              aria-label={collapsed ? t("expand") : t("collapse")}
              title={collapsed ? t("expand") : t("collapse")}
            >
              <Icon name="panel" />
            </button>
            <button type="button" className="side-btn side-close" onClick={() => setOpen(false)} aria-label={t("closeMenu")}>
              <Icon name="close" />
            </button>
          </div>
          {data.workspace && <SideNav data={data} />}
          <div className="side-foot">
            <UserMenu user={data.user} />
          </div>
        </aside>
        {open && <div className="side-scrim" aria-hidden="true" onClick={() => setOpen(false)} />}
        <div className="app-main">{children}</div>
      </div>
      {search && data.workspace && <SearchPalette data={data} onClose={() => setSearch(false)} />}
      {feedback && data.feedback && (
        <FeedbackDialog to={data.feedback} email={data.user.email} workspace={data.workspace?.slug} onClose={() => setFeedback(false)} />
      )}
    </ShellContext.Provider>
  );
}

function NavItem({
  href,
  icon,
  label,
  active,
  count,
  plan,
}: {
  href: string;
  icon: IconName;
  label: string;
  active: boolean;
  count?: number;
  /** Paid plan the page needs, shown as a badge (to administrators, while the suggestions are on) */
  plan?: string | null;
}) {
  return (
    <Link href={href} className="side-link" aria-current={active ? "page" : undefined} title={label}>
      <Icon name={icon} />
      <span className="side-label">{label}</span>
      {plan && <span className="plan-badge">{plan}</span>}
      {!!count && (
        <span className="side-count" key={count}>
          {count}
        </span>
      )}
    </Link>
  );
}

function SideNav({ data }: { data: ShellData }) {
  const t = useTranslations("shell");
  const tPlans = useTranslations("modules");
  const path = usePathname();
  const base = `/w/${data.workspace!.slug}`;
  return (
    <>
      <nav className="side-nav" aria-label={t("workspaceNav")}>
        <NavItem href={base} icon="home" label={t("home")} active={path === base} />
        <NavItem href={`${base}/calendar`} icon="calendar" label={t("calendar")} active={path.startsWith(`${base}/calendar`)} />
        <NavItem
          href={`${base}/actions`}
          icon="todo"
          label={t("actions")}
          active={path.startsWith(`${base}/actions`)}
          count={data.openActions}
        />
        {/* The two things meetings leave behind, side by side: what is to be done, what was decided */}
        <NavItem href={`${base}/decisions`} icon="flag" label={t("decisions")} active={path.startsWith(`${base}/decisions`)} />
        {data.can.projects && (
          <NavItem href={`${base}/projects`} icon="folder" label={t("projects")} active={path.startsWith(`${base}/projects`)} />
        )}
        <NavItem
          href={`${base}/people`}
          icon="people"
          label={t("people")}
          active={PEOPLE_PAGES.some((p) => path.startsWith(`${base}${p}`))}
        />
        {/* The thanks people gave each other in the meetings: a page of their own, not part of the directory */}
        <NavItem href={`${base}/kudos`} icon="heart" label={t("kudos")} active={path.startsWith(`${base}/kudos`)} />
        {/* Without the plan, administrators still see the page, marked with it: it presents what the plan brings */}
        {data.can.insights && (
          <NavItem
            href={`${base}/insights`}
            icon="chart"
            label={t("insights")}
            active={path.startsWith(`${base}/insights`)}
            plan={data.locked.insights && tPlans(`editions.${data.locked.insights}`)}
          />
        )}
        {data.can.manage && (
          <NavItem href={`${base}/settings`} icon="settings" label={t("settings")} active={path.startsWith(`${base}/settings`)} />
        )}
      </nav>
      <section className="side-section" aria-labelledby="side-meetings">
        <div className="side-heading">
          <h2 id="side-meetings">
            <Link href={`${base}/meetings`} className="side-heading-link" aria-current={path === `${base}/meetings` ? "page" : undefined}>
              {t("meetings")}
            </Link>
          </h2>
          {data.can.createMeeting && (
            <Link href={`${base}/meetings/new`} className="side-btn" aria-label={t("newMeeting")} title={t("newMeeting")}>
              <Icon name="plus" size={16} />
            </Link>
          )}
        </div>
        {data.meetings.length ? (
          <ul className="side-list">
            {liveFirst(data.meetings, (m) => m.live).map((m) => (
              <li key={m.id}>
                <Link
                  href={`${base}/m/${m.id}`}
                  className={`side-link meeting${m.live ? " is-live" : ""}`}
                  aria-current={path.startsWith(`${base}/m/${m.id}`) ? "page" : undefined}
                  title={m.name}
                >
                  <MeetingMark slug={data.workspace!.slug} meeting={m} className="side-mark" />
                  <span className="side-label">{m.name}</span>
                  {m.live && (
                    <span className="side-live">
                      <span className="side-live-dot" aria-hidden="true" />
                      {t("live")}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="side-empty">{t("noMeetings")}</p>
        )}
      </section>
    </>
  );
}

function WorkspaceSwitcher({ data }: { data: ShellData }) {
  const t = useTranslations("shell");
  return (
    <Menu
      label={t("switcher")}
      align="start"
      button={
        <>
          {data.workspace?.logo ? <img className="side-ws-logo" src={withBasePath(data.workspace.logo)} alt="" /> : <Logo motion="hover" />}
          <span className="side-label side-ws">{data.workspace?.name ?? "Ronde"}</span>
          <span className="side-label side-chev">
            <Icon name="chevrons" size={14} />
          </span>
        </>
      }
    >
      {(close) => (
        <>
          {data.workspaces.length > 0 && (
            <ul className="menu-list">
              {data.workspaces.map((w) => (
                <li key={w.slug}>
                  <Link href={`/w/${w.slug}`} aria-current={w.slug === data.workspace?.slug ? "true" : undefined} onClick={close}>
                    {w.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <hr />
          <Link href="/onboarding" className="menu-item" onClick={close}>
            <Icon name="plus" size={16} /> {t("newWorkspace")}
          </Link>
          {/* The instance above its workspaces: for its administrators */}
          {data.user.instanceAdmin && (
            <Link href="/admin" className="menu-item" onClick={close}>
              <Icon name="shield" size={16} /> {t("admin")}
            </Link>
          )}
        </>
      )}
    </Menu>
  );
}

function UserMenu({ user }: { user: ShellData["user"] }) {
  const t = useTranslations("shell");
  const { slug, openFeedback } = useContext(ShellContext);
  const router = useRouter();
  const signOut = async () => {
    forgetFeedbackDraft();
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  };
  return (
    <Menu
      label={t("userMenu")}
      align="start"
      button={
        <>
          {slug && user.personId ? (
            <PersonFace slug={slug} person={{ id: user.personId, name: user.name || user.email, color: user.color, avatar: user.avatar }} />
          ) : (
            <span className="av sm" aria-hidden="true">
              {initials(user.name || user.email)}
            </span>
          )}
          <span className="side-label side-who">
            <strong>{user.name || user.email}</strong>
            <span>{user.email}</span>
          </span>
        </>
      }
    >
      {(close) => (
        <>
          <Link href="/account" className="menu-item" onClick={close}>
            <Icon name="user" size={16} /> {t("account")}
          </Link>
          {openFeedback && (
            <button
              type="button"
              className="menu-item"
              onClick={(e) => {
                // Back on the account menu's button once the dialog closes, not at the top of the page
                e.currentTarget.closest(".menu")?.querySelector<HTMLElement>(".menu-btn")?.focus();
                close();
                openFeedback();
              }}
            >
              <Icon name="feedback" size={16} /> {t("feedback")}
            </button>
          )}
          <hr />
          <button type="button" className="menu-item" onClick={signOut}>
            <Icon name="logout" size={16} /> {t("signOut")}
          </button>
        </>
      )}
    </Menu>
  );
}

export interface Crumb {
  label: string;
  href?: string;
  /** The one crumb a phone shows (the last one when none is marked): there is room for a single name */
  phone?: boolean;
}

/** Top of the page: where you are, and the actions of the page */
export function TopBar({ crumbs, children }: { crumbs: Crumb[]; children?: React.ReactNode }) {
  const t = useTranslations("shell");
  const tSearch = useTranslations("search");
  const { openSidebar, openSearch, openFeedback, slug } = useContext(ShellContext);
  return (
    <header className={openSearch ? "topbar with-search" : "topbar"}>
      <button type="button" className="side-btn topbar-menu" onClick={openSidebar} aria-label={t("openMenu")}>
        <Icon name="menu" />
      </button>
      <nav aria-label={t("breadcrumb")} className="crumbs">
        <ol>
          {crumbs.map((c, i) => (
            <li key={`${i}-${c.label}`} data-phone={c.phone || (!crumbs.some((x) => x.phone) && i === crumbs.length - 1) ? "" : undefined}>
              {c.href && i < crumbs.length - 1 ? (
                <Link href={c.href}>{c.label}</Link>
              ) : (
                <span aria-current={i === crumbs.length - 1 ? "page" : undefined}>{c.label}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      {/* Search sits in the middle of the bar, within reach on any screen; the page's actions and the bell at the end */}
      {openSearch && (
        <div className="topbar-search">
          <button type="button" className="search-btn" onClick={openSearch} aria-label={t("search")}>
            <Icon name="search" size={16} />
            <span className="search-btn-label">{t("search")}</span>
            <span className="search-btn-hint">{tSearch("placeholder")}</span>
            <ModKey k="K" />
          </button>
        </div>
      )}
      {(children || slug || openFeedback) && (
        <div className="topbar-actions">
          {children}
          {openFeedback && (
            <button
              type="button"
              className="side-btn topbar-feedback"
              onClick={openFeedback}
              aria-label={t("feedback")}
              title={t("feedback")}
            >
              <Icon name="feedback" />
            </button>
          )}
          {slug && <InboxBell slug={slug} />}
        </div>
      )}
    </header>
  );
}
