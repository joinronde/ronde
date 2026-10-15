"use client";

import * as Popover from "@radix-ui/react-popover";
import { hasTurns } from "@ronde/core/agenda";
import { baseKeyOf } from "@ronde/core/meeting";
import type { ActionStatus, ForgeItem, PastCheckIn, ProjectDTO, ProjectHealth, Section } from "@ronde/core/types";
import {
  ACTION_STATUSES,
  ago,
  allTabs,
  EMOJIS,
  first,
  HOST_ID,
  isCheckInFilled,
  isCheckInStale,
  itemsOf,
  MOODS,
  mmss,
  mmssPlain,
  plainItem,
  RATING_MIN_VOTES,
  REACTION_BURST,
  REACTION_WINDOW_MS,
  SIGNALS,
  VOTES_PER_PERSON,
} from "@ronde/core/util";
import { formatters } from "@ronde/i18n";
import { CircleCheck, Heart, LoaderCircle, MessageCircleQuestion, Plus, Send, TriangleAlert, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Select } from "@/components/select";
import {
  appendLine,
  carryPlans,
  type Draft,
  draftOf,
  fieldsOf as fieldsOfTab,
  normDraft,
  pendingPlans,
  planKey,
  planStatus,
  rebaseDraft,
  sameDraft,
  sheetHolder,
  type TabItems,
} from "@/lib/shared/check-in-draft";
import { type LiveStatus, liveStatus } from "@/lib/shared/live-status";
import { reactionAllowance } from "@/lib/shared/pickers";
import { linesAbout, writersOf } from "@/lib/shared/sheets";
import { track } from "@/lib/shared/track";
import { ActionProgress } from "./action-progress";
import { AvatarPicker } from "./avatar-picker";
import { Board } from "./board";
import { FreeText, ItemText, ListEditor } from "./check-in-fields";
import { NoMeeting } from "./common";
import { DecisionLog } from "./decision-log";
import { EmptyHero } from "./illustration";
import { LineReactions } from "./line-reactions";
import { MotionToggle } from "./motion-toggle";
import { PokerPanel } from "./poker";
import { PollsPanel } from "./polls";
import { HealthBadge, HealthPicker, ProjectChip } from "./project-bits";
import { ProjectPicker } from "./project-picker";
import { RecordingBanner } from "./recorder";
import { RetroPanel } from "./retro";
import { useRonde, useTick } from "./ronde-provider";
import { Icon } from "./shell/icons";
import { NewTab } from "./shell/new-tab";
import { SoundPlayer } from "./sound-player";
import { Avatar, Faces, joinedOf, Stage, Star, Strip, WaitPill } from "./stage";
import { SwipeRow } from "./swipe-row";
import { Assignments, UpcomingSessions } from "./upcoming-sessions";

type MeTab = "checkIn" | "follow" | "team" | "past" | "decisions";

/** What each reaction says, for its tooltip */
const EMOJI_NAMES: Record<string, "like" | "clap" | "party" | "think"> = { "👍": "like", "👏": "clap", "🎉": "party", "🤔": "think" };

export function MeView() {
  const t = useTranslations("me");
  const { s } = useRonde();
  const started = !!s.meeting?.startedAt;
  // Before the meeting people fill in their check-in; once started, they follow the host's screen
  const [tab, setTab] = useState<MeTab>(started ? "follow" : "checkIn");
  const wasStarted = useRef(started);
  useEffect(() => {
    if (started && !wasStarted.current) setTab("follow");
    wasStarted.current = started;
  }, [started]);
  const hasCheckIn = !!s.viewer.memberId && s.members.some((m) => m.id === s.viewer.memberId);
  const live = useLiveStatus();
  // Browser tab title: the meeting can be followed even from the video call or another tab
  useEffect(() => {
    if (!live.title) return;
    const base = document.title;
    document.title = live.title;
    return () => {
      document.title = base;
    };
  }, [live.title]);
  return (
    <>
      <RecordingBanner withOptOut />
      <div className="subtabs">
        <SwipeRow role="tablist" aria-label={t("tabsLabel")} className="subtabs-list" selected={tab}>
          <button role="tab" aria-selected={tab === "checkIn"} onClick={() => setTab("checkIn")}>
            {t("tabs.checkIn")}
          </button>
          <button role="tab" aria-selected={tab === "follow"} onClick={() => setTab("follow")}>
            {started && live.state !== "ended" && <span className="tab-live" aria-hidden="true" />}
            {started ? t("tabs.live") : t("tabs.meeting")}
          </button>
          {/* Without turns (a retrospective on its board), there are no check-ins to read */}
          {hasTurns(s.settings.agenda) && (
            <button role="tab" aria-selected={tab === "team"} onClick={() => setTab("team")}>
              {t("tabs.team")}
            </button>
          )}
          {hasCheckIn && hasTurns(s.settings.agenda) && (
            <button role="tab" aria-selected={tab === "past"} onClick={() => setTab("past")}>
              {t("tabs.past")}
            </button>
          )}
          {s.modules.decisions && !s.viewer.isHost && (
            <button role="tab" aria-selected={tab === "decisions"} onClick={() => setTab("decisions")}>
              {t("tabs.decisions")}
            </button>
          )}
        </SwipeRow>
        {/* Personal settings of this screen, sounds and animations, folded behind one button. A disclosure rather
            than a menu: the sound player and the animations setting stay mounted while it is closed */}
        <ScreenPrefs label={t("screenPrefs")}>
          <SoundPlayer where="participants" />
          <MotionToggle />
        </ScreenPrefs>
      </div>
      <Assignments />
      <RatingPrompt />
      {s.modules.async && s.meeting && !started && <AsyncNote plannedAt={s.meeting.plannedAt} />}
      {hasCheckIn ? (
        <MyCheckIn tab={tab} memberId={s.viewer.memberId!} onBack={() => setTab("checkIn")} />
      ) : (
        tab === "checkIn" && <div className="emptybox">{t("notAMember")}</div>
      )}
      {tab === "follow" ? <Follow /> : tab === "team" ? <TeamCheckIns /> : tab === "decisions" ? <DecisionLog /> : null}
      {tab !== "follow" && live.state !== "none" && live.state !== "ended" && <LiveBar live={live} onFollow={() => setTab("follow")} />}
    </>
  );
}

/**
 * The settings of this screen behind a ⚙ button, in a popover above the page (the row of tabs it sits in scrolls,
 * and would cut a menu drawn inside it); a click elsewhere or Escape folds them
 */
