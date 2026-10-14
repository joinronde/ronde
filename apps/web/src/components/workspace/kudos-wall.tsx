"use client";

import { formatters, type Locale } from "@ronde/i18n";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { EmptyHero } from "@/components/illustration";
import { ShowMore, useShowMore } from "@/components/show-more";
import type { DashboardPerson } from "@/lib/server/dashboard";
import type { KudosWall } from "@/lib/server/overview";
import { withBasePath } from "@/lib/shared/base-path";
import { initials } from "../shell/app-shell";

const tint = (color: number) => ({ "--c": `var(--c${color % 6})` }) as React.CSSProperties;
/** A slight tilt per card, the same on every render, like notes pinned on a board */
const TILTS = [-1.4, 0.8, -0.5, 1.2, -1, 0.4];

function Face({ slug, p }: { slug: string; p: DashboardPerson }) {
  return (
    <span className={`av sm${p.avatar ? " img" : ""}`} style={tint(p.color)} aria-hidden="true">
      {p.avatar ? <img src={withBasePath(`/api/w/${slug}/avatar/${p.id}?v=${p.avatar}`)} alt="" loading="lazy" /> : initials(p.name)}
    </span>
  );
}

/** The thanks of the whole workspace, pinned on a wall, and the birthdays of the month */
export function KudosWallView({ slug, wall, today }: { slug: string; wall: KudosWall; today: string }) {
  const t = useTranslations("kudosWall");
  const fmt = formatters(useLocale() as Locale);
  const year = today.slice(0, 4);
  // A wall of thanks grows for years: the latest first, more on demand
  const page = useShowMore(30);
  return (
    <div className="page kudos-page">
      <header className="kw-head">
        <div className="kw-hearts" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
            <span key={i} style={{ "--k": i } as React.CSSProperties}>
              ♥
            </span>
          ))}
        </div>
        <h1>{t("title")}</h1>
        <p className="muted">{t("intro")}</p>
        <p className="kw-stats">
          <strong>{t("given", { count: wall.month.given })}</strong>
          <span>{t("people", { count: wall.month.people })}</span>
        </p>
      </header>

      {wall.birthdays.length > 0 && (
        <section aria-labelledby="kw-bdays" className="kw-bdays">
          <h2 id="kw-bdays">{t("birthdays")}</h2>
          <ul>
            {wall.birthdays.map((b) => {
              const isToday = `${year}-${b.birthday}` === today;
              return (
                <li key={b.id} className={isToday ? "today" : undefined} style={tint(b.color)}>
                  <Face slug={slug} p={b} />
                  <span className="kw-bday-text">
                    <Link href={`/w/${slug}/people/${b.id}`}>{b.name}</Link>
                    <span className="hint">{isToday ? t("today") : fmt.dayMonth(`${year}-${b.birthday}`)}</span>
                  </span>
                  <span className="kw-cake" aria-hidden="true">
                    🎂
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {wall.kudos.length ? (
        <ul className="kw-wall" aria-label={t("wall")}>
          {wall.kudos.slice(0, page.limit).map((k, i) => (
            <li
              key={k.id}
              className="kw-card"
              style={{ ...tint(k.to.color), "--tilt": `${TILTS[i % TILTS.length]}deg`, "--i": Math.min(i, 14) } as React.CSSProperties}
            >
              <p className="kw-text">{k.text}</p>
              <p className="kw-who">
                <Face slug={slug} p={k.from} />
                <span className="kw-arrow" aria-hidden="true">
                  ➜
                </span>
                <Face slug={slug} p={k.to} />
                <span className="kw-names">
                  {t.rich("fromTo", {
                    from: k.from.name,
                    to: k.to.name,
                    strong: (c) => <strong>{c}</strong>,
                  })}
                </span>
              </p>
              <p className="kw-meta hint">
                {k.meeting} · {fmt.dayMonth(k.date)}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {wall.kudos.length > 0 && <ShowMore hidden={wall.kudos.length - page.limit} step={page.step} onMore={page.more} />}
      {wall.kudos.length ? null : <EmptyHero art="kudos" title={t("empty")} hint={t("emptyHint")} />}
    </div>
  );
}
