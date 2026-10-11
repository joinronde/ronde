"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useState } from "react";
import { feedbackStatusAction } from "@/app/admin/actions";
import { FormAlert } from "@/components/auth/fields";
import { Icon, type IconName } from "@/components/shell/icons";
import type { FeedbackRow } from "@/lib/server/feedback";
import { withBasePath } from "@/lib/shared/base-path";

// What people sent with "Send feedback", for the administrators of a self-hosted instance: answer them, mark
// what was dealt with, and pass a problem on to the Ronde project when it is Ronde's own

const KIND_ICON: Record<string, IconName> = { bug: "bug", idea: "bulb", other: "chat" };
const NEXT_STATUS: Record<string, ("new" | "handled" | "archived")[]> = {
  new: ["handled", "archived"],
  handled: ["new", "archived"],
  archived: ["new"],
};
const REPO = "https://github.com/joinronde/ronde";

/** A new issue of the Ronde project, filled with the message and what helps reproduce it, without names */
function issueUrl(f: FeedbackRow) {
  const path = (f.context.path ?? "").replace(/\/w\/[^/]+/, "/w/…").replace(/\/(m|people|projects|g)\/[^/]+/g, "/$1/…");
  const firstLine = f.message.split("\n")[0]!.slice(0, 90);
  const about = [
    `Ronde ${f.context.version ?? "?"} · ${[f.context.browser, f.context.viewport].filter(Boolean).join(" · ")}`,
    path && `Page: \`${path}\``,
    f.context.errorRef && `Error reference: \`${f.context.errorRef}\``,
  ].filter(Boolean);
  const body = `${f.message}\n\n---\n${about.join("\n")}`;
  const q = new URLSearchParams({ title: firstLine, body, labels: f.kind === "bug" ? "bug" : "enhancement" });
  return `${REPO}/issues/new?${q}`;
}

export function AdminFeedback({ items, archived, unread }: { items: FeedbackRow[]; archived: boolean; unread: number }) {
  const t = useTranslations("admin.feedback");
  const format = useFormatter();
  const now = useNow({ updateInterval: 60_000 });
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const move = async (id: string, status: string) => {
    setBusy(id);
    const res = await feedbackStatusAction(id, status);
    setBusy(null);
    if (!res.ok) return setError(res.error);
    setError(null);
    router.refresh();
  };

  return (
    <section className="panel admin-feedback" aria-labelledby="admin-feedback">
      <div className="admin-feedback-head">
        <h2 id="admin-feedback">
          {t("title")}
          {unread > 0 && <span className="pill">{t("unread", { count: unread })}</span>}
        </h2>
        <nav className="seg" aria-label={t("filter")}>
          <Link href="/admin#admin-feedback" aria-current={!archived ? "page" : undefined} scroll={false}>
            {t("open")}
          </Link>
          <Link href="/admin?feedback=archived#admin-feedback" aria-current={archived ? "page" : undefined} scroll={false}>
            {t("archived")}
          </Link>
        </nav>
      </div>
      <p className="hint">{t("intro")}</p>
      <FormAlert>{error}</FormAlert>
      {items.length === 0 ? (
        <div className="fb-empty">
          <span className="act-empty-mark" aria-hidden="true">
            <Icon name="feedback" size={20} />
          </span>
          <p>{archived ? t("emptyArchived") : t("empty")}</p>
        </div>
      ) : (
        <ul className="fb-list">
          {items.map((f) => (
            <li key={f.id} className={f.status === "new" ? "fb-item new" : "fb-item"} aria-busy={busy === f.id || undefined}>
              <div className="fb-top">
                <span className={`fb-kind ${f.kind}`}>
                  <Icon name={KIND_ICON[f.kind] ?? "chat"} size={14} />
                  {t(`kinds.${f.kind as "bug"}`)}
                </span>
                <strong>{f.from.name || t("someone")}</strong>
                {f.workspace && <span className="hint">{f.workspace.name}</span>}
                <time
                  className="hint"
                  dateTime={new Date(f.createdAt).toISOString()}
                  title={format.dateTime(new Date(f.createdAt), { dateStyle: "long", timeStyle: "short" })}
                >
                  {format.relativeTime(new Date(f.createdAt), now)}
                </time>
                {f.status !== "new" && (
                  <span className={f.status === "handled" ? "pill done" : "pill"}>
                    {f.status === "handled" ? t("statuses.handled") : t("statuses.archived")}
                  </span>
                )}
              </div>
              <p className="fb-msg">{f.message}</p>
              {f.screenshot && (
                <a className="fb-shot" href={withBasePath(`/api/admin/feedback/${f.id}/screenshot`)} target="_blank" rel="noreferrer">
                  <img
                    src={withBasePath(`/api/admin/feedback/${f.id}/screenshot`)}
                    alt={t("screenshot")}
                    loading="lazy"
                    width={f.screenshot.width}
                    height={f.screenshot.height}
                  />
                </a>
              )}
              <dl className="fb-meta">
                {f.context.path && (
                  <div>
                    <dt>{t("page")}</dt>
                    <dd dir="ltr">{f.context.path}</dd>
                  </div>
                )}
                <div>
                  <dt>{t("browser")}</dt>
                  <dd dir="ltr" title={f.context.userAgent}>
                    {[f.context.browser, f.context.viewport].filter(Boolean).join(" · ")}
                  </dd>
                </div>
                <div>
                  <dt>{t("version")}</dt>
                  <dd dir="ltr">{f.context.version}</dd>
                </div>
                {f.context.errorRef && (
                  <div>
                    <dt>{t("errorRef")}</dt>
                    <dd dir="ltr">{f.context.errorRef}</dd>
                  </div>
                )}
              </dl>
              <div className="fb-actions">
                {f.from.email ? (
                  <a className="btn sm primary" href={`mailto:${f.from.email}?subject=${encodeURIComponent(t("replySubject"))}`}>
                    <Icon name="mail" size={14} /> {t("reply")}
                  </a>
                ) : (
                  <span className="hint">{t("noContact")}</span>
                )}
                {NEXT_STATUS[f.status]?.map((s) => (
                  <button key={s} type="button" className="btn sm" disabled={busy === f.id} onClick={() => void move(f.id, s)}>
                    {t(`mark.${s}`)}
                  </button>
                ))}
                {f.kind !== "other" && (
                  <a className="btn sm fb-issue" href={issueUrl(f)} target="_blank" rel="noreferrer" title={t("toGithubHint")}>
                    <Icon name="external" size={14} /> {t("toGithub")}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
