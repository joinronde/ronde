"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { PersonFace } from "@/components/person-face";
import type { InboxView } from "@/lib/server/inbox";
import { withBasePath } from "@/lib/shared/base-path";
import { Menu } from "../workspace/menu";
import { Icon, type IconName } from "./icons";

// The bell of the top bar: an action given to me, a session starting, minutes published, thanks received

type KindKey = "action_assigned" | "session_started" | "minutes_published" | "kudo_received" | "meeting_joined";

interface Inbox {
  unread: number;
  items: InboxView[];
}

/** Checked again this often, and whenever the tab comes back */
const POLL_MS = 60_000;

const ICON: Record<InboxView["kind"], IconName> = {
  "action.assigned": "todo",
  "session.started": "video",
  "minutes.published": "check",
  "kudo.received": "heart",
  "meeting.joined": "people",
  "absence.delegated": "calendar",
};

export function InboxBell({ slug }: { slug: string }) {
  const t = useTranslations("inbox");
  const format = useFormatter();
  const [inbox, setInbox] = useState<Inbox>({ unread: 0, items: [] });
  const [ring, setRing] = useState(false);
  const last = useRef(0);
  const api = withBasePath(`/api/w/${slug}/inbox`);

  const show = useCallback((next: Inbox) => {
    // A new notification rings the bell once
    if (next.unread > last.current) {
      setRing(true);
      setTimeout(() => setRing(false), 1000);
    }
    last.current = next.unread;
    setInbox(next);
  }, []);
  const load = useCallback(async () => {
    try {
      const res = await fetch(api, { cache: "no-store" });
      if (res.ok) show((await res.json()) as Inbox);
    } catch {}
  }, [api, show]);
  const read = async (id?: string) => {
    try {
      const res = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      if (res.ok) show((await res.json()) as Inbox);
    } catch {}
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const label = inbox.unread ? t("labelUnread", { count: inbox.unread }) : t("label");
  return (
    <Menu
      label={label}
      className="inbox"
      onOpen={() => void load()}
      button={
        <span className={`bell${ring ? " ringing" : ""}`}>
          <Icon name="bell" />
          {inbox.unread > 0 && (
            <span className="bell-count" key={inbox.unread} aria-hidden="true">
              {inbox.unread > 9 ? "9+" : inbox.unread}
            </span>
          )}
        </span>
      }
    >
      {(close) => (
        <div className="inbox-pop">
          <div className="inbox-head">
            <strong>{t("title")}</strong>
            {inbox.unread > 0 && (
              <button type="button" className="link-btn" onClick={() => void read()}>
                {t("markAll")}
              </button>
            )}
          </div>
          {inbox.items.length ? (
            <ul className="inbox-list">
              {inbox.items.map((n) => (
                <li key={n.id} className={n.read ? undefined : "unread"}>
                  <Link
                    href={n.href}
                    onClick={() => {
                      if (!n.read) void read(n.id);
                      close();
                    }}
                  >
                    <span className="inbox-who" style={{ "--c": `var(--c${(n.actor?.color ?? 0) % 6})` } as React.CSSProperties}>
                      {n.actor ? (
                        <PersonFace slug={slug} person={n.actor} />
                      ) : (
                        <span className="inbox-ico" aria-hidden="true">
                          <Icon name={ICON[n.kind]} size={15} />
                        </span>
                      )}
                      <span className="inbox-kind" aria-hidden="true">
                        <Icon name={ICON[n.kind]} size={11} />
                      </span>
                    </span>
                    <span className="inbox-text">
                      <span>
                        {t.rich(`kinds.${n.kind.replace(".", "_") as KindKey}`, {
                          actor: n.actor?.name ?? t("someone"),
                          meeting: n.meeting ?? "",
                          strong: (c) => <strong>{c}</strong>,
                        })}
                      </span>
                      {n.text && <span className="inbox-quote">“{n.text}”</span>}
                      <span className="hint">{format.relativeTime(new Date(n.createdAt))}</span>
                    </span>
                    {!n.read && <span className="inbox-dot" aria-label={t("unread")} />}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="inbox-empty">
              <span className="act-empty-mark" aria-hidden="true">
                <Icon name="bell" size={20} />
              </span>
              <p>{t("empty")}</p>
              <p className="hint">{t("emptyHint")}</p>
            </div>
          )}
        </div>
      )}
    </Menu>
  );
}