function ScreenPrefs({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className="my-prefs-btn" aria-label={label} title={label}>
          <Icon name="settings" size={17} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="my-prefs-pop" align="end" sideOffset={8} collisionPadding={12}>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Async mode: when the digest goes out */
function AsyncNote({ plannedAt }: { plannedAt: number | null }) {
  const t = useTranslations("me");
  const locale = useLocale();
  const when = plannedAt
    ? new Date(plannedAt).toLocaleString(locale, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
    : "";
  return (
    <p className="async-banner" role="note">
      📨 {when ? t("async", { when }) : t("asyncNoTime")}
    </p>
  );
}

/** Where the meeting stands, as seen by the viewer: current step, timer, and when their turn comes */
function useLiveStatus(): LiveStatus {
  const t = useTranslations("me");
  const { s, agenda, cur, now, hydrated } = useRonde();
  const started = !!s.meeting?.startedAt;
  const speaking = started && agenda[cur]?.type === "speaker";
  useTick(speaking ? 1000 : started ? 15_000 : 30_000);
  return liveStatus({ m: s.meeting, agenda, cur, now: now(), hydrated, me: s.viewer.memberId, speakSec: s.settings.speakSec, t });
}

/** "Live" bar on the other tabs: where the meeting stands, when your turn comes, and raising a hand without switching tabs */
function LiveBar({ live, onFollow }: { live: LiveStatus; onFollow: () => void }) {
  const t = useTranslations("me");
  const tStage = useTranslations("stage");
  const { s, rpc, members, mod } = useRonde();
  useEffect(() => {
    document.body.classList.add("has-dock");
    return () => document.body.classList.remove("has-dock");
  }, []);
  if (live.state === "none" || live.state === "ended") return null;
  const me = s.viewer.memberId;
  const myHand = me ? s.interactions.find((x) => x.type === "hand" && x.byId === me && !x.resolved) : null;
  const liveKey = baseKeyOf(s.meeting!.stepKey);
  const msg =
    live.turn === "mine"
      ? t("yourTurn")
      : live.turn === "next"
        ? live.current
          ? t("afterSpeaker", { name: live.current })
          : t("rightAfter")
        : live.turn === "soon"
          ? t("peopleBefore", { count: live.before })
          : null;
  // Only the turn message is announced: the ticking timer would flood screen readers
  return (
    <div className={"dock livebar" + (live.turn ? " " + live.turn : "")}>
      <div className="dock-in">
        {live.state === "live" ? <span className="pill live">{tStage("live")}</span> : <WaitPill />}
        <span className="lb-step">
          {live.state === "live" ? (
            <>
              <strong>{live.label}</strong>
              {live.rem !== null && <span className={"lb-time" + (live.rem < 0 ? " over" : "")}>⏱ {mmss(live.rem)}</span>}
            </>
          ) : (
            tStage("notStartedYet")
          )}
        </span>
        <span className="lb-turn" role="status" aria-live="polite">
          {msg}
        </span>
        <span style={{ flex: 1 }} />
        {live.state === "live" &&
          me &&
          mod("hands") &&
          (myHand ? (
            <button className="btn on" onClick={() => rpc({ op: "hands.delete", id: myHand.id })}>
              ✋ {t("lowerHand")}
            </button>
          ) : (
            <button
              className="btn"
              onClick={() => rpc({ op: "hands.add", type: "hand", text: "", targetId: members[liveKey] ? liveKey : null }, t("handRaised"))}
            >
              ✋ {t("raiseHand")}
            </button>
          ))}
        <button className="btn primary" onClick={onFollow}>
          {t("followMeeting")}
        </button>
      </div>
    </div>
  );
}

/** The person's check-in and their past ones: the draft is shared, so an item from an old check-in can be reused */
function MyCheckIn({ tab, memberId, onBack }: { tab: MeTab; memberId: string; onBack: () => void }) {
  const draft = useCheckInDraft(memberId);
  return (
    <>
      {/* The check-in stays mounted: switching tabs (or the automatic switch to live) loses nothing being typed */}
      <div hidden={tab !== "checkIn"}>
        <CheckInBoard memberId={memberId} draft={draft} />
      </div>
      {tab === "past" && <PastCheckIns onPick={draft.append} dirty={draft.dirty} onBack={onBack} />}
    </>
  );
}

function Follow() {
  // Sticks right under the top bar, whose height grows when it wraps (a phone, a long name, Arabic…)
  // (a ref callback: the strip only shows once there is a meeting)
  const stripRef = useCallback((strip: HTMLDivElement | null) => {
    const bar = document.querySelector<HTMLElement>(".topbar");
    if (!bar || !strip) return;
    const fit = () => strip.style.setProperty("--topbar-h", `${bar.offsetHeight}px`);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);
  const t = useTranslations("me");
  const tStage = useTranslations("stage");
  const { s, agenda, cur, host } = useRonde();
  const [browse, setBrowse] = useState<string | null>(null);
  const m = s.meeting;
  useEffect(() => {
    document.body.classList.add("has-dock");
    return () => document.body.classList.remove("has-dock");
  }, []);
  if (!m) return <NoMeeting />;
  const viewKey = browse && agenda.some((x) => x.key === browse) ? browse : m.stepKey;
  const following = viewKey === m.stepKey;
  const liveStep = agenda[cur];
  const viewStep = agenda.find((x) => x.key === viewKey);
  return (
    <div className="live-wrap">
      {following ? (
        <div className="banner">
          {m.stepKey === "end" ? (
            <span className="pill done">{tStage("ended")}</span>
          ) : m.startedAt ? (
            <span className="pill live">{tStage("live")}</span>
          ) : (
            <WaitPill />
          )}
          <span className="grow">
            {m.stepKey === "end" ? t("endedFollow", { host }) : m.startedAt ? t("following", { host }) : t("notStartedFollow", { host })}
          </span>
        </div>
      ) : (
        <div className="banner away">
          <span className="grow">
            {t.rich("browsing", {
              view: viewStep?.label ?? "",
              live: liveStep?.label ?? "",
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </span>
          <button className="btn primary" onClick={() => setBrowse(null)}>
            {t("backToLive")}
          </button>
        </div>
      )}
      {(m.stepKey === "intro" || !m.startedAt) && <Warmup key={m.icebreaker ?? ""} />}
      <RetroPanel />
      <PokerPanel />
      <PollsPanel />
      {/* Kept in view while scrolling down the stage: where the meeting is, and the people and projects to come */}
      <div className="follow-strip" ref={stripRef}>
        <Strip viewKey={viewKey} onPick={(k) => setBrowse(k === m.stepKey ? null : k)} />
      </div>
      <Stage stepKey={viewKey} joinable />
      {m.stepKey !== "end" && <Dock />}
    </div>
  );
}

/** Interaction bar: raised hand, reactions, signals, question */
function Dock() {
  const t = useTranslations("me");
  const tSignals = useTranslations("signals");
  const { s, rpc, members, mod, focus, focusNow, focusAuto, setFocus, setFocusHere } = useRonde();
  // Focus only applies here, where one follows the meeting: not on the shared screen nor in the control room
  useEffect(() => {
    setFocusHere(true);
    return () => setFocusHere(false);
  }, [setFocusHere]);
  const [text, setText] = useState("");
  const [kudoMode, setKudoMode] = useState(false);
  // The reactions one may send in a row (the server keeps no more): past them, a countdown says when they are back
  const sent = useRef<number[]>([]);
  const [waitUntil, setWaitUntil] = useState(0);
  useTick(waitUntil ? 250 : 60_000);
  const now = Date.now();
  const waiting = waitUntil > now;
  const react = (emoji: string) => {
    const at = Date.now();
    const before = reactionAllowance(sent.current, at, REACTION_BURST, REACTION_WINDOW_MS);
    if (before.waitUntil) return setWaitUntil(before.waitUntil);
    sent.current = [...before.recent, at];
    setWaitUntil(reactionAllowance(sent.current, at, REACTION_BURST, REACTION_WINDOW_MS).waitUntil);
    void rpc({ op: "reactions.add", emoji });
  };
  const [kudoTo, setKudoTo] = useState("");
  const [kudoText, setKudoText] = useState("");
  // On a phone, the reactions fold behind one button: a tray that stays open for several in a row
  const [tray, setTray] = useState(false);
  const liveKey = baseKeyOf(s.meeting!.stepKey);
  const [target, setTarget] = useState<string>(members[liveKey] ? liveKey : "");
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setTarget(members[liveKey] ? liveKey : "");
  }, [liveKey, members]);
  const me = s.viewer.memberId ?? (s.viewer.isHost ? HOST_ID : null);
  if (!me)
    return (
      <div className="dock">
        <div className="dock-in">{t("followOnly")}</div>
      </div>
    );
  const myHand = s.interactions.find((x) => x.type === "hand" && x.byId === me && !x.resolved);
  // Each part of the dock belongs to a module: raised hands and questions, reactions, kudos
  const hands = mod("hands");
  const reactions = mod("reactions");
  const kudos = mod("kudos");
  if (!hands && !reactions && !kudos) return null;
  return (
    <div className="dock">
      <div className="dock-in">
        {!hands ? null : myHand ? (
          <button className="btn on" onClick={() => rpc({ op: "hands.delete", id: myHand.id })}>
            ✋ {t("lowerHand")}
          </button>
        ) : (
          <button
            className="btn"
            onClick={() => rpc({ op: "hands.add", type: "hand", text: "", targetId: members[liveKey] ? liveKey : null }, t("handRaised"))}
          >
            ✋ {t("raiseHand")}
          </button>
        )}
        {reactions && (
          <button
            type="button"
            className={"btn focus-btn" + (focusNow ? " on" : "")}
            aria-pressed={focusNow}
            // During one's own turn it is on by itself: a click would change nothing that shows
            aria-disabled={focusAuto || undefined}
            title={focusAuto ? t("focusTurn") : focus ? t("focusOff") : t("focusOn")}
            onClick={() => !focusAuto && setFocus(!focus)}
          >
            <span aria-hidden="true">🎯</span> <span className="focus-label">{t("focus")}</span>
          </button>
        )}
        {reactions && (
          <>
            <button
              type="button"
              className={"btn dock-tray-btn" + (tray ? " on" : "")}
              aria-expanded={tray}
              aria-controls="dock-tray"
              onClick={() => setTray(!tray)}
            >
              <span aria-hidden="true">👏</span> {t("reactions")}
            </button>
            <span id="dock-tray" className={"dock-tray" + (tray ? " open" : "")}>
              <span className="dock-sep" aria-hidden="true" />
              <span className="reacts" role="group" aria-label={t("reactions")}>
                {EMOJIS.map((e) => (
                  <button
                    key={e}
                    title={t(`emojis.${EMOJI_NAMES[e] ?? "like"}`)}
                    aria-label={t(`emojis.${EMOJI_NAMES[e] ?? "like"}`)}
                    disabled={waiting}
                    onClick={() => react(e)}
                  >
                    {e}
                  </button>
                ))}
              </span>
              {waiting && (
                <span
                  className="react-wait"
                  role="status"
                  style={{ "--left": (waitUntil - now) / REACTION_WINDOW_MS } as React.CSSProperties}
                >
                  {t("reactWait", { seconds: Math.ceil((waitUntil - now) / 1000) })}
                </span>
              )}
              <span className="dock-sep" aria-hidden="true" />
              <span className="reacts signals" role="group" aria-label={t("signals")}>
                {SIGNALS.map((x) => (
                  <button
                    key={x.e}
                    title={tSignals(`${x.key}.label`)}
                    aria-label={t("signal", { label: tSignals(`${x.key}.label`) })}
                    disabled={waiting}
                    onClick={() => react(x.e)}
                  >
                    {x.e}
                  </button>
                ))}
              </span>
            </span>
          </>
        )}
        {hands && kudos && (
          <>
            <span className="dock-sep" aria-hidden="true" />
            <span className="seg dock-mode" role="group" aria-label={t("writeKind")}>
              <button type="button" aria-pressed={!kudoMode} onClick={() => setKudoMode(false)}>
                <MessageCircleQuestion size={16} strokeWidth={2} aria-hidden="true" /> {t("question")}
              </button>
              <button type="button" aria-pressed={kudoMode} onClick={() => setKudoMode(true)}>
                <Heart size={16} strokeWidth={2} aria-hidden="true" /> {t("thanks")}
              </button>
            </span>
          </>
        )}
        {kudos && (kudoMode || !hands) ? (
          <form
            className="kudo-form qform"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!kudoTo || !kudoText.trim()) return;
              if (await rpc({ op: "kudos.add", toId: kudoTo, text: kudoText.trim() }, t("kudoSent"))) {
                setKudoText("");
                setKudoMode(false);
              }
            }}
          >
            <label htmlFor="kudoTo" className="sr-only">
              {t("kudoWho")}
            </label>
            <Select id="kudoTo" value={kudoTo} onChange={(e) => setKudoTo(e.target.value)} required>
              <option value="">{t("kudoWhoPlaceholder")}</option>
              {s.members
                .filter((x) => x.active && x.id !== me)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </Select>
            <label htmlFor="kudoText" className="sr-only">
              {t("message")}
            </label>
            <input
              id="kudoText"
              type="text"
              autoComplete="off"
              maxLength={200}
              value={kudoText}
              onChange={(e) => setKudoText(e.target.value)}
              placeholder={t("kudoPlaceholder")}
            />
            <button className="btn primary" type="submit">
              <Send size={15} strokeWidth={2.2} aria-hidden="true" className="flip-rtl" /> {t("send")}
            </button>
          </form>
        ) : hands ? (
          <form
            className="qform"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!text.trim()) return;
              if (await rpc({ op: "hands.add", type: "question", text: text.trim(), targetId: target || null }, t("questionSent"))) {
                setText("");
                touched.current = false;
              }
            }}
          >
            <label htmlFor="qTarget" className="sr-only">
              {t("recipient")}
            </label>
            <Select
              id="qTarget"
              value={target}
              onChange={(e) => {
                touched.current = true;
                setTarget(e.target.value);
              }}
            >
              <option value="">{t("toTeam")}</option>
              {s.members
                .filter((x) => x.active && x.id !== me)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {t("toPerson", { name: first(x.name) })}
                  </option>
                ))}
            </Select>
            <label htmlFor="qText" className="sr-only">
              {t("question")}
            </label>
            <input
              id="qText"
              type="text"
              autoComplete="off"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("questionShort")}
              title={t("questionPlaceholder")}
            />
            <button className="btn primary" type="submit">
              <Send size={15} strokeWidth={2.2} aria-hidden="true" className="flip-rtl" /> {t("send")}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}

