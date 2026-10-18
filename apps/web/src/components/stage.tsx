"use client";

import { hasTurns } from "@ronde/core/agenda";
import { markdownToHtml } from "@ronde/core/markdown";
import { elapsedOf, limitOf, type Step, spentOf } from "@ronde/core/meeting";
import type { ActionStatus, JobCategory, ProjectDTO, Section } from "@ronde/core/types";
import {
  allTabs,
  first,
  fmtMinutes,
  initials,
  isCheckInFilled,
  isCheckInReady,
  isCheckInStale,
  itemsOf,
  MOODS,
  mmss,
  mmssPlain,
  moodAverage,
  moodEmoji,
  plainItem,
  RATING_MIN_VOTES,
  STATUS_ICON,
} from "@ronde/core/util";
import { formatters } from "@ronde/i18n";
import { confetti, motionAllowed } from "@ronde/ui/effects";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { writersOf } from "@/lib/shared/sheets";
import { joinedOf, plannedStart, projectEntries, projectsWithTurn, sectionsHave, waitLabel, waitTone } from "@/lib/shared/stage";
import { AmbienceLayer, useAmbience } from "./ambience";
import { ItemText } from "./check-in-fields";
import { LineReactions } from "./line-reactions";
import { PokerStage } from "./poker";
import { PollBand } from "./polls";
import { HealthBadge, ProjectChip } from "./project-bits";
import { ProjectMark } from "./project-mark";
import { DrawShow } from "./random-tools";
import { RetroStage } from "./retro";
import { useRonde, useTick } from "./ronde-provider";
import { RoundTable } from "./roundtable";
import { Icon, type IconName } from "./shell/icons";
import { SlideStage } from "./slide";
import { SwipeRow } from "./swipe-row";

export function Avatar({ id, sm }: { id: string | null | undefined; sm?: boolean }) {
  const { people, avatarUrl } = useRonde();
  const m = id ? people[id] : undefined;
  const label = m ? initials(m.name) : "★";
  return (
    <span
      className={"av" + (sm ? " sm" : "") + (m?.avatarVer ? " img" : "")}
      style={{ "--c": `var(--c${(m?.color ?? 0) % 6})` } as React.CSSProperties}
      aria-hidden="true"
    >
      {m?.avatarVer ? <img src={avatarUrl(m.id, m.avatarVer)} alt="" loading="lazy" draggable={false} /> : label}
    </span>
  );
}

/** Job category: the first one in the settings keeps the accent colour, the next ones take the palette */
export function JobCategoryTag({ category }: { category: JobCategory }) {
  const { s } = useRonde();
  const label = category;
  const i = s.settings.jobCategories.indexOf(label);
  const c = i <= 0 ? "var(--accent)" : `var(--c${(i + 3) % 6})`;
  return (
    <span className="role" style={{ "--rc": c } as React.CSSProperties}>
      {label}
    </span>
  );
}

export function StatusPill({ status }: { status: ActionStatus }) {
  const t = useTranslations("actionStatus");
  return (
    <span className={`st-pill st-${status}`}>
      {STATUS_ICON[status]} {t(status)}
    </span>
  );
}

const C = 2 * Math.PI * 44;

/** Circular timer of a person; static when the step is not live */
/** Icon of a module block in the agenda strip */
/** The icon of each part of the agenda */
export const BLOCK_ICON: Record<string, IconName> = {
  intro: "play",
  round: "people",
  projects: "folder",
  topics: "pin",
  retro: "search",
  timebox: "hourglass",
  poker: "cards",
  slide: "screen",
};

export function Timer({ stepKey, live }: { stepKey: string; live: boolean }) {
  const t = useTranslations("stage");
  const { s, now, agenda } = useRonde();
  useTick(live ? 250 : 60_000);
  const m = s.meeting;
  const limit = limitOf(
    m,
    stepKey,
    s.settings.speakSec,
    agenda.find((x) => x.key === stepKey),
  );
  const el = spentOf(m, stepKey, now());
  if (!live)
    return (
      <div className="timer static">
        <div>
          <div className="t">{mmssPlain(el)}</div>
          <div className="lbl">{el > limit ? t("speakingTimeOver", { over: mmssPlain(el - limit) }) : t("speakingTime")}</div>
        </div>
      </div>
    );
  const rem = limit - el;
  const running = !!m?.timer.running;
  const cls = [
    "timer",
    rem >= 0 && rem <= 30_000 ? "warn" : "",
    rem >= 0 && rem <= 10_000 && running ? "final" : "",
    rem < 0 ? "over" : "",
    running ? "" : "paused",
  ].join(" ");
  return (
    <div className={cls} role="timer">
      <svg className="ring" viewBox="0 0 100 100" aria-hidden="true">
        <circle className="trk" cx="50" cy="50" r="44" />
        <circle
          className="val"
          cx="50"
          cy="50"
          r="44"
          strokeDasharray={C}
          strokeDashoffset={C * Math.min(1, el / limit)}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div>
        <div className="t">{mmss(rem)}</div>
        <div className="lbl">
          {rem < 0 ? t("timeOver") : running ? t("remainingOf", { limit: mmssPlain(limit) }) : t("pausedOf", { limit: mmssPlain(limit) })}
        </div>
      </div>
    </div>
  );
}

/** Time elapsed on the current step (intro, questions, open topics) */
export function UpCount({ className }: { className: string }) {
  const { s, now } = useRonde();
  useTick(500);
  return <span className={className}>{mmssPlain(elapsedOf(s.meeting, now()))}</span>;
}

