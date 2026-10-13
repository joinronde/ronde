"use client";

import { formatters, type Locale } from "@ronde/i18n";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import type { DashboardPerson } from "@/lib/server/dashboard";
import type { MeetingOverview } from "@/lib/server/overview";
import { withBasePath } from "@/lib/shared/base-path";
import { fold } from "@/lib/shared/search";
import { MeetingMark } from "../meeting-mark";
import { initials } from "../shell/app-shell";
import { Icon } from "../shell/icons";

type Filter = "all" | "mine" | "run";

const tint = (color: number) => ({ "--c": `var(--c${color % 6})` }) as React.CSSProperties;

/** Every meeting of the workspace the person can see, as cards: when it meets next, who is in, what is pending */
export function MeetingsView({ slug, meetings, canCreate }: { slug: string; meetings: MeetingOverview[]; canCreate: boolean }) {
  const t = useTranslations("meetingsPage");
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const base = `/w/${slug}`;
  const runs = (m: MeetingOverview) => m.role === "host" || m.role === "cohost";
  const counts = { all: meetings.length, mine: meetings.filter((m) => m.role).length, run: meetings.filter(runs).length };
  const shown = meetings
    .filter((m) => (filter === "mine" ? !!m.role : filter === "run" ? runs(m) : true))
    .filter((m) => !q.trim() || fold(m.name).includes(fold(q.trim())));
  return (
    <div className="page meetings-page">
      <header className="page-head row">
        <div>
          <h1>{t("title")}</h1>
          <p className="muted">{t("intro")}</p>
        </div>
        <div className="page-head-actions">
          <Link href={`${base}/templates`} className="btn">
            {t("templates")}
          </Link>
          {canCreate && (
            <Link href={`${base}/meetings/new`} className="btn primary">
              <Icon name="plus" size={16} /> {t("new")}
            </Link>
          )}
        </div>
      </header>
      {meetings.length > 0 && (
        <div className="mt-bar">
          <div className="chips" role="group" aria-label={t("filter")}>
            {(["all", "mine", "run"] as const).map((f) => (
              <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {t(`filters.${f}`)} <span className="chip-count">{counts[f]}</span>
              </button>
            ))}
          </div>
          <input
            type="search"
            className="mt-search"
            placeholder={t("search")}
            aria-label={t("search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      )}
      {shown.length ? (
        <ul className="mt-grid">
          {shown.map((m, i) => (
            <MeetingCard key={m.id} slug={slug} m={m} index={i} />
          ))}
        </ul>
      ) : (
        <div className="empty-state">
          <p>{meetings.length ? t("noMatch") : t("empty")}</p>
          {!meetings.length && canCreate && (
            <Link href={`${base}/meetings/new`} className="btn primary">
              {t("new")}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function Faces({ slug, people, total }: { slug: string; people: DashboardPerson[]; total: number }) {
  return (
    <span className="mt-faces">
      {people.map((p) => (
        <span key={p.id} className={`av sm${p.avatar ? " img" : ""}`} style={tint(p.color)} title={p.name}>
          {p.avatar ? <img src={withBasePath(`/api/w/${slug}/avatar/${p.id}?v=${p.avatar}`)} alt="" loading="lazy" /> : initials(p.name)}
        </span>
      ))}
      {total > people.length && <span className="mt-more">+{total - people.length}</span>}
    </span>
  );
}

function MeetingCard({ slug, m, index }: { slug: string; m: MeetingOverview; index: number }) {
  const t = useTranslations("meetingsPage");
  const tm = useTranslations("meetings");
  const fmt = formatters(useLocale() as Locale);
  const base = `/w/${slug}/m/${m.id}`;
  const runs = m.role === "host" || m.role === "cohost";
  return (
    <li className={`mt-card${m.next?.live ? " live" : ""}`} style={{ ...tint(m.color), "--i": index } as React.CSSProperties}>
      <div className="mt-top">
        <MeetingMark slug={slug} meeting={m} className="mt-mark" letters={2} />
        <div className="mt-title">
          <h2>
            <Link href={base} className="mt-link">
              {m.name}
            </Link>
          </h2>
          <span className="hint">{m.schedule}</span>
        </div>
        {m.role && <span className="st-pill st-open">{tm(`roles.${m.role}`)}</span>}
      </div>
      <p className="mt-next">
        {m.next?.live ? (
          <span className="pill live">{t("liveNow")}</span>
        ) : m.next ? (
          <>
            <span className="mt-next-label">{t("next")}</span>
            <strong>
              {fmt.dateShort(m.next.date)}
              {m.next.time && ` · ${m.next.time}`}
            </strong>
          </>
        ) : (
          <span className="hint">{t("noNext")}</span>
        )}
      </p>
      <div className="mt-people">
        <Faces slug={slug} people={m.people} total={m.peopleCount} />
        <span className="hint">{tm("people", { count: m.peopleCount })}</span>
      </div>
      <ul className="mt-stats">
        <li>
          <strong>{m.held}</strong> {t("held", { count: m.held })}
        </li>
        <li className={m.openActions ? "warn" : undefined}>
          <strong>{m.openActions}</strong> {t("openActions", { count: m.openActions })}
        </li>
        {m.lastHeld && <li className="hint">{t("last", { date: fmt.dayMonth(m.lastHeld) })}</li>}
      </ul>
      {/* One thing to do, by the person's part in the meeting, and its minutes */}
      <div className="mt-actions">
        {runs ? (
          <Link href={`${base}/control`} className="btn sm primary">
            <Icon name="screen" size={14} /> {t("control")}
          </Link>
        ) : (
          m.role &&
          m.role !== "observer" && (
            <Link href={`${base}/me`} className="btn sm primary">
              {m.next?.live ? t("join") : t("checkIn")}
            </Link>
          )
        )}
        <Link href={`${base}/history`} className="btn sm ghost">
          {t("history")}
        </Link>
      </div>
    </li>
  );
}