/** Mood and icebreaker during the live meeting, only for people who have not answered from their check-in yet */
function Warmup() {
  const { s } = useRonde();
  const me = s.viewer.memberId ?? (s.viewer.isHost ? HOST_ID : null);
  // Frozen on first display: answering here does not make the block disappear, it can still be corrected
  const [askMood] = useState(s.mood.mine === null);
  const [askIce] = useState(!s.answers.some((a) => a.byId === me));
  return (
    <>
      {askMood && <MoodPicker />}
      {askIce && <IcebreakerAnswer />}
    </>
  );
}

/** Personal mood, anonymous: only the counts are shown to the team */
function MoodPicker() {
  const t = useTranslations("me");
  const tMoods = useTranslations("moods");
  const { s, rpc } = useRonde();
  const me = s.viewer.memberId ?? (s.viewer.isHost ? HOST_ID : null);
  if (!me || !s.settings.moodEnabled || !s.meeting) return null;
  return (
    <div className="banner" style={{ background: "var(--accent-soft)", borderColor: "transparent" }} role="group" aria-label={t("myMood")}>
      <strong>{t("moodOfTheDay")}</strong>
      <span className="mood-pick">
        {MOODS.map((m) => (
          <button
            key={m.v}
            type="button"
            aria-pressed={s.mood.mine === m.v}
            title={tMoods(m.key)}
            aria-label={tMoods(m.key)}
            onClick={() => rpc({ op: "mood.set", value: s.mood.mine === m.v ? null : m.v })}
          >
            {m.e}
          </button>
        ))}
      </span>
      <span className="hint">{t("moodAnonymous")}</span>
    </div>
  );
}

const LEVELS = [1, 2, 3, 4, 5] as const;
type Level = (typeof LEVELS)[number];

/**
 * At the wrap-up, whatever tab is open: how useful the meeting was for me, from 1 to 5 stars. Anonymous (the
 * team only sees the average), and it can be changed until the meeting is archived.
 */
function RatingPrompt() {
  const t = useTranslations("me");
  const { s, rpc } = useRonde();
  const [hover, setHover] = useState<Level | null>(null);
  // The star picked shows at once, before the server confirms it (then the snapshot takes over)
  const [picked, setPicked] = useState<{ value: Level | null; from: number | null } | null>(null);
  useEffect(() => setPicked(null), [s.rating.mine]);
  const me = s.viewer.memberId ?? (s.viewer.isHost ? HOST_ID : null);
  const m = s.meeting;
  if (!me || !s.modules.rating || !m || (m.stepKey !== "end" && !m.endedAt)) return null;
  const mine = picked && picked.from === s.rating.mine ? picked.value : s.rating.mine;
  const shown = hover ?? LEVELS.find((v) => v === mine) ?? null;
  return (
    <section className={`rating-card${mine ? " done" : ""}`} aria-labelledby="rating-title">
      <h2 id="rating-title">{t("rating.title")}</h2>
      <div className="rating-pick" role="group" aria-labelledby="rating-title" onPointerLeave={() => setHover(null)}>
        {LEVELS.map((v) => (
          <button
            key={v}
            type="button"
            className={shown !== null && v <= shown ? "on" : undefined}
            style={{ "--i": v } as React.CSSProperties}
            aria-pressed={mine === v}
            aria-label={`${v}/5 · ${t(`rating.levels.${v}`)}`}
            title={t(`rating.levels.${v}`)}
            onPointerEnter={(e) => e.pointerType === "mouse" && setHover(v)}
            onFocus={() => setHover(v)}
            onBlur={() => setHover(null)}
            onClick={() => {
              const value = mine === v ? null : v;
              setHover(null);
              setPicked({ value, from: s.rating.mine });
              void rpc({ op: "rating.set", value }).then((ok) => !ok && setPicked(null));
            }}
          >
            <Star />
          </button>
        ))}
      </div>
      <p className="rating-level" aria-hidden="true">
        {shown ? t(`rating.levels.${shown}`) : "\u00a0"}
      </p>
      <p className="hint" role="status">
        {mine ? t("rating.thanks") : t("rating.hint", { min: RATING_MIN_VOTES })}
      </p>
    </section>
  );
}

function IcebreakerAnswer() {
  const t = useTranslations("me");
  const tApp = useTranslations("app");
  const { s, rpc } = useRonde();
  const me = s.viewer.memberId ?? (s.viewer.isHost ? HOST_ID : null);
  const mine = s.answers.find((a) => a.byId === me);
  const [text, setText] = useState(mine?.text ?? "");
  const [editing, setEditing] = useState(!mine);
  // Answer given from the other tab, or erased by a question change
  useEffect(() => {
    setText(mine?.text ?? "");
    setEditing(!mine);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine?.text]);
  if (!me || !s.meeting?.icebreaker) return null;
  return (
    <form
      className="banner"
      style={{ background: "var(--sun-soft)", borderColor: "transparent" }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (await rpc({ op: "icebreaker.answer", text: text.trim() }, text.trim() ? t("answerSent") : t("answerRemoved")))
          setEditing(false);
      }}
    >
      <Icon name="snowflake" size={16} />
      <strong>{s.meeting.icebreaker}</strong>
      {editing ? (
        <>
          <label htmlFor="iceText" className="sr-only">
            {t("yourAnswer")}
          </label>
          <input
            id="iceText"
            type="text"
            maxLength={200}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("answerPlaceholder")}
            style={{ flex: 1, minWidth: 200 }}
          />
          <button className="btn primary" type="submit">
            {t("answer")}
          </button>
        </>
      ) : (
        <>
          <span className="grow">{tApp("quoted", { text: mine?.text ?? "" })}</span>
          <button className="btn" type="button" onClick={() => setEditing(true)}>
            {t("edit")}
          </button>
        </>
      )}
    </form>
  );
}

