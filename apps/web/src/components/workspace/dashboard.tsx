"use client";

import { formatters, type Locale } from "@ronde/i18n";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { openSampleAction, setActionStatusAction } from "@/app/w/[ws]/actions";
import type { DashboardData, DashboardPerson, NextSession } from "@/lib/server/dashboard";
import { withBasePath } from "@/lib/shared/base-path";
import { track } from "@/lib/shared/track";
import { daysBetween, heroSeats } from "@/lib/shared/workspace-lists";
import { MeetingMark } from "../meeting-mark";
import { initials } from "../shell/app-shell";
import { Icon } from "../shell/icons";

export interface Step {
  key: string;
  done: boolean;
  title: string;
  hint: string;
  href: string;
}

export interface MeetingCard {
  id: string;
  name: string;
  icon: string;
  image: number | null;
  color: number;
  schedule: string;
  participants: number;
  next: { date: string; live: boolean } | null;
  role: string | null;
}

/** A template offered to start the first meeting */
export interface Starter {
  ref: string;
  icon: string;
  name: string;
  description: string;
}

interface Props {
  slug: string;
  /** "morning", "afternoon" or "evening", in the person's time zone */
  moment: "morning" | "afternoon" | "evening";
  firstName: string;
  today: string;
  data: DashboardData;
  meetings: MeetingCard[];
  steps: Step[];
  canCreate: boolean;
  starters: Starter[];
  /** Faces of the sample meeting's fictitious team */
  sampleFaces: string[];
}

const tint = (color: number) => ({ "--c": `var(--c${color % 6})` }) as React.CSSProperties;
const order = (i: number) => ({ "--i": i }) as React.CSSProperties;

/** The workspace home: the next session in front, then the week, what is left to do, the team. Before the
 * first meeting, only the way to create it; and a card with nothing to show stays out of the way. */
