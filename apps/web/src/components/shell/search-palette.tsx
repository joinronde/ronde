"use client";

import { Modal } from "@ronde/ui/modal";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import type { SearchHit, SearchKind } from "@/lib/server/search";
import { withBasePath } from "@/lib/shared/base-path";
import { MeetingMark, type MeetingMarkData } from "../meeting-mark";
import type { ShellData } from "./app-shell";
import { Icon, type IconName } from "./icons";

// ⌘K anywhere in a workspace: go to a page, a meeting, a person; find an action, a topic, a decision

type Kind = "page" | SearchKind;

interface Item {
  key: string;
  kind: Kind;
  icon: IconName;
  title: string;
  detail?: string;
  href: string;
  color?: number;
  /** A meeting of the sidebar: its own emoji or image */
  mark?: MeetingMarkData;
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const ICONS: Record<SearchKind, IconName> = { meeting: "video", person: "user", action: "todo", topic: "chat", decision: "check" };

/** Opens the palette with ⌘K (Ctrl+K), except where a page has its own (the control room) */
export function useSearchShortcut(open: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k" || document.documentElement.dataset.ownPalette) return;
      e.preventDefault();
      open();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
}

export function SearchPalette({ data, onClose }: { data: ShellData; onClose: () => void }) {
  const t = useTranslations("search");
  const ts = useTranslations("shell");
  const router = useRouter();
  const listId = useId();
  const titleId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const slug = data.workspace!.slug;
  const base = `/w/${slug}`;

  // What is known without asking the server: the pages, the meetings of the sidebar, the other workspaces
  const pages: Item[] = [
    { key: "home", kind: "page", icon: "home", title: ts("home"), href: base },
    { key: "actions", kind: "page", icon: "todo", title: ts("actions"), href: `${base}/actions` },
    { key: "calendar", kind: "page", icon: "calendar", title: ts("calendar"), href: `${base}/calendar` },
    { key: "meetings", kind: "page", icon: "video", title: ts("meetings"), href: `${base}/meetings` },
    ...(data.can.projects
      ? [{ key: "projects", kind: "page" as const, icon: "folder" as const, title: ts("projects"), href: `${base}/projects` }]
      : []),
    { key: "decisions", kind: "page", icon: "flag", title: ts("decisions"), href: `${base}/decisions` },
    { key: "kudos", kind: "page", icon: "heart", title: ts("kudos"), href: `${base}/kudos` },
    { key: "templates", kind: "page", icon: "panel", title: ts("templates"), href: `${base}/templates` },
    { key: "people", kind: "page", icon: "people", title: ts("people"), href: `${base}/people` },
    ...(data.can.insights
      ? [{ key: "insights", kind: "page" as const, icon: "chart" as const, title: ts("insights"), href: `${base}/insights` }]
      : []),
    ...(data.can.manage
      ? [{ key: "settings", kind: "page" as const, icon: "settings" as const, title: ts("settings"), href: `${base}/settings` }]
      : []),
    ...(data.can.createMeeting
      ? [{ key: "new", kind: "page" as const, icon: "plus" as const, title: ts("newMeeting"), href: `${base}/meetings/new` }]
      : []),
    { key: "account", kind: "page", icon: "user", title: ts("account"), href: "/account" },
    ...data.workspaces
      .filter((w) => w.slug !== slug)
      .map((w) => ({
        key: `ws:${w.slug}`,
        kind: "page" as const,
        icon: "globe" as const,
        title: t("switchTo", { name: w.name }),
        href: `/w/${w.slug}`,
      })),
  ];
  const meetings: Item[] = data.meetings.map((m, i) => ({
    key: `m:${m.id}`,
    kind: "meeting",
    icon: "video",
    title: m.name,
    detail: m.live ? ts("live") : undefined,
    href: `${base}/m/${m.id}`,
    color: i,
    mark: m,
  }));
  const words = fold(q).split(/\s+/).filter(Boolean);
  const local = [...pages, ...meetings].filter((i) => words.every((w) => fold(i.title).includes(w)));
  const remote: Item[] = hits
    .filter((h) => !(h.kind === "meeting" && local.some((l) => l.key === `m:${h.id}`)))
    .map((h) => ({
      key: `${h.kind}:${h.id}`,
      kind: h.kind,
      icon: ICONS[h.kind],
      title: h.title,
      detail: h.detail,
      href: h.href,
      color: h.color,
    }));
  const items = [...local, ...remote];
  const index = Math.min(active, Math.max(0, items.length - 1));

  // The server is asked once typing pauses
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(withBasePath(`/api/w/${slug}/search?q=${encodeURIComponent(query)}`), { signal: ctrl.signal });
        if (res.ok) setHits(((await res.json()) as { hits: SearchHit[] }).hits);
        setLoading(false);
      } catch {}
    }, 180);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, slug]);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    document.getElementById(`${listId}-${index}`)?.scrollIntoView({ block: "nearest" });
  }, [index, listId]);

  const choose = (i: Item | undefined) => {
    if (!i) return;
    onClose();
    router.push(i.href);
  };

  // Results grouped by kind, keeping one running index for the keyboard
  const groups: { kind: Kind; items: { item: Item; i: number }[] }[] = [];
  items.forEach((item, i) => {
    const g = groups.find((x) => x.kind === item.kind);
    if (g) g.items.push({ item, i });
    else groups.push({ kind: item.kind, items: [{ item, i }] });
  });

  return (
    <Modal onClose={onClose} labelledBy={titleId}>
      <div className="search">
        <h2 id={titleId} className="sr-only">
          {t("title")}
        </h2>
        <div className="search-field">
          <Icon name="search" />
          <input
            ref={input}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={items.length ? `${listId}-${index}` : undefined}
            aria-label={t("title")}
            placeholder={t("placeholder")}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((index + 1) % Math.max(1, items.length));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((index - 1 + items.length) % Math.max(1, items.length));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(items[index]);
              }
            }}
          />
          {loading && <span className="search-spin" aria-hidden="true" />}
          <kbd>esc</kbd>
        </div>
        <div id={listId} role="listbox" aria-label={t("title")} className="search-list">
          {groups.map((g) => (
            <div key={g.kind} role="group" aria-label={t(`kinds.${g.kind}`)} className="search-group">
              <p className="search-group-name" aria-hidden="true">
                {t(`kinds.${g.kind}`)}
              </p>
              {g.items.map(({ item, i }) => (
                <div
                  key={item.key}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === index}
                  className={`search-item${i === index ? " on" : ""}`}
                  style={item.color !== undefined ? ({ "--c": `var(--c${item.color % 6})` } as React.CSSProperties) : undefined}
                  onMouseMove={() => setActive(i)}
                  onClick={() => choose(item)}
                >
                  {item.mark && (item.mark.icon || item.mark.image) ? (
                    <MeetingMark slug={slug} meeting={item.mark} className="search-icon tinted" />
                  ) : (
                    <span className={`search-icon${item.color !== undefined ? " tinted" : ""}`} aria-hidden="true">
                      <Icon name={item.icon} size={16} />
                    </span>
                  )}
                  <span className="search-text">
                    <span className="search-title">{item.title}</span>
                    {item.detail && <span className="hint">{item.detail}</span>}
                  </span>
                  {i === index && (
                    <kbd className="search-enter" aria-hidden="true">
                      ↵
                    </kbd>
                  )}
                </div>
              ))}
            </div>
          ))}
          {!items.length && !loading && <p className="search-empty">{t("none", { query: q.trim() })}</p>}
        </div>
        <p className="search-foot hint">{t("foot")}</p>
      </div>
    </Modal>
  );
}