export function useCheckInDraft(memberId: string) {
  const { s, rpc, sections } = useRonde();
  const f = s.checkIns[memberId];
  const toDraft = (tab = ""): Draft => draftOf(f, s.projects, sections, tab);
  /** Last time's plans brought back in their section (see `carryPlans`), or null */
  const carry = (x: Draft): Draft | null =>
    carryPlans(x, {
      sections,
      lastWeek: s.lastWeek[memberId],
      own: s.viewer.memberId === memberId,
      updatedAt: f?.updatedAt,
      lastArchivedAt: s.lastArchivedAt,
      projects: s.projects,
    });
  const [start] = useState(() => {
    const saved = toDraft();
    return { saved, carried: carry(saved) };
  });
  const [d, setD] = useState<Draft>(start.carried ?? start.saved);
  const [dirty, setDirty] = useState(!!start.carried);
  /** Last time's plans were just brought back: a note says so until the check-in is saved */
  const [carried, setCarried] = useState(!!start.carried);
  /** Changes count (`rev`) when they were brought back: the same count means nothing else was changed */
  const carriedAt = useRef<number | null>(start.carried ? 0 : null);
  // The saved version the draft started from: tells what was changed here from what changed elsewhere
  const base = useRef<{ draft: Draft; at: number | null }>({ draft: start.saved, at: f?.updatedAt ?? null });
  /** Saved elsewhere while being written here (the host fixing it, another tab): its changes were merged in */
  const [merged, setMerged] = useState(false);
  // Check-in updated elsewhere (e.g. emptied when archiving) or sections changed: reloaded if nothing is in
  // progress here, otherwise what changed there is merged into the draft
  const sectionsSig =
    sections.map((x) => x.k + ":" + x.type + (x.carryPlans ? "+" : "")).join("|") + "#" + s.projects.map((p) => p.id).join(",");
  /** Version being saved from here (as the server stores it): its echo is not a change made elsewhere */
  const sent = useRef<string | null>(null);
  /** Changes made here, counted: typing while a save is on its way keeps the draft unsaved */
  const rev = useRef(0);
  const norm = (x: Draft) => normDraft(x, sections);
  const same = (a: Draft, b: Draft) => sameDraft(a, b, sections);
  useEffect(() => {
    const theirs = toDraft(d.tab);
    const at = f?.updatedAt ?? null;
    if (!dirty) {
      const withPlans = carry(theirs);
      setD(withPlans ?? theirs);
      // The echo of what was just saved from here keeps the notice of a merge; a change from elsewhere ends it
      const echo = sent.current !== null && JSON.stringify(norm(theirs)) === sent.current;
      if (echo) sent.current = null;
      else setMerged(false);
      if (withPlans) {
        setDirty(true);
        setCarried(true);
        carriedAt.current = rev.current;
      }
    } else if (at !== base.current.at) {
      const echo = sent.current !== null && JSON.stringify(norm(theirs)) === sent.current;
      // What was saved from here, or the same as the draft: nothing to merge
      if (!echo && !same(theirs, d)) {
        const texts = new Set(sections.filter((x) => x.type === "text").map((x) => x.k));
        setD({ ...rebaseDraft(norm(base.current.draft), norm(d), norm(theirs), texts), tab: d.tab });
        setMerged(true);
      }
      if (echo) sent.current = null;
    }
    base.current = { draft: theirs, at };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f?.updatedAt, sectionsSig]);
  // Closing or reloading the page with an unsaved check-in: the browser asks for confirmation
  useEffect(() => {
    if (!dirty) return;
    // Only last time's plans brought back, nothing typed: leaving loses nothing
    const warn = (e: BeforeUnloadEvent) => carriedAt.current !== rev.current && e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const current = (x: Draft) => (x.tab ? (x.byProject[x.tab] ?? {}) : x.items);
  const withTab = (x: Draft, items: TabItems): Draft => (x.tab ? { ...x, byProject: { ...x.byProject, [x.tab]: items } } : { ...x, items });
  const setTab = (tab: string) => setD((x) => ({ ...x, tab }));
  const setItems = (k: string, items: string[]) => {
    setD((x) => withTab(x, { ...current(x), [k]: items }));
    setDirty(true);
    rev.current++;
  };
  /** Add an item to a section of the tab shown (GitLab import, "+ Done", past check-in), without duplicates */
  const append = (k: string, line: string) => {
    const sec = sections.find((x) => x.k === k);
    if (!sec) return;
    setD((x) => {
      const next = appendLine(current(x)[k] ?? [], sec, line);
      return next ? withTab(x, { ...current(x), [k]: next }) : x;
    });
    setDirty(true);
    rev.current++;
  };
  const fieldsOf = (tab: TabItems) => fieldsOfTab(tab, sections);
  /** Where the last save stands, for the check-in that saves itself */
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  /** `okMessage` absent: a save of its own, said by the status rather than a toast */
  const save = async (okMessage?: string) => {
    const at = rev.current;
    sent.current = JSON.stringify(norm(d));
    setStatus("saving");
    const ok = await rpc(
      {
        op: "checkIn.save",
        memberId,
        // Saved elsewhere since: refused, the version saved there is merged in first
        since: base.current.at,
        ...fieldsOf(d.items),
        byProject: Object.fromEntries(
          Object.entries(d.byProject)
            .filter(([id]) => s.projects.some((p) => p.id === id))
            .map(([id, tab]) => [id, fieldsOf(tab)]),
        ),
      },
      okMessage,
      okMessage ? undefined : { silent: true },
    );
    setStatus(ok ? "saved" : "failed");
    if (ok) {
      track("checkin_saved");
      // Typed meanwhile: still to save
      if (rev.current === at) setDirty(false);
      // Saved by itself just after a merge: the notice stays, or it would be gone before it is read
      if (okMessage) setMerged(false);
      setCarried(false);
      carriedAt.current = null;
    } else sent.current = null;
    return ok;
  };
  // Typed here, beyond last time's plans brought back by themselves: what saves itself
  const typed = dirty && carriedAt.current !== rev.current;
  return { d, dirty, typed, status, merged, carried, items: current(d), setTab, setItems, append, save };
}

/** Check-in form; `byHost`: the host fixes someone else's check-in */
export function CheckInForm({
  memberId,
  draft,
  byHost,
  onSaved,
  top,
}: {
  memberId: string;
  draft: ReturnType<typeof useCheckInDraft>;
  byHost?: boolean;
  onSaved?: () => void;
  /** Banner at the top of the check-in (last time's items to sort) */
  top?: React.ReactNode;
}) {
  const t = useTranslations("me");
  const locale = useLocale();
  const { s, members, sections } = useRonde();
  const f = s.checkIns[memberId];
  const { d, dirty, items: tabItems, setItems } = draft;
  const who = first(members[memberId]?.name);
  const project = d.tab ? s.projects.find((p) => p.id === d.tab) : undefined;
  // A list field may submit the form itself just before the click lands: one save is enough
  const lastSubmit = useRef(0);
  // One's own check-in saves itself a moment after the last keystroke: no button to forget. Merged with a version
  // saved elsewhere meanwhile, it saves again once merged
  const auto = !byHost;
  const sig = JSON.stringify([d.items, d.byProject]);
  useEffect(() => {
    if (!auto || !draft.typed) return;
    const timer = setTimeout(() => void draft.save(), AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, draft.typed, sig]);
  // Left before the delay ran out (another page from the sidebar, a tab put aside): saved at once, not lost
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => {
    if (!auto) return;
    const flush = () => {
      const now = latest.current;
      if (now.typed && now.status !== "saving") void now.save();
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      flush();
    };
  }, [auto]);
  return (
    <form
      className="panel form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (Date.now() - lastSubmit.current < 800) return;
        lastSubmit.current = Date.now();
        if (await draft.save(byHost ? t("checkInOfSaved", { name: who }) : undefined)) onSaved?.();
        // Not saved (merged with a version saved elsewhere, an error): the next click saves at once
        else lastSubmit.current = 0;
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <AvatarPicker memberId={memberId} />
        <div>
          <h3 style={{ margin: 0 }}>{members[memberId]?.name}</h3>
          <div className="hint" suppressHydrationWarning>
            {f?.updatedAt
              ? t("lastUpdate", {
                  when: new Date(f.updatedAt).toLocaleString(locale, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })
              : t("notFilledYet")}
          </div>
        </div>
      </div>
      {top}
      {byHost && <div className="note-box">{t("editingOther", { name: who })}</div>}
      {isCheckInStale(f, s.lastArchivedAt) && (
        <div className="note-box">{byHost ? t("otherWasAbsent", { name: who }) : t("youWereAbsent")}</div>
      )}
      {draft.merged && (
        <div className="note-box merged" role="status">
          {byHost ? t("mergedOther", { name: who }) : t("mergedOwn")}
        </div>
      )}
      {draft.carried && (
        <div className="note-box carried" role="status">
          <span aria-hidden="true">☑</span> {t("carriedNote", { section: sections.find((x) => x.carryPlans)?.label ?? "" })}
        </div>
      )}
      <CheckInTabs memberId={memberId} draft={draft} />
      {project && <ProjectSheet key={project.id} project={project} memberId={memberId} byHost={byHost} />}
      <div className="grid2">
        {sections.map((sec) => {
          const id = "f_" + sec.k + memberId + d.tab;
          const items = tabItems[sec.k] ?? [];
          return (
            <div className={"field" + (sec.type === "text" ? "" : " list-field")} key={d.tab + sec.k}>
              <label htmlFor={id} id={id + "-lbl"}>
                {sec.label}
                {sec.type !== "text" && items.filter((x) => plainItem(x).trim()).length > 0 && (
                  <span className="cnt">{items.filter((x) => plainItem(x).trim()).length}</span>
                )}
              </label>
              {project && <OthersLines projectId={project.id} sec={sec} memberId={memberId} canJoin={!byHost} />}
              {sec.type === "text" ? (
                <FreeText id={id} sec={sec} value={items[0] ?? ""} onChange={(v) => setItems(sec.k, [v])} />
              ) : (
                <ListEditor
                  id={id}
                  sec={sec}
                  items={items}
                  onChange={(v) => setItems(sec.k, v)}
                  // On a project's lines, the people who joined them
                  aside={
                    project
                      ? (item) => <Faces ids={joinedOf(s, { ownerId: memberId, projectId: project.id, section: sec.k, text: item })} />
                      : undefined
                  }
                />
              )}
            </div>
          );
        })}
      </div>
      {byHost ? (
        <div className="controls">
          <button className="btn primary" type="submit">
            {t("saveCheckInOf", { name: who })}
          </button>
          {dirty && <span className="hint">{t("unsaved")}</span>}
        </div>
      ) : (
        <p
          className={`checkin-status s-${draft.status === "failed" ? "failed" : draft.typed || draft.status === "saving" ? "saving" : "saved"}`}
          role="status"
        >
          {draft.status === "failed" ? (
            <>
              <TriangleAlert size={15} strokeWidth={2.2} aria-hidden="true" /> {t("unsaved")}{" "}
              <button type="submit" className="linkbtn">
                {t("retry")}
              </button>
            </>
          ) : draft.typed || draft.status === "saving" ? (
            <>
              <LoaderCircle size={15} strokeWidth={2.2} aria-hidden="true" className="spin" /> {t("autosaving")}
            </>
          ) : f?.updatedAt ? (
            <>
              <CircleCheck size={15} strokeWidth={2.2} aria-hidden="true" /> {t("autosaved")}
            </>
          ) : (
            <span className="hint">{t("autosaveHint")}</span>
          )}
        </p>
      )}
    </form>
  );
}

/** Tabs of a check-in: the person's own news, then each project they work on (or chose to write about) */
function CheckInTabs({ memberId, draft }: { memberId: string; draft: ReturnType<typeof useCheckInDraft> }) {
  const t = useTranslations("me");
  const { s, rpc, projectLogo } = useRonde();
  const { d, setTab } = draft;
  const [opened, setOpened] = useState<string[]>([]);
  // The rest of the portfolio, when the hosts let everyone add projects (otherwise not sent)
  const addable = (s.projectChoices ?? []).filter(
    (p) => !s.projects.some((x) => x.id === p.id) && !["done", "cancelled"].includes(p.status),
  );
  const openTab = (id: string) => {
    setOpened((x) => [...x, id]);
    setTab(id);
  };
  const count = (tab: Record<string, string[]> | undefined) =>
    Object.values(tab ?? {}).reduce((n, list) => n + list.filter((x) => plainItem(x).trim()).length, 0);
  const open = s.projects.filter((p) => !["done", "cancelled"].includes(p.status));
  const shown = open.filter(
    (p) => p.memberIds.includes(memberId) || count(d.byProject[p.id]) > 0 || opened.includes(p.id) || d.tab === p.id,
  );
  const others = open.filter((p) => !shown.includes(p));
  if (!open.length && !addable.length) return null;
  const tab = (id: string, label: React.ReactNode, n: number) => (
    <button key={id || "own"} type="button" role="tab" aria-selected={d.tab === id} onClick={() => setTab(id)}>
      {label}
      {n > 0 && <span className="cnt">{n}</span>}
    </button>
  );
  return (
    <div className="ci-tabs">
      <div role="tablist" aria-label={t("checkInTabs")}>
        {tab("", t("ownTab"), count(d.items))}
        {shown.map((p) => tab(p.id, <ProjectChip name={p.name} color={p.color} logo={projectLogo(p)} />, count(d.byProject[p.id])))}
      </div>
      {(others.length > 0 || addable.length > 0) && (
        <ProjectPicker
          trigger={
            <>
              <Plus size={15} strokeWidth={2.2} aria-hidden="true" /> {t("writeAboutProject")}
            </>
          }
          triggerClass="btn sm ci-tabs-add"
          label={t("writeAboutProject")}
          sections={[
            {
              title: addable.length ? t("projectsFollowed") : undefined,
              items: others.map((p) => ({ id: p.id, name: p.name, color: p.color, theme: p.theme?.name, logo: projectLogo(p) })),
            },
            { title: t("projectsToAdd"), items: addable.map((p) => ({ id: p.id, name: p.name, color: p.color, theme: p.theme })) },
          ]}
          onPick={async (p) => {
            if (others.some((x) => x.id === p.id)) return openTab(p.id);
            if (await rpc({ op: "project.follow", projectId: p.id }, t("projectAdded", { name: p.name }))) openTab(p.id);
          }}
          empty={t("noOtherProject")}
        />
      )}
    </div>
  );
}

/** While the person writes the sheet, it is reserved: renewed every half a minute, as long as they type */
const HOLD_RENEW_MS = 30_000;
/** Without a keystroke for so long, the reservation is no longer renewed: an abandoned page does not keep it */
const HOLD_IDLE_MS = 5 * 60_000;
/** The message of the day is saved as it is typed, after this pause */
const AUTOSAVE_MS = 1200;

type SheetStatus = "idle" | "pending" | "saving" | "saved" | "failed";

/**
 * The shared sheet of a project for the coming session: its health and the message of the day. Saved as it
 * is written (no button to forget); reserved for the person writing it until they leave it.
 */
function ProjectSheet({ project, memberId, byHost }: { project: ProjectDTO; memberId: string; byHost?: boolean }) {
  const t = useTranslations("me");
  const tCommon = useTranslations("common");
  const locale = useLocale();
  const { s, rpc, nameOf, now } = useRonde();
  // The sheet of this session: its health starts empty, the last one known is recalled beside it
  const saved = { health: project.sheet?.health ?? null, headline: project.sheet?.headline ?? "" };
  const [health, setHealth] = useState<ProjectHealth | null>(saved.health);
  const [headline, setHeadline] = useState(saved.headline);
  // Saved by someone else meanwhile: what is not being changed here follows
  const before = useRef(saved);
  useEffect(() => {
    const prev = before.current;
    setHealth((h) => (h === prev.health ? saved.health : h));
    setHeadline((v) => (v === prev.headline ? saved.headline : v));
    before.current = saved;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.sheet?.updatedAt]);
  const canEdit = project.memberIds.includes(memberId) || !!byHost || s.viewer.isHost;
  // Someone else is writing it: it is theirs until they leave it (or their reservation lapses)
  const holder = sheetHolder(project, now());
  // The holder is a person id, or the host's for someone outside the meeting (a host who does not take part)
  const mine = holder === s.viewer.personId || (holder === HOST_ID && !s.viewer.memberId);
  const heldBy = holder && !mine ? holder : null;
  useTick(project.sheet?.editingById ? 5_000 : 3_600_000);
  const heldRef = useRef(heldBy);
  heldRef.current = heldBy;
  const lastInput = useRef(0);
  // Writing it: from the first change until the person leaves the sheet
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<SheetStatus>("idle");
  useEffect(() => {
    if (!editing || !canEdit) return;
    // The first reservation says why it is refused; the renewals and the release run in the background
    const hold = (silent: boolean) => {
      if (!heldRef.current && Date.now() - lastInput.current < HOLD_IDLE_MS)
        void rpc({ op: "project.hold", projectId: project.id, on: true }, undefined, { silent });
    };
    hold(false);
    const id = setInterval(() => hold(true), HOLD_RENEW_MS);
    return () => {
      clearInterval(id);
      void rpc({ op: "project.hold", projectId: project.id, on: false }, undefined, { silent: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, canEdit, project.id]);

  // What the timers and the unmount send: the latest values, against the latest saved sheet
  const latest = useRef({ health, headline, saved });
  latest.current = { health, headline, saved };
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Sends what changed (only that: two people never erase each other); `keep`: still writing */
  const send = async (keep: boolean) => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const { health: h, headline: v, saved: was } = latest.current;
    const changes = {
      ...(h !== was.health ? { health: h } : {}),
      ...(v.trim() !== was.headline ? { headline: v.trim() } : {}),
    };
    if (!Object.keys(changes).length) {
      setStatus((x) => (x === "pending" ? "idle" : x));
      return;
    }
    setStatus("saving");
    const ok = await rpc({ op: "project.sheet", projectId: project.id, ...changes, keep });
    setStatus(ok ? "saved" : "failed");
  };
  const sendRef = useRef(send);
  sendRef.current = send;
  const box = useRef<HTMLElement>(null);
  const changed = () => {
    lastInput.current = Date.now();
    setEditing(true);
    setStatus("pending");
  };
  // Leaving the tab with something not sent yet: it goes now; closing the page meanwhile: the browser asks
  const pending = status === "pending" || status === "saving";
  useEffect(() => {
    if (!pending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    const hidden = () => {
      if (document.visibilityState === "hidden" && timer.current) void sendRef.current(true);
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [pending]);
  // Another tab of the check-in, or another page: what was typed is saved, the sheet is released
  useEffect(() => () => void (timer.current ? sendRef.current(false) : undefined), []);

  return (
    <section
      ref={box}
      className={"project-sheet" + (heldBy ? " held" : "")}
      aria-labelledby={`sheet-${project.id}`}
      onBlur={(e) => {
        // Focus leaving the sheet: the person is done writing it for now
        if (!editing || e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        void send(false).then(() => setEditing(false));
      }}
    >
      <header>
        <h4 id={`sheet-${project.id}`}>{t("projectSheet", { project: project.name })}</h4>
        {project.summary && <p className="hint">{project.summary}</p>}
      </header>
      <ProjectPeople project={project} holder={holder} />
      {canEdit ? (
        <>
          {heldBy && (
            <p className="sheet-held" role="status">
              <Avatar id={heldBy} sm />
              <span>{t("sheetHeld", { name: nameOf(heldBy) })}</span>
            </p>
          )}
          <HealthPicker
            value={health}
            disabled={!!heldBy}
            onChange={(h) => {
              setHealth(h);
              changed();
              // A click is a whole change: saved right away. Some browsers do not focus a clicked radio: with
              // the focus elsewhere, no blur will end the writing, so it ends here
              latest.current = { ...latest.current, health: h };
              const inside = !!box.current?.contains(document.activeElement);
              void send(inside).then(() => {
                if (!inside && !timer.current) setEditing(false);
              });
            }}
          />
          {!health && project.health && (
            <p className="hint">
              {t("lastHealth")} <HealthBadge health={project.health} />
            </p>
          )}
          <div className="field">
            <label htmlFor={`headline-${project.id}`}>{t("headline")}</label>
            <textarea
              id={`headline-${project.id}`}
              rows={2}
              value={headline}
              maxLength={4000}
              readOnly={!!heldBy}
              placeholder={t("headlinePlaceholder")}
              onChange={(e) => {
                setHeadline(e.target.value);
                changed();
                clearTimeout(timer.current);
                timer.current = setTimeout(() => void sendRef.current(true), AUTOSAVE_MS);
              }}
            />
          </div>
          <div className="sheet-foot">
            <span className={"sheet-status " + status} role="status" aria-live="polite">
              {pending ? t("sheetSaving") : status === "saved" ? `✓ ${t("sheetAutoSaved")}` : status === "failed" ? t("sheetNotSaved") : ""}
            </span>
            {status === "failed" && (
              <button type="button" className="linkbtn" onClick={() => void send(editing)}>
                {tCommon("loadError.retry")}
              </button>
            )}
            {project.sheet?.updatedAt && project.sheet.updatedById && (
              <span className="hint sheet-by" suppressHydrationWarning>
                <Avatar id={project.sheet.updatedById} sm />
                {t("sheetUpdated", {
                  name: nameOf(project.sheet.updatedById),
                  when: new Date(project.sheet.updatedAt).toLocaleString(locale, {
                    weekday: "long",
                    hour: "2-digit",
                    minute: "2-digit",
                  }),
                })}
              </span>
            )}
          </div>
          {!heldBy && <p className="hint sheet-auto">{t("sheetAutoHint")}</p>}
        </>
      ) : (
        <div className="project-sheet-read">
          <HealthBadge health={project.sheet?.health ?? project.health} />
          {project.sheet?.headline ? <p>{project.sheet.headline}</p> : <p className="hint">{t("sheetMembersOnly")}</p>}
        </div>
      )}
    </section>
  );
}

/** People on a project: its members and whoever wrote about it, how many lines each, who is writing its sheet */
function ProjectPeople({ project, holder }: { project: ProjectDTO; holder: string | null }) {
  const t = useTranslations("me");
  const { s, members, sections } = useRonde();
  const people = [...new Set([...project.memberIds, ...writersOf(s, project.id, sections)])].filter((id) => members[id]);
  if (!people.length) return null;
  return (
    <ul className="sheet-people" aria-label={t("projectPeople")}>
      {people.map((id) => {
        const n = linesAbout(s, id, project.id, sections);
        return (
          <li key={id} className={(n ? "wrote" : "") + (id === holder ? " writing" : "")}>
            <Avatar id={id} sm />
            <span className="nm">{first(members[id]?.name)}</span>
            <span className="hint">{id === holder ? t("writingSheet") : n ? t("linesCount", { count: n }) : t("noLines")}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Lines the others wrote about the project in a section: theirs, shown with their face and the faces of the
 * people who joined them. Whoever took part in one joins it, and their face shows on it too.
 */
function OthersLines({ projectId, sec, memberId, canJoin }: { projectId: string; sec: Section; memberId: string; canJoin: boolean }) {
  const t = useTranslations("me");
  const { s, members, rpc } = useRonde();
  const lines = Object.keys(s.checkIns)
    .filter((id) => id !== memberId && members[id])
    .flatMap((id) => itemsOf(s.checkIns[id]?.byProject[projectId], sec).map((text) => ({ id, text })))
    .filter((l) => plainItem(l.text).trim());
  if (!lines.length) return null;
  // A free text is one block: it is not joined line by line
  const joinable = canJoin && sec.type !== "text";
  return (
    <>
      <ul className="others-lines" aria-label={t("othersLines")}>
        {lines.map((l, i) => {
          const joined = joinedOf(s, { ownerId: l.id, projectId, section: sec.k, text: l.text });
          const mine = joined.includes(memberId);
          return (
            <li key={i} className={mine ? "joined" : undefined}>
              <Faces ids={[l.id, ...joined]} />
              <span className="txt">{sec.type === "text" ? <span className="free">{l.text}</span> : <ItemText item={l.text} />}</span>
              {joinable && (
                <button
                  type="button"
                  className="join-btn"
                  aria-pressed={mine}
                  aria-label={mine ? t("leaveLine", { text: plainItem(l.text) }) : t("joinLine", { text: plainItem(l.text) })}
                  title={mine ? t("leaveLineHint") : t("joinLineHint")}
                  onClick={() => rpc({ op: "item.with", ownerId: l.id, section: sec.k, itemText: l.text, projectId, on: !mine })}
                >
                  {mine ? "✓" : "+"} {t("joined")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <div className="lines-mine">
        <Avatar id={memberId} sm />
        {t("yourLines")}
      </div>
    </>
  );
}

function CheckInBoard({ memberId, draft }: { memberId: string; draft: ReturnType<typeof useCheckInDraft> }) {
  const t = useTranslations("me");
  const { s, rpc, nameOf, sections, host, mod } = useRonde();
  const { append } = draft;
  const tabProject = draft.d.tab ? s.projects.find((p) => p.id === draft.d.tab) : undefined;
  const [topic, setTopic] = useState("");
  const lw = s.lastWeek[memberId];
  const votesLeft = VOTES_PER_PERSON - s.topics.filter((x) => x.mine).length;
  const topics = (
    <form
      className="panel form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (topic.trim() && (await rpc({ op: "topic.add", text: topic.trim() }, t("topicAdded")))) setTopic("");
      }}
    >
      <h3 style={{ margin: 0 }}>{t("topicTitle")}</h3>
      <div className="field">
        <label htmlFor="topicText">{t("topic")}</label>
        <input id="topicText" type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t("topicPlaceholder")} />
      </div>
      <div>
        <button className="btn" type="submit">
          {t("propose")}
        </button>
      </div>
      {s.topics.length > 0 && (
        <>
          <div className="lbl-s" style={{ marginTop: 4 }}>
            {t("proposedTopics")}
            {s.viewer.memberId && ` · ${t("voteHint", { count: votesLeft })}`}
          </div>
          {[...s.topics]
            .sort((a, b) => b.votes - a.votes || a.createdAt - b.createdAt)
            .map((x) => (
              <div className="item" key={x.id}>
                <div className="body">
                  {x.text}
                  <div className="meta">{nameOf(x.byId) || host}</div>
                </div>
                {s.viewer.memberId && (
                  <button
                    type="button"
                    className="vote-btn"
                    aria-pressed={x.mine}
                    aria-label={x.mine ? t("unvote") : t("vote")}
                    onClick={() => rpc({ op: "topic.vote", id: x.id })}
                  >
                    ▲ {x.votes}
                  </button>
                )}
                {x.byId === memberId && (
                  <button type="button" className="icon-btn danger" onClick={() => rpc({ op: "topic.delete", id: x.id })}>
                    {t("remove")}
                  </button>
                )}
              </div>
            ))}
        </>
      )}
    </form>
  );
  const doneSec = sections.find((x) => x.k === "done");
  const nextSec = sections.find((x) => x.k === "next");
  const triage = useLastWeekTriage(memberId, draft);
  // Left: what the person writes (check-in, before the meeting, open topics); right: what helps fill it in; everyone can rearrange
  return (
    <Board
      page="check-in"
      className="check-in"
      columns={[
        [
          {
            id: "form",
            title: t("myCheckIn"),
            node: !hasTurns(s.settings.agenda) ? (
              // No round table in this meeting (a retrospective on its board…): nothing to prepare before it
              <div className="panel no-turns">
                <h3 style={{ margin: 0 }}>{t("myCheckIn")}</h3>
                <p className="muted">{t("noTurns")}</p>
              </div>
            ) : (
              <CheckInForm
                memberId={memberId}
                draft={draft}
                top={
                  triage.pending.length > 0 && (
                    <div className="lw-banner" role="status">
                      <span>
                        <Icon name="calendar" size={15} />{" "}
                        {t.rich("toSort", { count: triage.pending.length, strong: (chunks) => <strong>{chunks}</strong> })}
                      </span>
                      <button
                        type="button"
                        className="btn soft"
                        onClick={() => {
                          const el = document.getElementById("lastweek");
                          el?.scrollIntoView({ block: "center", behavior: "smooth" });
                          el?.classList.remove("flash");
                          requestAnimationFrame(() => el?.classList.add("flash"));
                        }}
                      >
                        {t("sort")}
                      </button>
                    </div>
                  )
                }
              />
            ),
          },
          {
            id: "warmup",
            title: t("beforeMeeting"),
            node: (s.meeting?.icebreaker || (s.settings.moodEnabled && s.meeting)) && (
              <div className="panel" style={{ display: "grid", gap: 10 }}>
                <h3 style={{ margin: 0 }}>{t("beforeMeeting")}</h3>
                <MoodPicker />
                <IcebreakerAnswer />
              </div>
            ),
          },
          { id: "topics", title: t("topicTitle"), node: topics },
        ],
        [
          // Last time's sorting first: that is how the check-in starts
          {
            id: "lastweek",
            title: t("plannedLastTime"),
            node: hasTurns(s.settings.agenda) && (
              <div className="panel lastweek-panel" id="lastweek">
                <div className="lw-head">
                  <h3 style={{ margin: 0 }}>{t("plannedLastTime")}</h3>
                  {doneSec && triage.pending.length > 1 && (
                    <button type="button" className="icon-btn" onClick={() => triage.pending.forEach((n) => append("done", n))}>
                      {t("markAllDone")}
                    </button>
                  )}
                </div>
                {!lw?.next.length ? (
                  <p className="muted">{t("nothingInHistory")}</p>
                ) : (
                  <>
                    {triage.pending.length > 0 ? (
                      <p className="hint">{t("sortHint", { done: doneSec?.label ?? "", next: nextSec?.label ?? "" })}</p>
                    ) : (
                      <p className="lw-done">✓ {t("allSorted")}</p>
                    )}
                    <ul className="lw-list">
                      {lw.next.map((n, i) => {
                        const st = triage.statusOf(n);
                        return (
                          <li key={i} className={st ? "treated" : ""}>
                            <span className="body">{n}</span>
                            {st ? (
                              <>
                                <span className={"lw-st " + st}>
                                  {st === "done"
                                    ? `✓ ${t("doneLabel")}`
                                    : st === "here"
                                      ? `☐ ${t("inSection", { section: doneSec?.label ?? "" })}`
                                      : st === "next"
                                        ? `↻ ${t("carriedOver")}`
                                        : t("dismissed")}
                                </span>
                                {st === "skip" && (
                                  <button type="button" className="linkbtn" onClick={() => triage.unskip(n)}>
                                    {t("undo")}
                                  </button>
                                )}
                              </>
                            ) : (
                              <span className="lw-acts">
                                {doneSec && (
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    onClick={() => append("done", n)}
                                    title={t("addTo", { section: doneSec.label })}
                                  >
                                    ✓ {t("doneLabel")}
                                  </button>
                                )}
                                {nextSec && (
                                  <button
                                    type="button"
                                    className="icon-btn"
                                    onClick={() => append("next", n)}
                                    title={t("carryTo", { section: nextSec.label })}
                                  >
                                    ↻ {t("carryOver")}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="icon-btn"
                                  aria-label={t("dismiss", { item: n })}
                                  title={t("dismissHint")}
                                  onClick={() => triage.skip(n)}
                                >
                                  <X size={14} strokeWidth={2.2} aria-hidden="true" />
                                </button>
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>
            ),
          },
          // Only once GitLab is connected: a participant's page is no place to set up an integration (the meeting
          // settings are), and a note about the server's variables means nothing to people in the cloud
          {
            id: "gitlab",
            title: t("importGitlab"),
            node: mod("gitlab") && s.integrations.gitlab && (
              <ImportPanel tool="gitlab" memberId={memberId} onAdd={append} project={tabProject} />
            ),
          },
          {
            id: "github",
            title: t("github.import"),
            node: mod("github") && s.integrations.github && (
              <ImportPanel tool="github" memberId={memberId} onAdd={append} project={tabProject} />
            ),
          },
          {
            id: "upcoming",
            title: t("upcomingBlock"),
            node: <UpcomingSessions />,
          },
          {
            id: "actions",
            title: t("actions"),
            node: <MyActions memberId={memberId} />,
          },
        ],
      ]}
    />
  );
}

/** The person's open actions: where each one stands, in their own words, and one more for themselves */
function MyActions({ memberId }: { memberId: string }) {
  const t = useTranslations("me");
  const tAct = useTranslations("actions");
  const tStatus = useTranslations("actionStatus");
  const fmt = formatters(useLocale());
  const { s, rpc } = useRonde();
  const [text, setText] = useState("");
  const acts = s.actions.filter((a) => a.ownerId === memberId && a.status !== "done");
  return (
    <div className="panel">
      <h3>{t("actions")}</h3>
      {acts.map((a) => (
        <div className="item" key={a.id}>
          <div className="body">
            {a.text}
            <div className="meta">{a.originDate ? t("since", { date: fmt.dayMonth(a.originDate) }) : ""}</div>
            <ActionProgress
              text={a.text}
              progress={a.progress}
              at={a.progressAt}
              editable
              onSave={(progress) => rpc({ op: "action.update", id: a.id, progress }, tAct("progressSaved"))}
            />
          </div>
          <Select
            aria-label={t("status")}
            value={a.status}
            onChange={(e) =>
              rpc(
                { op: "action.update", id: a.id, status: e.target.value as ActionStatus },
                t("actionStatusChanged", { status: tStatus(e.target.value as ActionStatus) }),
              )
            }
          >
            {ACTION_STATUSES.map((k) => (
              <option key={k} value={k}>
                {tStatus(k)}
              </option>
            ))}
          </Select>
        </div>
      ))}
      <form
        className="act-mine-new"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          const ok = await rpc(
            { op: "action.add", text: text.trim(), ownerId: memberId, originText: null, projectId: null },
            tAct("added"),
          );
          if (ok) setText("");
        }}
      >
        <label htmlFor="myActionText" className="lbl-s">
          {tAct("newTitle")}
        </label>
        <input
          id="myActionText"
          type="text"
          value={text}
          maxLength={300}
          placeholder={tAct("newPlaceholder")}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn soft" type="submit" disabled={!text.trim()}>
          {tAct("add")}
        </button>
      </form>
    </div>
  );
}

/**
 * Sorting what was planned last time: an item is handled when it shows up in "Done" or "Planned" of the current
 * check-in, or when the person dismissed it (kept in this browser, for that week).
 */
function useLastWeekTriage(memberId: string, draft: ReturnType<typeof useCheckInDraft>) {
  const { s } = useRonde();
  const lw = s.lastWeek[memberId];
  const storeKey = `ronde.lw.skip.${memberId}.${lw?.date ?? ""}`;
  const [skipped, setSkipped] = useState<string[]>([]);
  useEffect(() => {
    try {
      setSkipped(JSON.parse(localStorage.getItem(storeKey) ?? "[]") as string[]);
    } catch {
      setSkipped([]);
    }
  }, [storeKey]);
  const save = (list: string[]) => {
    setSkipped(list);
    try {
      localStorage.setItem(storeKey, JSON.stringify(list));
    } catch {
      /* storage unavailable: the item will show up again */
    }
  };
  return {
    pending: pendingPlans(lw?.next ?? [], draft.d, skipped),
    statusOf: (n: string) => planStatus(draft.d, skipped, n),
    skip: (n: string) => save([...skipped, planKey(n)]),
    unskip: (n: string) => save(skipped.filter((x) => x !== planKey(n))),
  };
}

/** The person's check-ins from archived meetings, to find information or reuse an item */
function PastCheckIns({ onPick, dirty, onBack }: { onPick: (k: string, line: string) => void; dirty: boolean; onBack: () => void }) {
  const t = useTranslations("me");
  const locale = useLocale();
  const fmt = formatters(locale);
  const { sections, toast, now, api } = useRonde();
  const [list, setList] = useState<PastCheckIn[] | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const unavailable = t("historyUnavailable");
  useEffect(() => {
    fetch(api("/history/mine"), { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? unavailable);
        return (await r.json()) as PastCheckIn[];
      })
      .then((l) => {
        setList(l);
        setOpen(l[0]?.date ?? null);
      })
      .catch((e: Error) => setError(e.message));
  }, [unavailable]);
  if (error) return <p className="err">{error}</p>;
  if (!list) return <p className="loading">{t("loadingPast")}</p>;
  if (!list.length) return <EmptyHero art="history" title={t("noPast")} compact />;
  const needle = q.trim().toLowerCase();
  const hits = (p: PastCheckIn) =>
    !needle ||
    p.projects.some((x) => x.name.toLowerCase().includes(needle)) ||
    (p.sections ?? []).some((sec) => itemsOf(allTabs(p.checkIn), sec).some((x) => x.toLowerCase().includes(needle)));
  const shown = list.filter(hits);
  // Section of the current check-in where to reuse an item: the same one if it still exists
  const target = (sec: Section) => sections.find((x) => x.k === sec.k) ?? null;
  return (
    <div className="past">
      <div className="controls">
        <label htmlFor="pastQ" className="sr-only">
          {t("search")}
        </label>
        <input
          id="pastQ"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("searchPast", { count: list.length })}
          style={{ flex: 1 }}
        />
        {dirty && (
          <button className="btn" onClick={onBack}>
            {t("backToCheckIn")}
          </button>
        )}
      </div>
      {needle ? (
        <p className="hint">
          {shown.length
            ? t("pastMatches", { shown: shown.length, total: list.length, query: q.trim() })
            : t("noMatch", { query: q.trim() })}
        </p>
      ) : (
        <p className="hint">{t("pastHint")}</p>
      )}
      {shown.map((p) => {
        const isOpen = open === p.date || !!needle;
        const secs = (p.sections ?? []).filter((sec) => itemsOf(p.checkIn, sec).length);
        // A glance at the week without opening the check-in: number of items per section (blockers highlighted)
        const counts = secs.filter((sec) => sec.type !== "text").map((sec) => ({ sec, n: itemsOf(p.checkIn, sec).length }));
        return (
          <div className={"hcard" + (isOpen ? " open" : "")} key={p.date}>
            <button className="hhead" aria-expanded={isOpen} onClick={() => setOpen(isOpen && !needle ? null : p.date)}>
              <span className="hdate">
                <span className="d">{fmt.dateShort(p.date)}</span>
                <span className="ago" suppressHydrationWarning>
                  {ago(p.date, now(), locale)}
                </span>
              </span>
              <span className="hchips">
                {p.projects.map((x) => (
                  <span className="hchip proj" key={x.id}>
                    {x.name}
                  </span>
                ))}
                {counts.map(({ sec, n }) => (
                  <span className={"hchip" + (sec.kind === "blockers" ? " warn" : "")} key={sec.k} title={sec.label}>
                    {sec.kind === "blockers" ? "⚠" : sec.kind === "done" ? "✓" : sec.kind === "next" ? "→" : "•"}{" "}
                    <span className="hchip-l">{sec.label} ·</span> {n}
                  </span>
                ))}
                {!secs.length && <span className="hchip">{t("emptyCheckIn")}</span>}
              </span>
              {p.spent > 0 && (
                <span className="hchip" title={t("speakingTime")}>
                  ⏱ {mmssPlain(p.spent)}
                </span>
              )}
              <span className="hchev" aria-hidden="true">
                ›
              </span>
            </button>
            {isOpen && (
              <div className="hbody past-body">
                {secs.length ? (
                  secs.map((sec) => {
                    const to = target(sec);
                    return (
                      <div key={sec.k}>
                        <div className="lbl-s">{sec.label}</div>
                        <ul className="past-items">
                          {itemsOf(p.checkIn, sec).map((x, i) => (
                            <li key={i} className={needle && x.toLowerCase().includes(needle) ? "hit" : ""}>
                              <span className={"body" + (sec.type === "text" ? " pre" : "")}>
                                <ItemText item={x} />
                              </span>
                              {to && (
                                <button
                                  type="button"
                                  className="icon-btn"
                                  title={t("reuseIn", { section: to.label })}
                                  onClick={() => {
                                    onPick(to.k, plainItem(x));
                                    toast(t("reused", { section: to.label }), "ok");
                                  }}
                                >
                                  {t("reuse")}
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })
                ) : (
                  <p className="muted">{t("emptyThatWeek")}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Recent issues and merge or pull requests of the person, from GitLab or GitHub, to add to their check-in */
function ImportPanel({
  tool,
  memberId,
  onAdd,
  project,
}: {
  tool: "gitlab" | "github";
  memberId: string;
  onAdd: (k: string, line: string) => void;
  /** Project of the check-in tab shown: its repositories come first, the items go to its tab */
  project?: ProjectDTO;
}) {
  const t = useTranslations("me");
  const { s, toast, nameOf, host, api } = useRonde();
  const [all, setAll] = useState(false);
  const [onlyRepos, setOnlyRepos] = useState(true);
  const repos = project?.repos[tool] ?? [];
  const [items, setItems] = useState<ForgeItem[] | null>(null);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const me = s.members.find((m) => m.id === memberId);
  const hasUser = !!(tool === "gitlab" ? me?.gitlabUsername : me?.githubUsername);
  const ready = s.integrations[tool];
  const text =
    tool === "gitlab"
      ? {
          title: t("importGitlab"),
          unreachable: t("gitlabUnreachable"),
          noUser: t("gitlabNoUsername", { host }),
        }
      : { title: t("github.import"), unreachable: t("github.unreachable"), noUser: t("github.noUsername", { host }) };

  const unreachable = text.unreachable;
  useEffect(() => {
    if (!ready) return;
    setItems(null);
    setError("");
    fetch(api(`/${tool}${all ? "?all=1" : ""}`), { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? unreachable);
        return (await r.json()) as ForgeItem[];
      })
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, [all, ready, unreachable, tool]);

  const mine = (items ?? [])
    .filter((g) => all || g.assignee === memberId)
    .filter((g) => !repos.length || !onlyRepos || repos.includes(g.path.toLowerCase()));
  // A long list gets a filter: by title, project or number
  const q = query.trim().toLowerCase();
  const list = q ? mine.filter((g) => `${g.title} ${g.project} ${g.ref}`.toLowerCase().includes(q)) : mine;
  return (
    <div className="panel">
      <h3>{text.title}</h3>
      {!hasUser && (
        <p className="hint" style={{ marginBottom: 6 }}>
          {text.noUser}
        </p>
      )}
      <label className="check" style={{ marginBottom: 6 }}>
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {t("gitlabShowOthers")}
      </label>
      {project && repos.length > 0 && (
        <label className="check" style={{ marginBottom: 6 }}>
          <input type="checkbox" checked={onlyRepos} onChange={(e) => setOnlyRepos(e.target.checked)} />{" "}
          {t("importOnlyRepos", { project: project.name })}
        </label>
      )}
      {error ? (
        <p className="err">{error}</p>
      ) : items === null ? (
        <p className="muted">{t("loading")}</p>
      ) : mine.length ? (
        <>
          {mine.length > 8 && (
            <input
              type="search"
              className="gl-filter"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("importFilter")}
              aria-label={t("importFilter")}
            />
          )}
          {/* The list scrolls within the panel: its options above and its button below stay in sight */}
          <div className="gl-list">
            {list.length ? (
              list.map((g) => (
                <div className="gl-item" key={g.id}>
                  <input
                    type="checkbox"
                    aria-label={t("select", { title: g.title })}
                    checked={picked.has(g.id)}
                    onChange={(e) =>
                      setPicked((p) => {
                        const n = new Set(p);
                        if (e.target.checked) n.add(g.id);
                        else n.delete(g.id);
                        return n;
                      })
                    }
                  />
                  <div>
                    <a href={g.url} target="_blank" rel="noopener" style={{ textDecoration: "none" }}>
                      {g.title}
                      <NewTab />
                    </a>
                    <div className="gl-ref">
                      {g.project} {g.ref}
                      {all && g.assignee !== memberId ? " · " + first(nameOf(g.assignee)) : ""}
                    </div>
                  </div>
                  <span className={"gl-state " + g.state}>{t(`gitlabState.${g.state}`)}</span>
                </div>
              ))
            ) : (
              <p className="muted">{t("importNoMatch")}</p>
            )}
          </div>
        </>
      ) : (
        <p className="muted">{t("gitlabNoRecent")}</p>
      )}
      <div className="controls" style={{ marginTop: 10 }}>
        <button
          className="btn"
          onClick={() => {
            const chosen = list.filter((g) => picked.has(g.id));
            if (!chosen.length) return toast(t("gitlabPickOne"), "error");
            chosen.forEach((g) => onAdd(g.state === "opened" ? "next" : "done", `${g.title} (${g.project}${g.ref})`));
            setPicked(new Set());
            toast(t("gitlabAdded", { count: chosen.length }), "ok");
          }}
        >
          {t("addToCheckIn")}
          {picked.size > 0 && <span className="cnt">{picked.size}</span>}
        </button>
        <span className="hint">
          {t("gitlabMapping")} · {project ? t("importIntoProject", { project: project.name }) : t("importIntoOwn")}
        </span>
      </div>
    </div>
  );
}

/** Teammates' check-ins: 👍 and comments on each item, before or during the meeting */
function TeamCheckIns() {
  const t = useTranslations("me");
  const { s, sections, projectLogo } = useRonde();
  const me = s.viewer.memberId ?? (s.viewer.isHost ? HOST_ID : null);
  if (!s.meeting) return <NoMeeting />;
  const others = s.members.filter((m) => m.active && m.id !== s.viewer.memberId);
  return (
    <div className="team-check-ins">
      <p className="hint" style={{ marginBottom: 12 }}>
        {t("teamHint")}
      </p>
      {others.map((m) => {
        const f = s.checkIns[m.id];
        const filled = sections.some((sec) => itemsOf(allTabs(f), sec).length);
        return (
          <div className="panel" key={m.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <Avatar id={m.id} />
              <h3 style={{ margin: 0 }}>{m.name}</h3>
              {s.projects.some((p) => isCheckInFilled(f?.byProject[p.id])) && (
                <span className="hint">
                  {s.projects
                    .filter((p) => isCheckInFilled(f?.byProject[p.id]))
                    .map((p) => p.name)
                    .join(" · ")}
                </span>
              )}
            </div>
            {filled ? (
              <div className="grid2">
                {sections
                  .filter((sec) => itemsOf(allTabs(f), sec).length)
                  .map((sec) => (
                    <div key={sec.k}>
                      <div className="lbl-s" style={{ marginBottom: 4 }}>
                        {sec.label}
                      </div>
                      {/* Their own items, then each project's: a comment goes to the item of its tab */}
                      {[
                        ...itemsOf(f, sec).map((item) => ({ item, project: null as ProjectDTO | null })),
                        ...s.projects.flatMap((p) => itemsOf(f?.byProject[p.id], sec).map((item) => ({ item, project: p }))),
                      ].map(({ item, project }, i) => (
                        <CommentableItem
                          key={i}
                          ownerId={m.id}
                          section={sec.k}
                          item={item}
                          projectId={project?.id ?? null}
                          tag={
                            project ? (
                              <>
                                <ProjectChip name={project.name} color={project.color} logo={projectLogo(project)} />
                                <Faces ids={joinedOf(s, { ownerId: m.id, projectId: project.id, section: sec.k, text: item })} />
                              </>
                            ) : (
                              // Their own line: the faces of whoever joined it
                              <Faces ids={joinedOf(s, { ownerId: m.id, projectId: null, section: sec.k, text: item })} />
                            )
                          }
                          me={me}
                          pre={sec.type === "text"}
                        />
                      ))}
                    </div>
                  ))}
              </div>
            ) : (
              <p className="muted">{t("notFilledYet")}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CommentableItem({
  ownerId,
  section,
  item,
  projectId,
  tag,
  me,
  pre,
}: {
  ownerId: string;
  section: string;
  item: string;
  /** Tab of the item: null for the person's own */
  projectId: string | null;
  tag?: React.ReactNode;
  me: string | null;
  pre?: boolean;
}) {
  const t = useTranslations("me");
  const { s, rpc, nameOf } = useRonde();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const cs = s.comments.filter((c) => c.ownerId === ownerId && c.section === section && c.itemText === item && c.projectId === projectId);
  const notes = cs.filter((c) => c.text);
  return (
    <div className="citem">
      <div className="citem-row">
        <span className={"body" + (pre ? " pre" : "")}>
          {tag}
          <ItemText item={item} />
        </span>
        <LineReactions target={{ ownerId, section, itemText: item, projectId }} />
        <button type="button" className="vote-btn" aria-expanded={open} onClick={() => setOpen(!open)} title={t("comments")}>
          💬 {notes.length || ""}
        </button>
      </div>
      {open && (
        <div className="citem-thread">
          {notes.map((c) => (
            <div key={c.id} className="citem-note">
              <strong>{first(nameOf(c.byId))}</strong> {c.text}
              {(c.byId === me || s.viewer.isHost) && (
                <button type="button" className="icon-btn danger" onClick={() => rpc({ op: "comment.delete", id: c.id })}>
                  {t("remove")}
                </button>
              )}
            </div>
          ))}
          {me && (
            <form
              className="controls"
              onSubmit={async (e) => {
                e.preventDefault();
                if (text.trim() && (await rpc({ op: "comment.add", ownerId, section, itemText: item, projectId, text: text.trim() })))
                  setText("");
              }}
            >
              <label htmlFor={`c-${ownerId}-${section}-${item.length}`} className="sr-only">
                {t("comment")}
              </label>
              <input
                id={`c-${ownerId}-${section}-${item.length}`}
                type="text"
                maxLength={300}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t("commentPlaceholder")}
                style={{ flex: 1 }}
              />
              <button className="btn" type="submit">
                {t("send")}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