/** An item of a check-in on the stage: who wrote it, its text, the project it is about */
interface Entry {
  ownerId: string;
  text: string;
  projectId: string | null;
  /** Shown before the text: the author (project round) or the project (a person's turn) */
  tag?: React.ReactNode;
}

function ListCard({ sec, entries, spot, joinable }: { sec: Section; entries: Entry[]; spot?: string | null; joinable?: boolean }) {
  const t = useTranslations("stage");
  const { s } = useRonde();
  const items = entries.map((e) => e.text);
  const has = items.length > 0;
  const kind = sec.kind === "extra" ? "other extra" : sec.kind;
  const hit = (i: string) => !!spot && plainItem(i) === spot;
  // On the shared screen, the highlighted item stays visible even in a long check-in
  // (not elsewhere: neither the control-room preview nor "My screen" should scroll someone's page)
  const card = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = spot ? card.current?.querySelector(".spot-hit") : null;
    if (el && document.body.classList.contains("screen-mode") && !el.closest(".stage.mini"))
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [spot]);
  return (
    <div ref={card} className={`card ${kind} ${has ? "has" : ""} ${items.some(hit) ? "spot-in" : ""}`}>
      <h3>
        {sec.label}
        <span className="n">{has && sec.type !== "text" ? items.length : ""}</span>
      </h3>
      {has && sec.type === "text" ? (
        <div className="free">
          {entries.map((e, n) => (
            <p key={n} className={hit(e.text) ? "spot-hit" : undefined} style={{ "--i": n } as React.CSSProperties}>
              {e.tag}
              {e.text}
            </p>
          ))}
        </div>
      ) : has ? (
        <ul className={sec.type === "checklist" ? "checks" : undefined}>
          {entries.map((e, n) => {
            const cs = s.comments.filter(
              (c) => c.ownerId === e.ownerId && c.section === sec.k && c.itemText === e.text && c.projectId === e.projectId,
            );
            const likes = cs.filter((c) => !c.text).length;
            const notes = cs.filter((c) => c.text);
            return (
              <li key={n} className={hit(e.text) ? "spot-hit" : undefined} style={{ "--i": n } as React.CSSProperties}>
                {e.tag}
                <ItemText item={e.text} />
                {joinable ? (
                  <LineActions entry={e} section={sec.k} notes={notes.length} />
                ) : (
                  (likes > 0 || notes.length > 0) && (
                    <span className="item-rx">
                      {likes > 0 && <span>👍 {likes}</span>}
                      {notes.length > 0 && <span title={notes.map((c) => c.text).join("\n")}>💬 {notes.length}</span>}
                    </span>
                  )
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="empty">{t("nothingEntered")}</p>
      )}
    </div>
  );
}

/** Big name: the size shrinks until the longest word fits in the column */
function FitName({ name }: { name: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let width = -1;
    const fit = (force = false) => {
      if (!force && el.clientWidth === width) return;
      width = el.clientWidth;
      // Measure without breaking words; breaking stays a last resort (CSS)
      el.style.fontSize = "";
      el.style.overflowWrap = "normal";
      const base = parseFloat(getComputedStyle(el).fontSize);
      let size = base;
      for (let i = 0; i < 6 && el.scrollWidth > el.clientWidth + 1 && size > base * 0.45; i++) {
        size = Math.max(base * 0.45, size * (el.clientWidth / el.scrollWidth) * 0.98);
        el.style.fontSize = size + "px";
      }
      el.style.overflowWrap = "";
    };
    fit(true);
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    void document.fonts?.ready.then(() => fit(true));
    return () => ro.disconnect();
  }, [name]);
  return <h2 ref={ref}>{name}</h2>;
}

/** `spot`: check-in item highlighted from the control room, marked in place (the rest of the check-in fades) */
function SpeakerBody({ step, live, spot, joinable }: { step: Step; live: boolean; spot?: string | null; joinable?: boolean }) {
  const t = useTranslations("stage");
  const { s, members, sections, agenda, projectLogo } = useRonde();
  const id = step.id!;
  const m = members[id];
  const f = s.checkIns[id];
  const lw = s.lastWeek[id];
  // What was planned last time and is now done, in their own tab or a project's
  const done = allTabs(f).done.map((x) => plainItem(x).toLowerCase());
  const acts = s.actions.filter((a) => a.ownerId === id && a.status !== "done");
  // The projects the person wrote about: presented at their own step when the project round gives them one,
  // otherwise here (no project round, a paused project…), each item tagged with its project
  const withTurn = projectsWithTurn(agenda);
  const theirs = s.projects.filter((p) => isCheckInFilled(f?.byProject[p.id]));
  const elsewhere = theirs.filter((p) => withTurn.has(p.id));
  const entriesOf = (sec: Section): Entry[] => [
    ...itemsOf(f, sec).map((text) => ({
      ownerId: id,
      text,
      projectId: null,
      tag: <Faces ids={joinedOf(s, { ownerId: id, projectId: null, section: sec.k, text })} />,
    })),
    ...theirs
      .filter((p) => !withTurn.has(p.id))
      .flatMap((p) =>
        itemsOf(f?.byProject[p.id], sec).map((text) => ({
          ownerId: id,
          text,
          projectId: p.id,
          tag: (
            <>
              <ProjectChip name={p.name} color={p.color} logo={projectLogo(p)} />
              <Faces ids={joinedOf(s, { ownerId: id, projectId: p.id, section: sec.k, text })} />
            </>
          ),
        })),
      ),
  ];
  return (
    <div className="speaker" style={{ "--c": `var(--c${(m?.color ?? 0) % 6})` } as React.CSSProperties}>
      <div className="who">
        <div className="who-id">
          <Avatar id={id} />
          <div className="who-name">
            <FitName name={m?.name ?? ""} />
            <div style={{ marginTop: ".35em" }}>{m && <JobCategoryTag category={m.jobCategory} />}</div>
          </div>
        </div>
        {elsewhere.length > 0 && (
          <p className="also-projects">
            {t("alsoInProjects")}{" "}
            {elsewhere.map((p) => (
              <ProjectChip key={p.id} name={p.name} color={p.color} logo={projectLogo(p)} />
            ))}
          </p>
        )}
        {isCheckInStale(f, s.lastArchivedAt) && <p className="muted">{t("staleCheckIn")}</p>}
        <Timer stepKey={step.key} live={live} />
        {!!lw?.next.length && (
          <div className="lastweek">
            <h4>{t("plannedLastTime")}</h4>
            <ul>
              {lw.next.map((n, i) => (
                <li key={i} className={done.includes(n.toLowerCase()) ? "hit" : ""} style={{ "--i": i } as React.CSSProperties}>
                  {n}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className={spot ? "board spotting" : "board"}>
        {sections.map((sec) => (
          <ListCard key={sec.k} sec={sec} entries={entriesOf(sec)} spot={spot} joinable={joinable} />
        ))}
        {acts.length > 0 && (
          <div className="card acts wide">
            <h3>
              {t("openActions")}
              <span className="n">{acts.length}</span>
            </h3>
            <ul>
              {acts.map((a) => (
                <li key={a.id}>
                  <StatusPill status={a.status} />
                  <ActText a={a} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** An open action on the stage, with where it stands in its owner's words, so the room hears what was tried */
function ActText({ a }: { a: { text: string; progress: string | null } }) {
  return (
    <span className="act-tx">
      {a.text}
      {a.progress && <span className="act-prog">{a.progress}</span>}
    </span>
  );
}

/**
 * On a participant's own screen, after a line of the turn: 👍 (who liked it in its tooltip), and "me too" to put
 * one's face on a line of someone's round
 */
function LineActions({ entry, section, notes }: { entry: Entry; section: string; notes: number }) {
  const t = useTranslations("me");
  const { s, rpc } = useRonde();
  const me = s.viewer.memberId;
  const plain = plainItem(entry.text);
  const joined = !!me && joinedOf(s, { ...entry, section }).includes(me);
  const target = { ownerId: entry.ownerId, section, itemText: entry.text, projectId: entry.projectId };
  return (
    <span className="line-actions">
      <LineReactions target={target} />
      {notes > 0 && <span className="item-rx">💬 {notes}</span>}
      {me && me !== entry.ownerId && entry.projectId === null && (
        <button
          type="button"
          className={"join-btn" + (joined ? " on" : "")}
          aria-pressed={joined}
          aria-label={joined ? t("leaveLine", { text: plain }) : t("joinLine", { text: plain })}
          title={joined ? t("leaveLineHint") : t("joinLineHint")}
          onClick={() => rpc({ op: "item.with", ...target, on: !joined })}
        >
          {joined ? "✓" : "+"} {t("joined")}
        </button>
      )}
    </span>
  );
}

/** Faces of a few people, overlapping, their names for screen readers and on hover */
export function Faces({ ids }: { ids: string[] }) {
  const { members } = useRonde();
  const shown = ids.filter((id) => members[id]);
  if (!shown.length) return null;
  const names = shown.map((id) => members[id]!.name).join(", ");
  // Three faces at most, a little apart, and their first names beside them: readable from across the room
  // however many joined (the others counted)
  const faces = shown.slice(0, 3);
  const more = shown.length - faces.length;
  return (
    <span className="faces" title={names}>
      {faces.map((id) => (
        <Avatar key={id} id={id} sm />
      ))}
      <span className="faces-names" aria-hidden="true">
        {faces.map((id) => first(members[id]!.name)).join(", ")}
        {more > 0 && ` +${more}`}
      </span>
      <span className="sr-only">{names}</span>
    </span>
  );
}

/** A project of the project round: its sheet, then what its people wrote, each item with its author */
function ProjectBody({ step, live, spot }: { step: Step; live: boolean; spot?: string | null }) {
  const t = useTranslations("stage");
  const fmt = formatters(useLocale());
  const { s, members, sections, projectLogo } = useRonde();
  const p = s.projects.find((x) => x.id === step.projectId);
  if (!p) return null;
  const order = [...(step.speakers ?? []), ...s.members.map((m) => m.id)];
  const acts = s.actions.filter((a) => a.projectId === p.id && a.status !== "done");
  // Its people away (members, and whoever wrote about it), faded after the ones speaking
  const writers = writersOf(s, p.id, sections);
  const others = [...new Set([...p.memberIds, ...writers])].filter((id) => members[id] && !step.speakers?.includes(id));
  const wrote = new Set(writers);
  return (
    <div className="speaker project-step" style={{ "--c": `var(--c${p.color % 6})` } as React.CSSProperties}>
      <div className="who">
        <div className="who-id">
          {/* The project's logo where a person's face would be */}
          <ProjectMark project={p} src={projectLogo(p)} />
          <div className="who-name">
            <FitName name={p.name} />
            <div className="project-meta">
              {p.theme && <span className="theme-tag">{p.theme.name}</span>}
              <HealthBadge health={p.sheet?.health ?? p.health} />
              {p.targetDate && <span className="muted">{t("targetDate", { date: fmt.dateShort(p.targetDate) })}</span>}
              {p.progress != null && (
                <span className="project-progress">
                  <progress className="meter" max={1} value={p.progress} aria-hidden="true" />
                  <span className="muted">{t("projectProgressDone", { percent: fmt.percent(p.progress) })}</span>
                </span>
              )}
            </div>
          </div>
        </div>
        {p.summary && <p className="project-summary">{p.summary}</p>}
        {(!!step.speakers?.length || others.length > 0) && (
          <ul className="project-people" aria-label={t("projectSpeakers")}>
            {(step.speakers ?? []).map((id, i) => (
              <li key={id} className={wrote.has(id) ? "wrote" : undefined} style={{ "--i": i } as React.CSSProperties}>
                <Avatar id={id} />
                <span>
                  {members[id]?.name}
                  {id === p.leadId && <small>{t("projectLead")}</small>}
                </span>
              </li>
            ))}
            {others.map((id) => (
              <li key={id} className="away">
                <Avatar id={id} sm />
                <span>
                  {members[id]?.name}
                  {/* Not speaking: said absent only when marked so (someone out of the speaking order is not) */}
                  {s.meeting?.absent.includes(id) && <small>{t("away")}</small>}
                </span>
              </li>
            ))}
          </ul>
        )}
        <Timer stepKey={step.key} live={live} />
        {p.sheet?.headline.trim() && (
          <figure className="project-headline">
            <div className="md" dangerouslySetInnerHTML={{ __html: markdownToHtml(p.sheet.headline) }} />
            {p.sheet.headlineById && members[p.sheet.headlineById] && (
              <figcaption>
                <Avatar id={p.sheet.headlineById} sm />
                {members[p.sheet.headlineById]?.name}
              </figcaption>
            )}
          </figure>
        )}
      </div>
      <div className={spot ? "board spotting" : "board"}>
        {sections.map((sec) => (
          <ListCard
            key={sec.k}
            sec={sec}
            entries={projectEntries(s.checkIns, order, p.id, sec).map((e) => ({
              ...e,
              projectId: p.id,
              // Its author, then whoever joined it
              tag: (
                <span className="item-author">
                  <Faces ids={[e.ownerId, ...joinedOf(s, { ...e, projectId: p.id, section: sec.k })]} />
                </span>
              ),
            }))}
            spot={spot}
          />
        ))}
        {acts.length > 0 && (
          <div className="card acts wide">
            <h3>
              {t("openActions")}
              <span className="n">{acts.length}</span>
            </h3>
            <ul>
              {acts.map((a) => (
                <li key={a.id}>
                  <StatusPill status={a.status} />
                  <ActText a={a} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** A project of the meeting, by id */
export const projectOf = (projects: ProjectDTO[], id: string | undefined) => projects.find((p) => p.id === id);

// Still offered here: the control room and the personal page take them from the stage
export { joinedOf, projectEntries, projectsWithTurn, sectionsHave };

/**
 * Pre-meeting pill: the start time, then the time left, with a slowly breathing dot
 * (the blinking red stays reserved for live, so nobody thinks the meeting has started).
 */
export function WaitPill() {
  const t = useTranslations("stage");
  const locale = useLocale();
  const { s, now, hydrated } = useRonde();
  useTick(1000);
  // Nothing before load: the server and the browser agree on the first render
  if (!hydrated || !s.meeting) return <span className="pill wait">{t("beforeMeeting")}</span>;
  const ms = plannedStart(s.meeting) - now();
  return (
    <span className={"pill wait" + waitTone(ms)} title={t("notStartedYet")}>
      {waitLabel(ms, s.meeting, locale, t)}
    </span>
  );
}

function Countdown() {
  const t = useTranslations("stage");
  const locale = useLocale();
  const { s, now, hydrated } = useRonde();
  useTick(500);
  // Computed in the browser time zone: nothing before load, so the server and the browser agree
  if (!hydrated) return <div className="countdown">&nbsp;</div>;
  const start = plannedStart(s.meeting!);
  const ms = start - now();
  if (ms <= 0) return <div className="countdown now">{t("itsTime")}</div>;
  // Far ahead, in words (the date is written above): "tomorrow", "in 9 days"; the clock only in the last hours
  if (ms > 3_600_000 * 12) {
    const midnight = (at: number) => new Date(at).setHours(0, 0, 0, 0);
    const days = Math.round((midnight(start) - midnight(now())) / 86_400_000);
    const words = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    return <div className="countdown far">{days >= 1 ? words.format(days, "day") : words.format(Math.round(ms / 3_600_000), "hour")}</div>;
  }
  const h = Math.floor(ms / 3_600_000);
  const rest = ms - h * 3_600_000;
  return <div className="countdown">{h > 0 ? `${h} h ${String(Math.floor(rest / 60000)).padStart(2, "0")}` : mmssPlain(rest)}</div>;
}

/** Team mood, anonymous: number of people per mood */
export function MoodSummary() {
  const t = useTranslations("stage");
  const tMoods = useTranslations("moods");
  const fmt = formatters(useLocale());
  const { s } = useRonde();
  if (!s.settings.moodEnabled || !s.mood.total) return null;
  const max = Math.max(...s.mood.counts, 1);
  const avg = moodAverage(s.mood.counts);
  return (
    <div className="mood-sum">
      <div className="eyebrow">{t("moodTitle", { count: s.mood.total })}</div>
      <div className="mood-row">
        <span className="mood-avg" title={avg !== null ? t("moodAverage", { avg: fmt.decimal(avg) }) : ""}>
          {moodEmoji(avg)}
        </span>
        <div className="mood-bars">
          {MOODS.map((m, i) => (
            <div key={m.v} className="mood-col" title={t("moodCount", { mood: tMoods(m.key), count: s.mood.counts[i]! })}>
              <span className="mood-bar" style={{ height: `${(s.mood.counts[i]! / max) * 100}%` }} />
              <span className="mood-e">{m.e}</span>
              <span className="mood-n">{s.mood.counts[i]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** A star of the usefulness vote, outlined; filled by its parent's color when on */
export function Star() {
  return (
    <svg className="star" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 2.9l2.7 5.55 6.1.9-4.4 4.3 1.04 6.06L12 16.85l-5.44 2.86 1.04-6.06-4.4-4.3 6.1-.9z" />
    </svg>
  );
}

/**
 * How useful the meeting was, as the votes come in: the average fills five stars. On the shared screen, a line
 * tells the room where to vote (their screen or their phone).
 */
export function RatingSummary({ room }: { room?: boolean }) {
  const t = useTranslations("stage");
  const fmt = formatters(useLocale());
  const { s } = useRonde();
  if (!s.modules.rating) return null;
  // Below the threshold the server keeps the counts to itself: the stars wait, empty
  const shown = s.rating.total >= RATING_MIN_VOTES;
  const avg = shown ? moodAverage(s.rating.counts) : null;
  return (
    <div className="rating-sum">
      <div className="eyebrow">{t("ratingTitle", { count: s.rating.total })}</div>
      <div className="rating-row">
        {/* An image named by its average; empty stars before enough votes say nothing (the title above does) */}
        <span
          className="rating-stars-avg"
          {...(avg !== null ? { role: "img", "aria-label": t("ratingAverage", { avg: fmt.decimal(avg) }) } : { "aria-hidden": true })}
        >
          <span className="rating-off">
            {[1, 2, 3, 4, 5].map((v) => (
              <Star key={v} />
            ))}
          </span>
          <span className="rating-on" style={{ width: `${((avg ?? 0) / 5) * 100}%` }}>
            {[1, 2, 3, 4, 5].map((v) => (
              <Star key={v} />
            ))}
          </span>
        </span>
        {avg !== null && (
          <span className="rating-avg" key={s.rating.total}>
            {fmt.decimal(avg)}
            <small>/5</small>
          </span>
        )}
      </div>
      {!shown && s.rating.total > 0 && <p className="muted rating-how">{t("ratingPrivate", { min: RATING_MIN_VOTES })}</p>}
      {room && <p className="muted rating-how">{t("ratingHow")}</p>}
    </div>
  );
}

/** Icebreaker answers per page, depending on the available space */
const ICE_PAGE = { mini: 4, full: 8 };
const ICE_ROTATE_MS = 8000;

/**
 * Icebreaker answers. Past one page (two rows), pages rotate by themselves:
 * the shared screen keeps a stable height, even with the whole team.
 */
export function IcebreakerCards({ mini }: { mini?: boolean }) {
  const t = useTranslations("stage");
  const { s, nameOf } = useRonde();
  const q = s.meeting?.icebreaker;
  const per = mini ? ICE_PAGE.mini : ICE_PAGE.full;
  const pages = Math.max(1, Math.ceil(s.answers.length / per));
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  // New answer: show the page where it lands
  const count = s.answers.length;
  const prevCount = useRef(count);
  useEffect(() => {
    if (count > prevCount.current) setPage(Math.floor((count - 1) / per));
    prevCount.current = count;
  }, [count, per]);
  useEffect(() => {
    if (pages <= 1 || paused) return;
    const timer = setInterval(() => setPage((p) => (p + 1) % pages), ICE_ROTATE_MS);
    return () => clearInterval(timer);
  }, [pages, paused, page]);
  if (!q) return null;
  const cur = Math.min(page, pages - 1);
  const answers = s.answers.slice(cur * per, cur * per + per);
  return (
    <div className="ice" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="ice-top">
        <div className="eyebrow">{count ? t("icebreakerCount", { count }) : t("icebreaker")}</div>
        {pages > 1 && (
          <div className="ice-pages" role="group" aria-label={t("answerPages")}>
            {Array.from({ length: pages }, (_, i) => (
              <button
                key={i}
                type="button"
                aria-label={t("pageOf", { page: i + 1, pages })}
                aria-current={i === cur ? "true" : undefined}
                onClick={() => setPage(i)}
              >
                {i === cur && !paused && <i key={cur} style={{ animationDuration: ICE_ROTATE_MS + "ms" }} />}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="ice-q">
        <Icon name="snowflake" size={22} />
        {q}
      </div>
      {answers.length ? (
        <div className={"ice-grid" + (pages > 1 ? " paged" : "")} key={cur}>
          {answers.map((a, i) => (
            <div className="ice-card" key={a.byId} title={a.text} style={{ "--i": i } as React.CSSProperties}>
              <Avatar id={a.byId} sm />
              <div>
                <div className="who2">{first(nameOf(a.byId))}</div>
                <p>{a.text}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">{t("answerFromMe")}</p>
      )}
    </div>
  );
}

function IntroBody({ mini }: { mini?: boolean }) {
  const t = useTranslations("stage");
  const fmt = formatters(useLocale());
  const { s, agenda } = useRonde();
  const { ambience, motion } = useAmbience();
  const m = s.meeting!;
  const started = !!m.startedAt;
  // The people who take a turn; without a round table (a retrospective on its board), everyone of the meeting
  const speakers = agenda.filter((x) => x.type === "speaker").map((x) => x.id!);
  const ids = speakers.length ? speakers : s.members.map((p) => p.id);
  const checkIns = hasTurns(s.settings.agenda);
  const ready = Object.fromEntries(ids.map((id) => [id, isCheckInReady(s.checkIns[id], s.lastArchivedAt)]));
  const readyN = ids.filter((id) => ready[id]).length;
  const acts = s.actions.filter((a) => a.status !== "done");
  const ann = s.settings.announcements;
  const theme = !started ? ambience : null;
  return (
    <>
      {theme && motion && <AmbienceLayer ambience={theme} count={mini ? 8 : 18} />}
      <div className="intro2">
        <RoundTable
          key={started ? "go" : "wait"}
          ids={ids}
          intro
          numbered={started && checkIns}
          ready={started || !checkIns ? undefined : ready}
          center={
            <>
              <span className="big">{ids.length}</span>
              <span className="small">
                {started && checkIns ? t("speakEach", { time: mmssPlain(s.settings.speakSec * 1000) }) : t("aroundTable")}
              </span>
            </>
          }
        />
        <div className="cascade" style={{ "--d": started ? "1.2s" : "0s" } as React.CSSProperties}>
          {theme && (
            <div className="ambience-tag" style={{ "--i": 0 } as React.CSSProperties}>
              {theme.greeting}
            </div>
          )}
          <div className="eyebrow" style={{ "--i": 0 } as React.CSSProperties}>
            {started ? t("teamMeeting") : t("startingSoon")}
          </div>
          <h2 style={{ "--i": 1 } as React.CSSProperties}>{s.settings.teamName}</h2>
          <div className="date" style={{ "--i": 2 } as React.CSSProperties}>
            {fmt.date(m.date)}
            {!started && ` · ${m.time}`}
          </div>
          {!started && (
            <div style={{ "--i": 3 } as React.CSSProperties}>
              <Countdown />
              {checkIns && (
                <div className="ready-bar">
                  <span className="track">
                    <i style={{ width: (ids.length ? (readyN / ids.length) * 100 : 0) + "%" }} />
                  </span>
                  {t("checkInsReady", { ready: readyN, total: ids.length })}
                </div>
              )}
            </div>
          )}
          {ann.length ? (
            <ul className="announce">
              {ann.map((a, i) => (
                <li key={i} style={{ "--i": i + (started ? 3 : 4) } as React.CSSProperties}>
                  {a}
                </li>
              ))}
            </ul>
          ) : (
            started && (
              <p className="muted" style={{ marginTop: "1.2em", "--i": 3 } as React.CSSProperties}>
                {t("noAnnouncement")}
              </p>
            )
          )}
          {started && acts.length > 0 && (
            <div style={{ "--i": ann.length + 4 } as React.CSSProperties}>
              <div className="eyebrow sub-h">{t("openActionsCount", { count: acts.length })}</div>
              <ul className="lineup">
                {acts.map((a) => (
                  <li key={a.id}>
                    <Avatar id={a.ownerId} sm />
                    <span>{a.text}</span>
                    <span className="proj">
                      <StatusPill status={a.status} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      <div className="intro-bottom">
        <IcebreakerCards mini={mini} />
        <MoodSummary />
      </div>
    </>
  );
}

function QaBody({ step }: { step: Step }) {
  const t = useTranslations("stage");
  const { s, agenda, nameOf } = useRonde();
  const items = s.interactions.filter((i) => i.stepKey === step.of);
  const of = agenda.find((x) => x.key === step.of);
  return (
    <div>
      <h2 style={{ fontSize: "2.1em" }}>{t("qaTitle")}</h2>
      <p className="muted" style={{ margin: ".3em 0 1em" }}>
        {of?.type === "speaker" ? t("afterSpeaker", { name: of.label }) : t("afterStep", { step: of?.label ?? "" })}
      </p>
      <ul className="qalist">
        {items.map((x) => (
          <li key={x.id} className={x.resolved ? "done" : ""}>
            <Avatar id={x.byId} sm />
            <div>
              <strong>{nameOf(x.byId)}</strong>
              {x.targetId && <span className="muted"> → {first(nameOf(x.targetId))}</span>}
              {x.type === "question" ? <p>{x.text}</p> : <p className="muted">{t("asksToSpeak")}</p>}
            </div>
            <span className="kind">
              {x.resolved ? `✓ ${t("handled")}` : x.type === "hand" ? `✋ ${t("raisedHand")}` : `❓ ${t("question")}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MiscBody() {
  const t = useTranslations("stage");
  const tAgenda = useTranslations("agenda");
  const { s, nameOf, host } = useRonde();
  const topics = [...s.topics].sort((a, b) => Number(a.done) - Number(b.done) || b.votes - a.votes || a.createdAt - b.createdAt);
  return (
    <div>
      <h2 style={{ fontSize: "2em", marginBottom: ".6em" }}>{tAgenda("topics")}</h2>
      {topics.length ? (
        <ul className="topics">
          {topics.map((x) => (
            <li key={x.id} className={x.done ? "done" : ""}>
              <span>{x.done ? "✓" : "○"}</span>
              <span className="tx">{x.text}</span>
              <span className="by">{nameOf(x.byId) || host}</span>
              {x.votes > 0 && <span className="votes">▲ {x.votes}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{t("noTopics")}</p>
      )}
      {s.parking.length > 0 && (
        <div className="parking-stage">
          <h3>🅿️ {t("parking")}</h3>
          <ul>
            {s.parking.map((x) => (
              <li key={x.id}>{x.text}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Number counting up to its value when it first shows, then following it as it is: a value that keeps moving (the
 * duration of a meeting still running) must not start its count again at every tick
 */
function useCountUp(target: number, ms = 1200) {
  const [k, setK] = useState(0);
  useEffect(() => {
    // Animations off: the number shows right away
    if (!motionAllowed()) {
      setK(1);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const x = Math.min(1, (t - t0) / ms);
      setK(x);
      if (x < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ms]);
  return k >= 1 ? target : target * (1 - (1 - k) ** 3);
}

function EndBody({ celebrate }: { celebrate?: boolean }) {
  const t = useTranslations("stage");
  const locale = useLocale();
  const fmt = formatters(locale);
  const { s, agenda, now, nameOf, focusNow } = useRonde();
  // Next session planned after this one, by the schedule
  const nextDate = s.settings.schedule.upcoming.find((o) => !o.cancelled && o.date > (s.meeting?.date ?? ""))?.date;
  const m = s.meeting!;
  const sp = agenda.filter((x) => x.type === "speaker");
  const lim = s.settings.speakSec * 1000;
  const end = m.endedAt ?? now();
  const max = Math.max(lim * 1.5, ...sp.map((x) => spentOf(m, x.key, end)));
  const dur = m.startedAt ? end - m.startedAt : 0;
  const shown = useCountUp(dur);
  const [grown, setGrown] = useState(false);
  const goal = dur > 0 && dur <= s.settings.targetMin * 60_000;
  const fired = useRef(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(r);
  }, []);
  useEffect(() => {
    if (celebrate && goal && !fired.current && !focusNow) {
      fired.current = true;
      const tm = setTimeout(() => confetti(90), 700);
      return () => clearTimeout(tm);
    }
  }, [celebrate, goal, focusNow]);
  const open = s.actions.filter((a) => a.status !== "done");
  const created = s.actions.filter((a) => a.originDate === m.date).length;
  return (
    <div className="recap">
      <div>
        <div className="eyebrow">{t("duration")}</div>
        <div className="bignum" style={{ margin: ".2em 0 .8em" }}>
          {mmssPlain(shown)}
        </div>
        {goal && (
          <div className="goal">
            🎯{" "}
            {t("goalMet", {
              duration: dur < 60_000 ? mmssPlain(dur) : fmtMinutes(Math.round(dur / 60000), locale),
              target: fmtMinutes(s.settings.targetMin, locale),
            })}
          </div>
        )}
        <div className="eyebrow" style={{ marginBottom: ".5em" }}>
          {t("speakingTimeTarget", { target: mmssPlain(lim) })}
        </div>
        <ul className="bars">
          {sp.map((x) => {
            const v = spentOf(m, x.key, end);
            return (
              <li key={x.key}>
                <span>{first(x.label)}</span>
                <span className="bar">
                  <i style={{ width: grown ? ((v / max) * 100).toFixed(1) + "%" : "0%" }} />
                  <b style={{ insetInlineStart: ((lim / max) * 100).toFixed(1) + "%" }} />
                </span>
                <span className="v">{mmssPlain(v)}</span>
              </li>
            );
          })}
        </ul>
        <RatingSummary room={celebrate} />
      </div>
      <div>
        <div className="eyebrow" style={{ marginBottom: ".5em" }}>
          {t("actionsSummary", { open: open.length, created })}
        </div>
        <ul className="topics">
          {open.length ? (
            open.map((a) => (
              <li key={a.id}>
                <Avatar id={a.ownerId} sm />
                <span className="tx">{a.text}</span>
                <span className="by">
                  <StatusPill status={a.status} />
                </span>
              </li>
            ))
          ) : (
            <li className="muted">{t("noOpenAction")}</li>
          )}
        </ul>
        {s.kudos.length > 0 && (
          <>
            <div className="eyebrow" style={{ margin: "1.2em 0 .5em" }}>
              {t("kudosCount", { count: s.kudos.length })}
            </div>
            <ul className="topics">
              {s.kudos.map((k) => (
                <li key={k.id}>
                  <span aria-hidden="true">💜</span>
                  <span className="tx">
                    <strong>{first(nameOf(k.fromId))}</strong> → <strong>{first(nameOf(k.toId))}</strong> : {k.text}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {nextDate && (
          <p className="muted" style={{ marginTop: "1.2em" }}>
            {t("nextMeeting")} <span className="cap">{fmt.dateShort(nextDate)}</span>
          </p>
        )}
      </div>
    </div>
  );
}

/** The stage shown on the shared screen (or browsed by a participant) */
export function Stage({
  stepKey,
  mini,
  replay = 0,
  celebrate,
  logo,
  joinable,
}: {
  stepKey: string;
  mini?: boolean;
  /** Seen by a participant on their own screen: they can join the lines of others ("me too") */
  joinable?: boolean;
  replay?: number;
  celebrate?: boolean /** The workspace logo, on the shared screen */;
  logo?: string | null;
}) {
  const t = useTranslations("stage");
  const fmt = formatters(useLocale());
  const { s, agenda, cur, sections, nameOf, host } = useRonde();
  const m = s.meeting!;
  const step = agenda.find((x) => x.key === stepKey) ?? agenda[cur]!;
  const live = step.key === m.stepKey;
  const sp = agenda.filter((x) => x.type === "speaker");
  const pr = agenda.filter((x) => x.type === "project");
  const label =
    step.type === "speaker"
      ? t("roundPosition", { n: sp.findIndex((x) => x.key === step.key) + 1, total: sp.length })
      : step.type === "project"
        ? t("projectPosition", { n: pr.findIndex((x) => x.key === step.key) + 1, total: pr.length })
        : step.type === "block"
          ? step.label
          : t(`stepTitles.${step.type}`);
  const rxKey = step.type === "qa" ? step.of! : step.key;
  const rx: Record<string, number> = {};
  // Who reacted, for the count's tooltip (the host when nobody of the round)
  const rxBy: Record<string, string[]> = {};
  for (const r of s.reactions.filter((x) => x.stepKey === rxKey)) {
    rx[r.emoji] = (rx[r.emoji] ?? 0) + 1;
    const who = nameOf(r.byId) || host;
    if (!(rxBy[r.emoji] ??= []).includes(who)) rxBy[r.emoji]!.push(who);
  }
  const pend = step.type !== "qa" ? s.interactions.filter((i) => i.stepKey === step.key && !i.resolved).length : 0;
  // Spotlight: an item of the shown check-in is highlighted in place; anything else (message, question…) shows as a banner
  const spot = live ? m.spotlight : null;
  const inCheckIn =
    !!spot &&
    ((step.type === "speaker" && sectionsHave(s.checkIns[step.id!], sections, spot.text)) ||
      (step.type === "project" &&
        sections.some((sec) => projectEntries(s.checkIns, [], step.projectId!, sec).some((e) => plainItem(e.text) === spot.text))));
  return (
    <section className={"stage" + (mini ? " mini" : "")} aria-label={label}>
      <div className="stage-head">
        {logo && <img className="stage-logo" src={logo} alt="" />}
        {/* "Live" only once the meeting started: before, people would think it had begun */}
        {!live ? (
          <span className="pill view">{t("browsing")}</span>
        ) : !m.startedAt ? (
          <WaitPill />
        ) : step.type === "end" ? (
          <span className="pill done">{t("ended")}</span>
        ) : (
          <span className="pill live">{t("live")}</span>
        )}
        <span className="eyebrow">{label}</span>
        {Object.keys(rx).length > 0 && (
          <span className="rx">
            {Object.entries(rx).map(([e, n]) => (
              <span key={e} title={rxBy[e]?.join(", ")}>
                {e} {n}
              </span>
            ))}
          </span>
        )}
        {pend > 0 && <span className="pill q">✋ {t("questionsNext", { count: pend })}</span>}
        {live && step.type !== "speaker" && step.type !== "project" && step.type !== "end" && !step.limitMs ? (
          <UpCount className="pos" />
        ) : (
          <span className="pos">{fmt.dateShort(m.date)}</span>
        )}
      </div>
      {step.type === "speaker" && (
        <SpeakerBody key={step.key} step={step} live={live} spot={inCheckIn ? spot!.text : null} joinable={joinable} />
      )}
      {step.type === "project" && <ProjectBody key={step.key} step={step} live={live} spot={inCheckIn ? spot!.text : null} />}
      {step.type === "intro" && <IntroBody key={replay} mini={mini} />}
      {step.type === "qa" && <QaBody step={step} />}
      {step.type === "misc" && <MiscBody />}
      {step.type === "end" && <EndBody celebrate={celebrate} />}
      {step.type === "block" && step.block === "retro" && <RetroStage step={step} live={live} />}
      {step.type === "block" && step.block === "poker" && <PokerStage />}
      {step.type === "block" && step.block === "slide" && <SlideStage step={step} live={live} />}
      {step.type === "block" && step.block === "timebox" && (
        <div className="timebox-stage">
          <h2>{step.label}</h2>
          {live && <Timer stepKey={step.key} live />}
        </div>
      )}
      {live && <PollBand />}
      {live && m.draw && <DrawShow key={m.draw.id} draw={m.draw} />}
      {spot && !inCheckIn && (
        <div className="spot-band" role="status" key={spot.text}>
          <span className="eyebrow">✨ {spot.label || t("spotlight")}</span>
          <p>{spot.text}</p>
        </div>
      )}
    </section>
  );
}

/** Agenda timeline; clickable for participants browsing back */
export function Strip({ viewKey, onPick }: { viewKey?: string; onPick?: (key: string) => void }) {
  const t = useTranslations("stage");
  const { s, agenda, cur, now, projectLogo } = useRonde();
  useTick(1000);
  const m = s.meeting!;
  const at = now();
  return (
    <SwipeRow nav className="strip" aria-label={t("agenda")} selected={m.stepKey}>
      {agenda.map((x, i) => {
        const cls = [
          "step",
          i < cur ? "done" : "",
          x.key === m.stepKey ? "cur" : "",
          onPick && viewKey === x.key && x.key !== m.stepKey ? "view" : "",
          x.type === "qa" ? "qa" : "",
        ].join(" ");
        const project = x.type === "project" ? projectOf(s.projects, x.projectId) : undefined;
        const icon =
          x.type === "speaker" ? (
            <Avatar id={x.id} sm />
          ) : x.type === "project" ? (
            // Its logo, as a person's step shows their face
            project && projectLogo(project) ? (
              <ProjectMark project={project} src={projectLogo(project)} size="xs" className="strip-mark" />
            ) : (
              <span className="dot project-dot" style={{ "--c": `var(--c${(project?.color ?? 0) % 6})` } as React.CSSProperties}>
                ◆
              </span>
            )
          ) : (
            <span className="dot">
              {x.type === "block" ? (
                <Icon name={BLOCK_ICON[x.block ?? "timebox"]} size={13} />
              ) : (
                { intro: "▶", misc: "…", end: "■", qa: "✋", speaker: "", project: "" }[x.type]
              )}
            </span>
          );
        const tm =
          (x.type === "speaker" || x.type === "project") && i <= cur
            ? mmssPlain(spentOf(m, x.key, at))
            : x.type === "qa" && x.pending
              ? String(x.pending)
              : "";
        const content = (
          <>
            {icon}
            <span className="lab">
              {x.type === "speaker" ? first(x.label) : x.label}
              {i < cur ? " ✓" : ""}
            </span>
            {tm && <span className="tm">{tm}</span>}
          </>
        );
        return onPick ? (
          <button
            key={x.key}
            type="button"
            className={cls}
            onClick={() => onPick(x.key)}
            aria-current={x.key === m.stepKey ? "step" : undefined}
          >
            {content}
          </button>
        ) : (
          <div key={x.key} className={cls} aria-current={x.key === m.stepKey ? "step" : undefined}>
            {content}
          </div>
        );
      })}
    </SwipeRow>
  );
}
