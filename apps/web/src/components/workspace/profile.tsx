"use client";

import { formatters, type Locale } from "@ronde/i18n";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import type { Profile } from "@/lib/server/profile";
import { withBasePath } from "@/lib/shared/base-path";
import { MeetingMark } from "../meeting-mark";
import { initials } from "../shell/app-shell";
import { Icon } from "../shell/icons";
import { AbsencesCard } from "./absences";

const tint = (color: number) => ({ "--c": `var(--c${color % 6})` }) as React.CSSProperties;

/** A person's card in the directory: who they are, their meetings, their open actions, the thanks they received */
export function PersonProfile({ slug, profile: p }: { slug: string; profile: Profile }) {
  const t = useTranslations("profile");
  const tw = useTranslations("workspace");
  const tm = useTranslations("meetings");
  const fmt = formatters(useLocale() as Locale);
  const base = `/w/${slug}`;
  const rate = p.attendance.held ? Math.round((p.attendance.attended / p.attendance.held) * 100) : null;
  const year = new Date().getFullYear();
  return (
    <div className="page profile">
      <Link href={`${base}/people`} className="back-link">
        ← {t("back")}
      </Link>
      <header className="profile-head" style={tint(p.color)}>
        <span className={`av profile-av${p.avatar ? " img" : ""}`} aria-hidden="true">
          {p.avatar ? <img src={withBasePath(`/api/w/${slug}/avatar/${p.id}?v=${p.avatar}`)} alt="" /> : initials(p.name)}
        </span>
        <div className="profile-id">
          <h1>
            {p.name}
            {p.isMe && <span className="hint"> ({t("you")})</span>}
          </h1>
          <p className="profile-facts">
            {p.jobCategory && <span>{p.jobCategory}</span>}
            <a href={`mailto:${p.email}`}>{p.email}</a>
          </p>
          <ul className="profile-chips">
            {p.role ? <li>{tw(`roles.${p.role}`)}</li> : <li className="muted-chip">{t("noAccount")}</li>}
            {p.birthday && (
              <li>
                <span aria-hidden="true">🎂</span> {fmt.dayMonth(`${year}-${p.birthday}`)}
              </li>
            )}
            {p.removed && <li className="muted-chip">{t("removed")}</li>}
            {p.awayUntil && <li className="away-chip">{t("awayUntil", { date: fmt.dateShort(p.awayUntil) })}</li>}
          </ul>
        </div>
        <div className="profile-actions">
          {p.canEdit && (
            <Link href={`${base}/people?edit=${p.id}`} className="btn">
              {t("edit")}
            </Link>
          )}
          {!p.isMe && (
            <a href={`mailto:${p.email}`} className="btn">
              {t("email")}
            </a>
          )}
        </div>
      </header>

      <div className="profile-grid">
        <div className="profile-main">
          <section className="dash-card" style={{ "--i": 1 } as React.CSSProperties} aria-labelledby="pf-meetings">
            <div className="dash-card-head">
              <h2 id="pf-meetings">{t("meetings")}</h2>
              <span className="hint">{p.meetings.length}</span>
            </div>
            {p.meetings.length ? (
              <ul className="dash-meeting-list">
                {p.meetings.map((m) => (
                  <li key={m.id}>
                    <Link href={`${base}/m/${m.id}`} className="dash-meeting" style={tint(m.color)}>
                      <MeetingMark slug={slug} meeting={m} className="dash-meeting-mark" />
                      <span className="dash-meeting-main">
                        <strong>{m.name}</strong>
                      </span>
                      <span className="st-pill st-open">{tm(`roles.${m.role}`)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">{t("noMeetings")}</p>
            )}
          </section>

          <section className="dash-card" style={{ "--i": 2 } as React.CSSProperties} aria-labelledby="pf-actions">
            <div className="dash-card-head">
              <h2 id="pf-actions">{t("actions")}</h2>
              {p.isMe && (
                <Link href={`${base}/actions`} className="link">
                  {t("seeAll")}
                </Link>
              )}
            </div>
            {p.actions.length ? (
              <ul className="dash-act-list">
                {p.actions.map((a) => (
                  <li key={a.id} className="dash-act" style={tint(a.color)}>
                    <span className={`pf-status ${a.status}`} aria-hidden="true" />
                    <span className="dash-act-text">
                      <span>{a.text}</span>
                      <span className="hint">
                        <span className="act-dot" aria-hidden="true" /> {a.meeting}
                        {a.status === "doing" && <> · {t("inProgress")}</>}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">{t("noActions")}</p>
            )}
          </section>
        </div>

        <aside className="profile-aside">
          <AbsencesCard slug={slug} personId={p.id} isMe={p.isMe} canEdit={p.canEdit} absences={p.absences} delegates={p.delegates} />
          <section className="dash-card pf-presence" style={{ "--i": 3 } as React.CSSProperties} aria-labelledby="pf-presence">
            <h2 id="pf-presence">{t("presence")}</h2>
            {rate === null ? (
              <p className="hint">{t("noSessions")}</p>
            ) : (
              <div className="pf-ring-wrap">
                <svg className="pf-ring" viewBox="0 0 120 120" aria-hidden="true">
                  <circle cx="60" cy="60" r="50" className="pf-ring-bg" />
                  <circle cx="60" cy="60" r="50" className="pf-ring-fg" pathLength="100" style={{ "--p": rate } as React.CSSProperties} />
                </svg>
                <div className="pf-ring-text">
                  <strong>{rate}%</strong>
                  <span className="hint">{t("attended", { attended: p.attendance.attended, held: p.attendance.held })}</span>
                </div>
              </div>
            )}
          </section>

          <section className="dash-card" style={{ "--i": 4 } as React.CSSProperties} aria-labelledby="pf-kudos">
            <h2 id="pf-kudos">
              <Icon name="heart" size={16} /> {t("kudos")}
            </h2>
            {p.kudos.length ? (
              <ul className="pf-kudos">
                {p.kudos.map((k) => (
                  <li key={k.id} style={tint(k.fromColor)}>
                    <p>{k.text}</p>
                    <span className="hint">{t("kudoFrom", { name: k.from, date: fmt.dayMonth(k.date) })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">{t("noKudos")}</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