export function Dashboard({ slug, moment, firstName, today, data, meetings, steps, canCreate, starters, sampleFaces }: Props) {
  const t = useTranslations("dashboard");
  const locale = useLocale() as Locale;
  const fmt = formatters(locale);
  const base = `/w/${slug}`;
  const done = steps.filter((s) => s.done).length;
  const head = (
    <header className="dash-head">
      <div>
        <p className="dash-date">{fmt.dateShort(today)}</p>
        <h1>{t(`hello.${moment}`, { name: firstName })}</h1>
      </div>
      {meetings.length > 0 && (
        <div className="dash-quick">
          <Link href={`${base}/calendar`} className="btn">
            <Icon name="calendar" size={16} /> {t("calendar")}
          </Link>
          {canCreate && (
            <Link href={`${base}/meetings/new`} className="btn primary">
              <Icon name="plus" size={16} /> {t("newMeeting")}
            </Link>
          )}
        </div>
      )}
    </header>
  );

  if (!meetings.length)
    return (
      <div className="page dash">
        {head}
        <section className="dash-card dash-first" aria-labelledby="dash-first">
          <h2 id="dash-first">{canCreate ? t("firstTitle") : t("noNext")}</h2>
          <p className="muted">{canCreate ? t("firstIntro") : t("noNextMember")}</p>
          {canCreate && (
            <>
              <ul className="first-starters">
                {starters.map((s, i) => (
                  <li key={s.ref} style={order(i + 1)}>
                    <Link href={`${base}/meetings/new?template=${encodeURIComponent(s.ref)}`} className="first-starter">
                      <span className="first-icon" aria-hidden="true">
                        {s.icon}
                      </span>
                      <strong>{s.name}</strong>
                      <span className="hint">{s.description}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <Link href={`${base}/meetings/new`} className="link">
                {t("firstAll")}
              </Link>
            </>
          )}
        </section>
        {canCreate && <SampleCard slug={slug} faces={sampleFaces} />}
      </div>
    );

  const weekEmpty = data.week.every((d) => !d.events.length);
  const pulseEmpty = !data.pulse.sessions && !data.pulse.actionsDone;
  const aside = !pulseEmpty || data.birthdays.length > 0;
  return (
    <div className="page dash">
      {head}

      {done < steps.length && (
        <section className="dash-card dash-steps" style={order(0)} aria-labelledby="dash-steps">
          <div className="dash-card-head">
            <h2 id="dash-steps">{t("gettingStarted")}</h2>
            <span className="hint">{t("progress", { done, total: steps.length })}</span>
          </div>
          <progress className="meter" value={done} max={steps.length} aria-labelledby="dash-steps" />
          <ol className="step-tiles">
            {steps
              .filter((s) => !s.done)
              .map((s) => (
                <li key={s.key}>
                  <Link href={s.href} className="step-tile">
                    <span className="step-mark" aria-hidden="true" />
                    <span className="step-text">
                      <strong>{s.title}</strong>
                      <span className="hint">{s.hint}</span>
                    </span>
                  </Link>
                </li>
              ))}
          </ol>
          {done > 0 && (
            <ul className="step-done" aria-label={t("stepsDone")}>
              {steps
                .filter((s) => s.done)
                .map((s) => (
                  <li key={s.key}>
                    <span className="step-mark" aria-hidden="true">
                      ✓
                    </span>
                    {s.title}
                  </li>
                ))}
            </ul>
          )}
        </section>
      )}

      <div className={aside ? "dash-grid" : "dash-grid solo"}>
        <div className="dash-main">
          {/* No session coming up although there are meetings: the list below says when each meets */}
          {data.next && (
            <section className="dash-card dash-hero" style={order(0)} aria-labelledby="dash-next">
              <Hero slug={slug} next={data.next} today={today} />
            </section>
          )}

          {!weekEmpty && (
            <section className="dash-card dash-week" style={order(2)} aria-labelledby="dash-week">
              <div className="dash-card-head">
                <h2 id="dash-week">{t("week")}</h2>
                <Link href={`${base}/calendar`} className="link">
                  {t("openCalendar")}
                </Link>
              </div>
              <ol className="week-strip">
                {data.week.map((d) => (
                  <li key={d.date} className={d.date === today ? "today" : d.date < today ? "past" : undefined}>
                    <span className="wk-day">
                      <span className="wk-name">
                        {new Date(`${d.date}T12:00:00Z`).toLocaleDateString(locale, { weekday: "short", timeZone: "UTC" })}
                      </span>
                      <span className="wk-num">{Number(d.date.slice(8))}</span>
                    </span>
                    {d.events.map((e) => (
                      <Link
                        key={`${e.meetingId}-${e.time}`}
                        href={`${base}/m/${e.meetingId}`}
                        className={`wk-event ${e.status}`}
                        style={tint(e.color)}
                      >
                        <span className="wk-time">{e.time}</span>
                        <span className="wk-name-m">{e.meeting}</span>
                      </Link>
                    ))}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {data.actions.length > 0 && <MyActions slug={slug} actions={data.actions} open={data.openActions} />}

          <section className="dash-card dash-meetings" style={order(5)} aria-labelledby="dash-meetings">
            <div className="dash-card-head">
              <h2 id="dash-meetings">{t("meetings")}</h2>
              <span className="hint">{meetings.length}</span>
            </div>
            <ul className="dash-meeting-list">
              {meetings.map((m) => (
                <li key={m.id}>
                  <Link href={`${base}/m/${m.id}`} className="dash-meeting" style={tint(m.color)}>
                    <MeetingMark slug={slug} meeting={m} className="dash-meeting-mark" />
                    <span className="dash-meeting-main">
                      <strong>{m.name}</strong>
                      <span className="hint">{m.schedule}</span>
                    </span>
                    <span className="dash-meeting-meta">
                      {m.next?.live ? (
                        <span className="pill live">{t("live")}</span>
                      ) : m.next ? (
                        <span className="hint">{t("nextOn", { date: fmt.dayMonth(m.next.date) })}</span>
                      ) : null}
                      <span className="hint">{t("people", { count: m.participants })}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>
        {aside && (
          <aside className="dash-aside">
            {!pulseEmpty && (
              <section className="dash-card dash-pulse" style={order(1)} aria-labelledby="dash-pulse">
                <h2 id="dash-pulse">{t("pulse")}</h2>
                <ul className="stats">
                  <Stat value={data.pulse.sessions} label={t("pulseSessions")} />
                  <Stat value={data.pulse.actionsDone} label={t("pulseActions")} />
                  <Stat value={data.pulse.people} label={t("pulsePeople")} href={`${base}/people`} />
                </ul>
              </section>
            )}

            {data.birthdays.length > 0 && (
              <section className="dash-card dash-team" style={order(4)} aria-labelledby="dash-team">
                <div className="dash-card-head">
                  <h2 id="dash-team">{t("birthdays")}</h2>
                </div>
                <ul className="bday-list">
                  {data.birthdays.map((b) => (
                    <li key={b.id}>
                      <Face slug={slug} p={b} />
                      <span className="bday-text">
                        <strong>{b.name}</strong>
                        <span className="hint">
                          {b.inDays === 0
                            ? t("bdayToday")
                            : b.inDays === 1
                              ? t("bdayTomorrow")
                              : t("bdayIn", { count: b.inDays, date: fmt.dayMonth(b.date) })}
                        </span>
                      </span>
                      {b.inDays === 0 && (
                        <span className="bday-cake" aria-hidden="true">
                          🎂
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

function Face({ slug, p }: { slug: string; p: DashboardPerson }) {
  return (
    <span className={`av sm${p.avatar ? " img" : ""}`} style={tint(p.color)} aria-hidden="true">
      {p.avatar ? <img src={withBasePath(`/api/w/${slug}/avatar/${p.id}?v=${p.avatar}`)} alt="" loading="lazy" /> : initials(p.name)}
    </span>
  );
}

/** The next session: the round table of its people, when it is, and what to do before it */
function Hero({ slug, next, today }: { slug: string; next: NextSession; today: string }) {
  const t = useTranslations("dashboard");
  const fmt = formatters(useLocale() as Locale);
  const base = `/w/${slug}/m/${next.meetingId}`;
  const days = daysBetween(today, next.date);
  const when = next.live ? t("liveNow") : days === 0 ? t("today") : days === 1 ? t("tomorrow") : t("inDays", { count: days });
  // The ready people first, from the top: the arc then runs exactly over their seats
  const ready = new Set(next.turns ? next.ready : []);
  // Over the ready seats shown, ending halfway to the next one; the whole ring once everyone is ready
  const { seats, more, share } = heroSeats(next.people, ready, 8);
  // Seats, ring and arc on one circle, 42% from the centre
  const R = 42;
  return (
    <div className={`hero${next.live ? " live" : ""}`} style={tint(next.color)}>
      <div className="hero-text">
        <p className="hero-kicker">{next.live ? t("kickerLive") : t("kickerNext")}</p>
        <h2 id="dash-next">
          <Link href={base} className="hero-title">
            {next.meeting}
          </Link>
        </h2>
        <p className="hero-when">
          <strong>{when}</strong>
          <span className="hint">
            {fmt.dateShort(next.date)} · {next.time} · {t("minutes", { count: next.durationMin })}
            {next.turns && next.people.length > 0 && ` · ${t("readyCount", { ready: next.ready.length, total: next.people.length })}`}
          </span>
        </p>
        <ul className="hero-facts">
          {next.checkIn !== null && (
            <li className={next.checkIn > 0 ? "ok" : "todo"}>
              <Icon name={next.checkIn > 0 ? "check" : "user"} size={15} />
              {next.checkIn > 0 ? t("checkInReady", { count: next.checkIn }) : t("checkInEmpty")}
            </li>
          )}
          {next.sheets.map((sheet) => (
            <li key={sheet.name} className={sheet.written ? "ok" : "todo"}>
              <Icon name={sheet.written ? "check" : "folder"} size={15} />
              {sheet.written ? t("sheetReady", { project: sheet.name }) : t("sheetEmpty", { project: sheet.name })}
            </li>
          ))}
          {next.attendance && (
            <li className={next.attendance === "yes" ? "ok" : "away"}>
              <Icon name={next.attendance === "yes" ? "check" : "close"} size={15} />
              {next.attendance === "yes" ? t("attending") : t("away")}
            </li>
          )}
        </ul>
        <div className="hero-actions">
          {next.live ? (
            <Link href={next.runs ? `${base}/control` : `${base}/me`} className="btn primary">
              {t("join")}
            </Link>
          ) : (
            next.checkIn !== null && (
              <Link href={`${base}/me`} className="btn primary">
                {next.checkIn > 0 ? t("editCheckIn") : t("fillCheckIn")}
              </Link>
            )
          )}
          {next.runs && (
            <Link href={`${base}/control`} className="btn">
              <Icon name="screen" size={16} /> {t("controlRoom")}
            </Link>
          )}
        </div>
      </div>
      <div className="hero-table" aria-hidden="true">
        <div className="hero-ring" />
        {/* The table getting ready: the arc grows to the share of check-ins filled in */}
        <svg className="hero-arc" viewBox="0 0 100 100" focusable="false">
          <circle
            cx="50"
            cy="50"
            r={R}
            pathLength={100}
            transform="rotate(-90 50 50)"
            style={{ strokeDasharray: `${seats.length ? share * 100 : 0} 100` }}
          />
        </svg>
        <div className="hero-center">
          <span className="hero-center-time">{next.live ? "●" : next.time}</span>
          <span className="hero-center-day">{next.live ? t("liveShort") : fmt.dayMonth(next.date)}</span>
        </div>
        {seats.map((p, i) => {
          const a = (i / seats.length) * Math.PI * 2 - Math.PI / 2;
          return (
            <span
              key={p.id}
              className={`hero-seat${ready.has(p.id) ? " ready" : ""}`}
              style={{ left: `${50 + R * Math.cos(a)}%`, top: `${50 + R * Math.sin(a)}%`, "--d": `${i * 0.08}s` } as React.CSSProperties}
              title={p.name}
            >
              <Face slug={slug} p={p} />
            </span>
          );
        })}
        {more > 0 && <span className="hero-more">+{more}</span>}
      </div>
    </div>
  );
}

/** A number counting up once when it shows; written to the DOM, not to state */
function Stat({ value, label, href }: { value: number; label: string; href?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || value === 0 || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 900);
      el.textContent = String(Math.round(value * (1 - (1 - p) ** 3)));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  const body = (
    <>
      <strong ref={ref}>{value}</strong>
      <span>{label}</span>
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className="stat">
          {body}
        </Link>
      ) : (
        <span className="stat">{body}</span>
      )}
    </li>
  );
}

function MyActions({ slug, actions, open }: { slug: string; actions: DashboardData["actions"]; open: number }) {
  const t = useTranslations("dashboard");
  const ta = useTranslations("actions");
  const router = useRouter();
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const tick = async (id: string) => {
    setTicked((s) => ({ ...s, [id]: true }));
    const res = await setActionStatusAction(slug, id, "done");
    if (!res.ok) setTicked((s) => ({ ...s, [id]: false }));
    // Leaves the tick on screen a moment before the list moves on
    setTimeout(() => router.refresh(), 700);
  };
  return (
    <section className="dash-card dash-actions" style={order(3)} aria-labelledby="dash-actions">
      <div className="dash-card-head">
        <h2 id="dash-actions">
          {t("myActions")} {open > 0 && <span className="side-count">{open}</span>}
        </h2>
        <Link href={`/w/${slug}/actions`} className="link">
          {t("seeAll")}
        </Link>
      </div>
      {actions.length ? (
        <ul className="dash-act-list">
          {actions.map((a) => (
            <li key={a.id} className={`dash-act${ticked[a.id] ? " ticked" : ""}`} style={tint(a.color)}>
              <button
                type="button"
                className="act-check"
                aria-pressed={!!ticked[a.id]}
                aria-label={ta("markDone", { text: a.text })}
                disabled={!!ticked[a.id]}
                onClick={() => tick(a.id)}
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path
                    d="M5 12.5l4.2 4.2L19 7"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <span className="dash-act-text">
                <span>{a.text}</span>
                <span className="hint">
                  <span className="act-dot" aria-hidden="true" /> {a.meeting}
                  {a.status === "doing" && <> · {ta("inProgress")}</>}
                  {a.carried >= 2 && <span className="st-pill act-late">{ta("carried", { count: a.carried })}</span>}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dash-clear">
          <span className="act-empty-mark" aria-hidden="true">
            <Icon name="check" size={20} />
          </span>
          {t("allClear")}
        </p>
      )}
    </section>
  );
}

/** Before the first meeting: a sample one to look around (a fictitious team, a month of history) */
function SampleCard({ slug, faces }: { slug: string; faces: string[] }) {
  const t = useTranslations("sample");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    setBusy(true);
    setError(null);
    const res = await openSampleAction(slug);
    if (!res.ok) {
      setBusy(false);
      setError(res.error);
      return;
    }
    track("sample_opened");
    router.push(`/w/${slug}/m/${res.data.id}/control`);
  };
  return (
    <section className="dash-card dash-sample" style={order(6)} aria-labelledby="dash-sample">
      <span className="sample-faces" aria-hidden="true">
        {faces.map((src, i) => (
          <img key={src} src={src} alt="" style={order(i)} />
        ))}
      </span>
      <div className="dash-sample-text">
        <h2 id="dash-sample">{t("exploreTitle")}</h2>
        <p className="muted">{t("exploreText")}</p>
        {error && (
          <p className="form-alert error" role="alert">
            {error}
          </p>
        )}
      </div>
      <button type="button" className="btn" onClick={open} disabled={busy} aria-busy={busy}>
        {busy ? t("preparing") : t("explore")}
      </button>
    </section>
  );
}
