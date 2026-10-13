"use client";

import { BLOCK_MODULE, hasTurns } from "@ronde/core/agenda";
import { birthdaysAround } from "@ronde/core/ambience";
import { baseKeyOf, type Step, spentOf } from "@ronde/core/meeting";
import { buildMinutes, MINUTES_PARTS, type MinutesPart } from "@ronde/core/minutes";
import type { RecordV1 } from "@ronde/core/record";
import { BOARD_SOUNDS, CUES, MUSIC_GROUPS, MUSIC_STYLES, type MusicStyle, type SoundKey, type SoundOutput } from "@ronde/core/sound";
import type { ActionStatus, InteractionDTO } from "@ronde/core/types";
import {
  ACTION_STATUSES,
  first,
  isCheckInReady,
  isCheckInStale,
  isoDay,
  itemsOf,
  mmssPlain,
  plainItem,
  VOTES_PER_PERSON,
} from "@ronde/core/util";
import { formatters } from "@ronde/i18n";
import { MdEditor } from "@ronde/ui/md-editor";
import { Tour } from "@ronde/ui/tour";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderSVG } from "uqr";
import { Select } from "@/components/select";
import { withBasePath } from "@/lib/shared/base-path";
import {
  blockersOf,
  canMove,
  filledCount,
  isTracked,
  memberOfStep,
  minutesCheck,
  moveProject,
  nextLabel as nextLabelOf,
  parseOmit,
  projectOrderOf,
  serializeOmit,
  shuffleProjects,
  sortActions,
  startOp,
  stepTitle,
} from "@/lib/shared/control-room";
import { actionOwners, sheetRows, sheetsToComplete, writersOf } from "@/lib/shared/sheets";
import { track } from "@/lib/shared/track";
import { Board } from "./board";
import { CommandPalette, ShortcutsHelp, useControlShortcuts } from "./command-palette";
import { Modal, NoMeeting } from "./common";
import { CONTROL_TOUR_KEY, type ControlPane, useControlTour } from "./control-room-tour";
import { PageActions } from "./header";
import { CheckInForm, useCheckInDraft } from "./me";
import { MinutesView } from "./minutes-view";
import { PokerHost } from "./poker";
import { PollsHost } from "./polls";
import { HealthPicker } from "./project-bits";
import { RandomHost } from "./random-tools";
import { Recorder, RecordingBanner } from "./recorder";
import { RetroHost } from "./retro";
import { useRonde, useTick } from "./ronde-provider";
import { SharePreview, ShareScreenButton } from "./screen-share";
import { Icon } from "./shell/icons";
import { ModKey } from "./shell/mod-key";
import { NewTab } from "./shell/new-tab";
import { controlMonitorOn, SoundPlayer } from "./sound-player";
import { Avatar, BLOCK_ICON, projectEntries, projectsWithTurn, Stage, sectionsHave, Timer, UpCount } from "./stage";
import { SwipeRow } from "./swipe-row";
import { soundLength } from "./synth";
import { Assignments } from "./upcoming-sessions";

type Pane = ControlPane;

/** Minutes draft: kept when switching panes, regenerated as long as it was not edited */
/** Summary being written for the minutes, kept while the host switches panes */
type MinutesDraft = { summary: string } | null;

/** Commands and guided tour of the control room, at the end of the meeting's tab row */
function ControlActions({ onTour, onCommands, onRemote }: { onTour: () => void; onCommands: () => void; onRemote: () => void }) {
  const t = useTranslations("control");
  return (
    <PageActions>
      <ShareScreenButton />
      <Recorder />
      {/* Within reach during the whole meeting, not only in the setup shown before it starts */}
      <button type="button" className="btn ghost sm" onClick={onRemote} title={t("remote.title")}>
        <Icon name="phone" size={16} /> <span className="hide-sm">{t("remote.title")}</span>
      </button>
      <button type="button" className="btn ghost sm" onClick={onCommands} title={t("tabs.commandsHint")}>
        <ModKey k="K" /> <span className="hide-sm">{t("tabs.commands")}</span>
      </button>
      <button type="button" className="btn ghost sm" onClick={onTour} data-tour="tour-btn" title={t("tabs.tour")}>
        <Icon name="help" size={16} /> <span className="hide-sm">{t("tabs.tour")}</span>
      </button>
    </PageActions>
  );
}

/** QR code of the phone remote: the host drives the meeting from their phone, signed in on it */
function RemoteQr({ onClose }: { onClose: () => void }) {
  const t = useTranslations("control");
  const { s } = useRonde();
  const url = `${window.location.origin}${withBasePath(`${s.context.path}/remote`)}`;
  return (
    <Modal onClose={onClose} labelledBy="remoteTitle">
      <h2 id="remoteTitle" style={{ marginTop: 0 }}>
        {t("remote.title")}
      </h2>
      <p className="hint">{t("remote.hint")}</p>
      <div className="qr" role="img" aria-label={t("remote.scan")} dangerouslySetInnerHTML={{ __html: renderSVG(url, { border: 2 }) }} />
      <p style={{ overflowWrap: "anywhere" }}>
        <a href={url} className="link">
          {url}
        </a>
      </p>
      <div className="controls">
        <span className="sep" />
        <button type="button" className="btn" onClick={onClose}>
          {t("close")}
        </button>
      </div>
    </Modal>
  );
}

const tourSeen = () => {
  try {
    return localStorage.getItem(CONTROL_TOUR_KEY) === "1";
  } catch {
    return true;
  }
};
const markTourSeen = () => {
  try {
    localStorage.setItem(CONTROL_TOUR_KEY, "1");
  } catch {
    /* storage unavailable: the tour will be offered again */
  }
};

export function ControlRoomView() {
  const t = useTranslations("control");
  const tStage = useTranslations("stage");
  const { s, agenda, cur, rpc, liveSeen, mod, sections } = useRonde();
  const tour_ = useControlTour(s.modules);
  const [pane, setPane] = useState<Pane>("run");
  const [beep, setBeep] = useState(false);
  const [minutesDraft, setMinutesDraft] = useState<MinutesDraft>(null);
  const [tour, setTour] = useState(false);
  const shortcuts = useControlShortcuts();
  const [remote, setRemote] = useState(false);
  useTick(1000);
  const m = s.meeting;
  const step = agenda[cur];
  const prevKey = useRef(m?.stepKey);

  // Reaching the wrap-up: open the minutes; new meeting: back to the run order
  const prevDate = useRef(m?.date);
  useEffect(() => {
    if (m?.stepKey === "end" && prevKey.current !== "end") setPane("minutes");
    else if (m?.date !== prevDate.current) {
      setPane("run");
      setMinutesDraft(null);
    }
    prevKey.current = m?.stepKey;
    prevDate.current = m?.date;
  }, [m?.stepKey, m?.date]);

  // Keyboard shortcuts: → next, ← previous, Space timer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!m || (e.target as HTMLElement).closest("input,textarea,select,[contenteditable]")) return;
      // Before the start, only "Start the meeting" moves forward
      if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && !m.startedAt) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        void rpc({ op: "meeting.step", delta: 1, from: m.stepKey });
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        void rpc({ op: "meeting.step", delta: -1, from: m.stepKey });
      } else if (e.key === " ") {
        e.preventDefault();
        void rpc({ op: "meeting.togglePlay" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [m, rpc]);

  useBeep(beep);

  // First visit to the control room with a prepared meeting: the guided tour starts by itself
  const hasMeeting = !!m;
  useEffect(() => {
    if (!hasMeeting || tourSeen()) return;
    const timer = setTimeout(() => setTour(true), 700);
    return () => clearTimeout(timer);
  }, [hasMeeting]);
  const tourStep = useCallback(
    (i: number) => {
      const p = tour_[i]?.pane;
      if (p) setPane(p);
    },
    [tour_],
  );
  const closeTour = useCallback(() => {
    markTourSeen();
    setTour(false);
    setPane("run");
  }, []);

  if (!m || !step) return <NoMeeting />;

  const next = agenda[cur + 1];
  const running = m.timer.running;
  const seen = Date.now() - liveSeen < 6000;
  const sp = agenda.filter((x) => x.type === "speaker");
  const filledN = filledCount(agenda, s);
  const pr = agenda.filter((x) => x.type === "project");
  const title = stepTitle(step, tStage);
  const nextLabel = nextLabelOf(next, (count) => t("nextQuestions", { count }));
  const pend = s.interactions.filter((i) => !i.resolved).length;
  const tops = s.topics.filter((x) => !x.done).length;

  return (
    <>
      <ControlActions onTour={() => setTour(true)} onCommands={() => shortcuts.setPalette(true)} onRemote={() => setRemote(true)} />
      <RecordingBanner />
      {shortcuts.palette && <CommandPalette onClose={() => shortcuts.setPalette(false)} onPane={setPane} />}
      {shortcuts.help && <ShortcutsHelp onClose={() => shortcuts.setHelp(false)} />}
      <Assignments />
      {tour && <Tour steps={tour_} onStep={tourStep} onClose={closeTour} />}
      {!m.startedAt && (
        <div className="setup" data-tour="setup">
          <div>
            <span className="n">1</span>
            <a className="btn primary" href={withBasePath(`${s.context.path}/screen`)} target="_blank" rel="noopener">
              {t("setup.openScreen")}
              <NewTab />
            </a>
            <span className={"det " + (seen ? "ok" : "no")}>{seen ? t("setup.tabOpen") : t("setup.notOpen")}</span>
          </div>
          <div>
            <span className="n">2</span>
            <span>{t.rich("setup.shareTab", { strong: (chunks) => <strong>{chunks}</strong> })}</span>
          </div>
          <div>
            <span className="n">3</span>
            <span>
              {t.rich("setup.keys", { kbd: (chunks) => <kbd>{chunks}</kbd> })}{" "}
              <button type="button" className="linkbtn" onClick={() => setRemote(true)}>
                {t("setup.remote")}
              </button>
            </span>
          </div>
        </div>
      )}
      {remote && <RemoteQr onClose={() => setRemote(false)} />}
      <Board
        page="control"
        className="control"
        columns={[
          [
            {
              id: "deck",
              title: t("blocks.deck"),
              node: (
                <div className="panel deck">
                  <div className="deck-now" data-tour="deck-now">
                    <div className="what">
                      <div className="eyebrow">
                        {t("current")}
                        {step.type === "speaker" ? ` · ${sp.findIndex((x) => x.key === step.key) + 1} / ${sp.length}` : ""}
                        {step.type === "project" ? ` · ${pr.findIndex((x) => x.key === step.key) + 1} / ${pr.length}` : ""}
                      </div>
                      <h2>{title}</h2>
                      <div className="nxt">
                        {step.type === "intro" && sp.length > 0 && hasTurns(s.settings.agenda)
                          ? `${t("checkInsFilled", { filled: filledN, total: sp.length })} · `
                          : ""}
                        {t("then", { next: next ? next.label : t("endOfMeeting") })}
                        {!m.startedAt && s.notify.nudge && filledN < sp.length && (
                          <>
                            {" · "}
                            <button className="linkbtn" onClick={() => rpc({ op: "notifications.nudge" }, t("nudgeSent"))}>
                              {t("nudge")}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {step.type === "speaker" || step.type === "project" ? (
                      <Timer stepKey={step.key} live />
                    ) : step.type !== "end" ? (
                      <UpCount className="upcount" />
                    ) : null}
                  </div>
                  <div className="controls" data-tour="controls">
                    <button
                      className="btn big"
                      disabled={cur <= 0 || !m.startedAt}
                      onClick={() => rpc({ op: "meeting.step", delta: -1, from: m.stepKey })}
                    >
                      ← {t("previous")}
                    </button>
                    <button
                      className={"btn big" + (m.startedAt ? " primary" : "")}
                      disabled={!next || !m.startedAt}
                      title={m.startedAt ? undefined : t("startFirst")}
                      onClick={() => rpc({ op: "meeting.step", delta: 1, from: m.stepKey })}
                    >
                      {next ? `${t("next", { label: nextLabel })} →` : t("lastStep")}
                    </button>
                    <span className="sep" />
                    {!m.startedAt && step.type === "intro" ? (
                      <button
                        className="btn big primary"
                        // A session prepared for another day happens today: it is dated today, the schedule keeps its occurrence
                        title={startOp(m.date) === "session.now" ? t("startToday") : undefined}
                        onClick={() =>
                          void rpc({ op: startOp(m.date) }, t("started") + (s.notify.started ? ` ${t("startedAnnounced")}` : "")).then(
                            (ok) => ok && track("session_started"),
                          )
                        }
                      >
                        ▶ {t("start")}
                      </button>
                    ) : (
                      step.type !== "end" && (
                        <>
                          <button className="btn" onClick={() => rpc({ op: "meeting.togglePlay" })}>
                            {running ? `⏸ ${t("pause")}` : `▶ ${t("timer")}`}
                          </button>
                          <button
                            className="btn"
                            onClick={() => rpc({ op: "meeting.resetTimer" })}
                            aria-label={t("resetTimer")}
                            title={t("resetTimer")}
                          >
                            ↺
                          </button>
                        </>
                      )
                    )}
                    {(step.type === "speaker" || step.type === "project") && (
                      <button
                        className="btn"
                        onClick={() =>
                          rpc({ op: "meeting.bonus" }, t("bonusAdded", { name: step.type === "speaker" ? first(step.label) : step.label }))
                        }
                      >
                        +30 s
                      </button>
                    )}
                  </div>
                  {step.type === "project" && <ProjectHost step={step} />}
                  {!m.endedAt && (
                    <SheetsSummary
                      onOpen={() => {
                        setPane("sheets");
                        // On a narrow screen the side panel sits far below: brought into view
                        requestAnimationFrame(() =>
                          document
                            .querySelector('[data-tour="pane"]')
                            ?.closest(".panel")
                            ?.scrollIntoView({
                              behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
                              block: "start",
                            }),
                        );
                      }}
                    />
                  )}
                  {!m.endedAt && <ProjectOrder />}
                  {step.type === "block" && step.block === "retro" && <RetroHost />}
                  {step.type === "block" && step.block === "poker" && <PokerHost />}
                  <StopControls />
                  {!!m.startedAt && (
                    <div className="controls" data-tour="beep">
                      <label className="check">
                        <input type="checkbox" checked={beep} onChange={(e) => setBeep(e.target.checked)} /> {t("beep")}
                      </label>
                    </div>
                  )}
                </div>
              ),
            },
            {
              id: "icebreaker",
              title: tStage("icebreaker"),
              node: mod("icebreaker") && step.type === "intro" && (
                <div className="panel">
                  <IcebreakerControl key={m.icebreaker ?? ""} />
                </div>
              ),
            },
            {
              id: "notes",
              title: t("blocks.notes"),
              node: (
                <div className="panel">
                  {step.type !== "end" ? (
                    <NotesBox stepKey={m.stepKey} label={step.type === "speaker" ? first(step.label) : title} />
                  ) : (
                    <div className="note-box">{t("endedReview")}</div>
                  )}
                </div>
              ),
            },
            {
              id: "spotlight",
              title: tStage("spotlight"),
              node: mod("spotlight") && !!m.startedAt && step.type !== "end" && (
                <div className="panel">
                  <SpotlightControl step={step} />
                </div>
              ),
            },
            {
              id: "preview",
              title: t("blocks.preview"),
              node: (
                <div data-tour="preview">
                  <div className="eyebrow" style={{ margin: "0 0 6px 2px" }}>
                    {t("blocks.preview")}
                  </div>
                  <div className="preview-frame">
                    <Stage stepKey={m.stepKey} mini />
                    <SharePreview />
                  </div>
                </div>
              ),
            },
          ],
          [
            {
              id: "panes",
              title: t("blocks.panes"),
              node: (
                <div className="panel">
                  <SwipeRow wrapClassName="panes-wrap" className="panes" role="tablist" aria-label={t("blocks.panes")} selected={pane}>
                    {(
                      [
                        ["run", 0],
                        ["live", pend],
                        ["actions", 0],
                        ["topics", tops],
                        ...(s.projects.length ? [["sheets", sheetsToComplete(s, sections)]] : []),
                        ...(s.modules.polls ? [["polls", s.polls.filter((p) => p.open).length]] : []),
                        ...(s.modules.random ? [["random", 0]] : []),
                        ["minutes", 0],
                      ] as [Pane, number][]
                    ).map(([k, n]) => (
                      <button
                        key={k}
                        role="tab"
                        aria-selected={pane === k}
                        // Raised hand or question pending: the tab calls the host as long as they are elsewhere
                        className={k === "live" && n > 0 && pane !== k ? "alert" : undefined}
                        title={k === "live" && n > 0 ? t("pendingRequests", { count: n }) : undefined}
                        onClick={() => setPane(k)}
                      >
                        {k === "live" && n > 0 && pane !== k && <span aria-hidden="true">✋ </span>}
                        {t(`panes.${k}`)}
                        {n > 0 && <span className="cnt">{n}</span>}
                      </button>
                    ))}
                  </SwipeRow>
                  <div data-tour="pane" role="tabpanel">
                    {pane === "run" && <PaneRun />}
                    {pane === "live" && <PaneLive />}
                    {pane === "actions" && <PaneActions />}
                    {pane === "topics" && <PaneTopics />}
                    {pane === "sheets" && <PaneSheets />}
                    {pane === "polls" && <PollsHost />}
                    {pane === "random" && <RandomHost />}
                    {pane === "minutes" && <PaneMinutes draft={minutesDraft} setDraft={setMinutesDraft} />}
                  </div>
                </div>
              ),
            },
            {
              id: "sounds",
              title: t("blocks.sounds"),
              // Folded: music, cues and soundboard are there when wanted, not in the way (the player inside stays
              // mounted, the host's tab plays the sounds of "My screen")
              node: mod("sounds") && (
                <details className="panel snd-fold" data-tour="sounds">
                  <summary>
                    <Icon name="volume" size={16} /> {t("blocks.sounds")}
                  </summary>
                  <SoundPanel />
                </details>
              ),
            },
          ],
        ]}
      />
    </>
  );
}

/** Pick the icebreaker question (intro step) */
function IcebreakerControl() {
  const t = useTranslations("control");
  const { s, rpc, agenda } = useRonde();
  const [ask, setAsk] = useState(false);
  const q = s.meeting!.icebreaker;
  const total = agenda.filter((x) => x.type === "speaker").length;
  const change = () => rpc({ op: "icebreaker.set", question: null });
  return (
    <div className="spot-bar" style={{ background: "var(--surface-2)" }} data-tour="icebreaker">
      <Icon name="snowflake" size={16} />
      <span className="grow" title={q ?? ""}>
        {q ? (
          <>
            <strong>{q}</strong> · {t("icebreaker.answers", { count: s.answers.length, total })}
          </>
        ) : (
          t("icebreaker.none")
        )}
      </span>
      {s.settings.icebreakers.length > 1 &&
        (ask ? (
          <>
            <span>{t("icebreaker.answersErased")}</span>
            <button className="btn danger" onClick={change}>
              {t("icebreaker.changeAnyway")}
            </button>
            <button className="icon-btn" onClick={() => setAsk(false)}>
              {t("keep")}
            </button>
          </>
        ) : (
          <button className="icon-btn" onClick={() => (s.answers.length ? setAsk(true) : change())}>
            {t("icebreaker.another")}
          </button>
        ))}
    </div>
  );
}

/** Spotlight on the shared screen: a check-in item, a question, a topic or a free message */
function SpotlightControl({ step }: { step: Step }) {
  const t = useTranslations("control");
  const { s, rpc, nameOf, sections, host } = useRonde();
  const [text, setText] = useState("");
  const spot = s.meeting!.spotlight;
  const picks: { label: string; text: string }[] = [];
  if (step.type === "speaker") {
    const f = s.checkIns[step.id!];
    const who = first(step.label);
    [...sections]
      .sort((a, b) => Number(b.kind === "blockers") - Number(a.kind === "blockers"))
      .forEach((sec) => itemsOf(f, sec).forEach((x) => picks.push({ label: `${who} · ${sec.label}`, text: plainItem(x) })));
  } else if (step.type === "project") {
    const p = s.projects.find((x) => x.id === step.projectId);
    [...sections]
      .sort((a, b) => Number(b.kind === "blockers") - Number(a.kind === "blockers"))
      .forEach((sec) =>
        projectEntries(s.checkIns, step.speakers ?? [], step.projectId!, sec).forEach((e) =>
          picks.push({ label: `${p?.name ?? ""} · ${first(nameOf(e.ownerId))} · ${sec.label}`, text: plainItem(e.text) }),
        ),
      );
  } else if (step.type === "qa") {
    s.interactions
      .filter((i) => i.stepKey === step.of && i.type === "question")
      .forEach((i) => picks.push({ label: t("spotlight.questionFrom", { name: first(nameOf(i.byId)) }), text: i.text }));
  } else if (step.type === "misc") {
    s.topics.filter((x) => !x.done).forEach((x) => picks.push({ label: t("spotlight.topic"), text: x.text }));
  } else if (step.type === "intro") {
    s.settings.announcements.forEach((a) => picks.push({ label: t("spotlight.announcement"), text: a }));
  }
  const show = (label: string, value: string) => rpc({ op: "spotlight.set", label, text: value });
  // A check-in item of the shown person is highlighted in place on the shared screen; anything else shows as a banner
  const inCheckIn =
    !!spot &&
    ((step.type === "speaker" && sectionsHave(s.checkIns[step.id!], sections, spot.text)) ||
      (step.type === "project" &&
        sections.some((sec) => projectEntries(s.checkIns, [], step.projectId!, sec).some((e) => plainItem(e.text) === spot.text))));
  return (
    <div className="notes" data-tour="spotlight">
      <div className="notes-head">
        <h4>{t("spotlight.title")}</h4>
      </div>
      {spot && (
        <div className="spot-bar" role="status">
          <Icon name="sparkles" size={16} />
          <span className="grow">
            <strong>{spot.text}</strong>
            <span className="where">{inCheckIn ? t("spotlight.inCheckIn") : t("spotlight.inBanner")}</span>
          </span>
          <button className="btn" onClick={() => rpc({ op: "spotlight.clear" })}>
            {t("remove")}
          </button>
        </div>
      )}
      {picks.length > 0 && (
        <div className="spot-picks">
          {picks.slice(0, 12).map((p, i) => {
            const on = spot?.text === p.text;
            return (
              <button
                key={i}
                aria-pressed={on}
                title={on ? t("spotlight.onScreen") : p.text}
                onClick={() => (on ? rpc({ op: "spotlight.clear" }) : show(p.label, p.text))}
              >
                <Icon name="sparkles" size={14} /> {p.text}
              </button>
            );
          })}
        </div>
      )}
      <form
        className="controls"
        style={{ marginTop: picks.length ? 8 : 0 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (text.trim() && (await show(t("spotlight.messageFrom", { host }), text.trim()))) setText("");
        }}
      >
        <label htmlFor="spotText" className="sr-only">
          {t("spotlight.message")}
        </label>
        <input
          id="spotText"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("spotlight.messagePlaceholder")}
          style={{ flex: 1 }}
        />
        <button className="btn" type="submit" disabled={!text.trim()}>
          {t("spotlight.show")}
        </button>
      </form>
    </div>
  );
}

/** Meeting sounds, played on everyone's "My screen" or on the shared screen: shared settings, and an on-demand soundboard */
function SoundPanel() {
  const t = useTranslations("control");
  const tSounds = useTranslations("sounds");
  const { s, rpc, now } = useRonde();
  const c = s.settings.sound;
  const set = (patch: Omit<Extract<Parameters<typeof rpc>[0], { op: "sounds.settings" }>, "op">) =>
    void rpc({ op: "sounds.settings", ...patch });
  // Volume saved when the slider stops, not at every notch
  const [vol, setVol] = useState(c.volume);
  useEffect(() => setVol(c.volume), [c.volume]);
  useEffect(() => {
    if (vol === c.volume) return;
    const timer = setTimeout(() => void rpc({ op: "sounds.settings", volume: vol }), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vol]);
  const party = birthdaysAround(
    s.members.filter((m) => m.active),
    new Date(now()),
  );
  const pads = BOARD_SOUNDS.filter((b) => b.key !== "birthday" || party.length);
  // Pads lit during playback: when the broadcast sound arrives (so also for another host), for its duration
  const [playing, setPlaying] = useState<Record<string, number>>({});
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const onSound = (e: Event) => {
      const key = (e as CustomEvent<SoundKey>).detail;
      const n = Math.random();
      void soundLength(key).then((len) => {
        setPlaying((p) => ({ ...p, [key]: n }));
        timers.push(setTimeout(() => setPlaying((p) => (p[key] === n ? { ...p, [key]: 0 } : p)), len * 1000));
      });
    };
    window.addEventListener("ronde-sound", onSound);
    return () => {
      window.removeEventListener("ronde-sound", onSound);
      timers.forEach(clearTimeout);
    };
  }, []);
  return (
    <div className="snd">
      <div className="snd-top">
        <label className="check">
          <input type="checkbox" checked={c.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> {t("sounds.enabled")}
        </label>
        {c.enabled && (
          <>
            <input
              className="snd-vol"
              type="range"
              min={0}
              max={100}
              step={5}
              value={vol}
              onChange={(e) => setVol(Number(e.target.value))}
              aria-label={t("sounds.volume")}
            />
            <span className="snd-pct">{vol} %</span>
          </>
        )}
      </div>
      {/* Sounds played on "My screen": the host hears them here too, otherwise nothing tells them they play */}
      <SoundPlayer where="participants" control />
      {c.enabled && (
        <>
          <div className="snd-row">
            <span className="lbl-s">{t("sounds.playedOn")}</span>
            <div className="seg" role="group" aria-label={t("sounds.where")}>
              {(["participants", "screen"] as SoundOutput[]).map((v) => (
                <button key={v} aria-pressed={c.output === v} onClick={() => set({ output: v })}>
                  {t(`sounds.output.${v}`)}
                </button>
              ))}
            </div>
          </div>
          <p className="hint snd-hint">{c.output === "participants" ? t("sounds.participantsHint") : t("sounds.screenHint")}</p>

          <div className="snd-sec">
            <div className="eyebrow">{t("sounds.board")}</div>
            <div className="snd-pads" role="group" aria-label={t("sounds.board")}>
              {pads.map((b) => (
                <button
                  key={b.key}
                  className={"snd-pad" + (b.key === "birthday" ? " party" : "") + (playing[b.key] ? " on" : "")}
                  aria-pressed={!!playing[b.key]}
                  onClick={() => void rpc({ op: "sounds.play", sound: b.key })}
                >
                  <span className="e" aria-hidden="true">
                    {b.emoji}
                  </span>
                  <span className="l">
                    {b.key === "birthday" ? t("sounds.birthdayOf", { names: party.join(", ") }) : tSounds(`board.${b.key}`)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="snd-sec">
            <div className="snd-row">
              <label className="check">
                <input type="checkbox" checked={c.music} onChange={(e) => set({ music: e.target.checked })} /> {t("sounds.music")}
              </label>
              {c.music && (
                <Select
                  className="snd-music"
                  aria-label={t("sounds.music")}
                  value={c.musicStyle}
                  onChange={(e) => set({ musicStyle: e.target.value as MusicStyle })}
                >
                  {MUSIC_GROUPS.map((g) => (
                    <optgroup key={g} label={tSounds(`groups.${g}`)}>
                      {MUSIC_STYLES.filter((st) => st.group === g).map((st) => (
                        <option key={st.key} value={st.key}>
                          {tSounds(`music.${st.key}`)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              )}
            </div>
            <p className="hint snd-hint">{t("sounds.musicHint")}</p>
          </div>

          <div className="snd-sec">
            <div className="eyebrow">{t("sounds.cues")}</div>
            <div className="snd-cues">
              {CUES.map((cue) => (
                <label className="check" key={cue} title={tSounds(`cues.${cue}.hint`)}>
                  <input type="checkbox" checked={c.cues[cue]} onChange={(e) => set({ cues: { [cue]: e.target.checked } })} />{" "}
                  {tSounds(`cues.${cue}.label`)}
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Beep at the end of the speaking time (turned on by the person running the meeting) */
function useBeep(enabled: boolean) {
  const { s, now } = useRonde();
  const last = useRef("");
  const ctx = useRef<AudioContext | null>(null);
  useTick(enabled ? 500 : 60_000);
  const m = s.meeting;
  // Control-room monitoring already plays the end-of-speaking-time cue: no second beep on top of it
  const snd = s.settings.sound;
  if (snd.enabled && snd.output === "participants" && snd.cues.timeUp && controlMonitorOn()) return;
  if (!enabled || !m || !m.timer.running || !s.members.some((x) => x.id === m.stepKey)) return;
  const rem = s.settings.speakSec * 1000 + (m.bonus[m.stepKey] ?? 0) - spentOf(m, m.stepKey, now());
  const tag = m.stepKey + ":" + (m.bonus[m.stepKey] ?? 0);
  if (rem <= 0 && rem > -2000 && last.current !== tag) {
    last.current = tag;
    try {
      ctx.current ??= new AudioContext();
      const o = ctx.current.createOscillator();
      const g = ctx.current.createGain();
      o.frequency.value = 880;
      g.gain.value = 0.08;
      o.connect(g);
      g.connect(ctx.current.destination);
      o.start();
      o.stop(ctx.current.currentTime + 0.25);
    } catch {
      /* sound unavailable */
    }
  }
}

/**
 * Host notes for the minutes, one area per step.
 * If the step changes while typing, the area stays on the previous step until it is left: nothing ends up under the wrong person.
 */
function NotesBox({ stepKey, label, autoFocus }: { stepKey: string; label: string; autoFocus?: boolean }) {
  const t = useTranslations("control");
  const tMinutes = useTranslations("minutes");
  const { s, rpc, host, members, agenda } = useRonde();
  // Step whose notes are edited: the current one, unless they were still being typed when the screen moved on
  const [pin, setPin] = useState<{ key: string; label: string } | null>(null);
  // Previous step, to add something forgotten
  const [last, setLast] = useState<{ key: string; label: string } | null>(null);
  const key = pin?.key ?? stepKey;
  const shown = pin?.label ?? label;
  const [text, setText] = useState(s.notes[key] ?? "");
  const [status, setStatus] = useState("");
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keyRef = useRef(key);
  const textRef = useRef(text);
  const ta = useRef<HTMLElement>(null);
  const insertRef = useRef<((t: string) => void) | null>(null);
  const [action, setAction] = useState<{ text: string; owner: string } | null>(null);

  const flush = useCallback(
    async (k: string, value: string) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (!dirty.current) return;
      dirty.current = false;
      const ok = await rpc({ op: "note.set", key: k, text: value });
      setStatus(ok ? t("notes.saved") : t("notes.notSaved"));
    },
    [rpc, t],
  );

  const show = (v: string) => {
    textRef.current = v;
    setText(v);
  };

  // The screen changes step: keep the area on the previous step if it was still being typed in
  const stepRef = useRef({ key: stepKey, label });
  useEffect(() => {
    const prev = stepRef.current;
    stepRef.current = { key: stepKey, label };
    if (prev.key === stepKey) return;
    setLast(prev);
    if (pin?.key === stepKey) setPin(null);
    else if (!pin && document.activeElement === ta.current) setPin(prev);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  // Edited step changed: save the previous step's notes and show the new step's ones
  useEffect(() => {
    if (keyRef.current === key) return;
    void flush(keyRef.current, textRef.current);
    keyRef.current = key;
    show(s.notes[key] ?? "");
    setStatus("");
  }, [key, flush, s.notes]);

  // Notes changed elsewhere (another tab): take them if nothing is being typed here
  useEffect(() => {
    if (!dirty.current && document.activeElement !== ta.current) show(s.notes[key] ?? "");
  }, [s.notes, key]);

  const change = (v: string) => {
    show(v);
    dirty.current = true;
    setStatus(t("notes.saving"));
    if (timer.current) clearTimeout(timer.current);
    const k = key;
    timer.current = setTimeout(() => void flush(k, v), 700);
  };

  // Where these notes will appear in the minutes
  const who = members[memberOfStep(key)]?.name;
  const blockStep = agenda.find((x) => x.key === memberOfStep(key) && x.type === "block");
  const place =
    key === "intro"
      ? tMinutes("introduction")
      : key === "misc"
        ? tMinutes("topics")
        : blockStep
          ? blockStep.block === "retro"
            ? tMinutes("retro")
            : blockStep.label
          : who
            ? `${tMinutes("round")} › ${who} › ${key.startsWith("qa:") ? tMinutes("exchanges") : tMinutes("hostNotes", { host })}`
            : null;

  // In a dialog: the caret in the area (after the focus the dialog gives its first button)
  useEffect(() => {
    if (!autoFocus) return;
    const id = requestAnimationFrame(() => ta.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [autoFocus]);

  const reopen = (x: { key: string; label: string }) => {
    setPin(x);
    requestAnimationFrame(() => ta.current?.focus());
  };

  // Anyone of the meeting can own an action: the host who does not speak in the round, an observer following it
  const active = actionOwners(s);
  const openAction = () => {
    const who = memberOfStep(key);
    setAction({ text: "", owner: members[who] ? who : "" });
  };
  const createAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!action?.text.trim() || !action.owner) return;
    const txt = action.text.trim();
    if (!(await rpc({ op: "action.add", text: txt, ownerId: action.owner, originText: null }, t("actionCreated")))) return;
    setAction(null);
    // Trace in the notes: the action also shows up in the follow-up actions table of the minutes
    insertRef.current?.(`**${t("notes.actionPrefix")}:** ${txt} (${first(active.find((x) => x.id === action.owner)?.name)})`);
  };

  // Typing over (focus leaves the area, its action form included): the area joins the current step
  const box = useRef<HTMLDivElement>(null);
  const onBlurArea = () =>
    setTimeout(() => {
      if (!box.current?.contains(document.activeElement)) setPin(null);
    }, 0);

  return (
    <div className="notes" data-tour="notes" ref={box} onBlur={onBlurArea}>
      <div className="notes-head">
        <h4>{t("notes.title", { label: shown })}</h4>
        <span className="saved" role="status">
          {status}
        </span>
      </div>
      {place && <p className="hint note-place">{t("notes.place", { place })}</p>}
      {pin ? (
        <div className="note-pin" role="status">
          <span>{t.rich("notes.pinned", { pinned: pin.label, label, strong: (chunks) => <strong>{chunks}</strong> })}</span>
          <button type="button" className="icon-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => setPin(null)}>
            {t("notes.switchTo", { label })}
          </button>
        </div>
      ) : (
        last &&
        last.key !== stepKey && (
          <button type="button" className="linkbtn note-back" onClick={() => reopen(last)}>
            ← {t("notes.addTo", { label: last.label })}
          </button>
        )
      )}
      <MdEditor
        id="notesBox"
        label={tMinutes("hostNotes", { host })}
        inputRef={ta}
        value={text}
        onChange={change}
        onBlur={() => void flush(keyRef.current, textRef.current)}
        placeholder={t("notes.placeholder", { decision: tMinutes("decisionPrefix") })}
        extra={(insert) => {
          insertRef.current = insert;
          return (
            <>
              <button
                type="button"
                className="md-btn md-tpl"
                title={t("notes.decisionHint")}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insert(`**${tMinutes("decisionPrefix")}:** `)}
              >
                + {tMinutes("decisionPrefix")}
              </button>
              <button
                type="button"
                className="md-btn md-tpl"
                title={t("notes.actionHint")}
                aria-expanded={!!action}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => (action ? setAction(null) : openAction())}
              >
                + {t("notes.actionPrefix")}
              </button>
            </>
          );
        }}
      />
      {action && (
        <form className="note-action" onSubmit={createAction}>
          <label htmlFor="noteAction" className="sr-only">
            {t("notes.newAction")}
          </label>
          <input
            id="noteAction"
            type="text"
            autoFocus
            value={action.text}
            onChange={(e) => setAction({ ...action, text: e.target.value })}
            onKeyDown={(e) => e.key === "Escape" && setAction(null)}
            placeholder={t("notes.newActionPlaceholder")}
          />
          <Select
            aria-label={t("owner")}
            required
            value={action.owner}
            onChange={(e) => setAction({ ...action, owner: e.target.value })}
            style={{ width: "auto" }}
          >
            <option value="" disabled>
              {t("ownerPlaceholder")}
            </option>
            {active.map((x) => (
              <option key={x.id} value={x.id}>
                {first(x.name)}
              </option>
            ))}
          </Select>
          <button className="btn primary" type="submit" disabled={!action.text.trim() || !action.owner}>
            {t("notes.createAction")}
          </button>
          <button type="button" className="icon-btn" onClick={() => setAction(null)}>
            {t("cancel")}
          </button>
        </form>
      )}
    </div>
  );
}

function RunRow(p: {
  state: string;
  label: string;
  ico?: React.ReactNode;
  acts: React.ReactNode;
  cls: string;
  isCur: boolean;
  spent: number;
  noted?: boolean;
}) {
  const t = useTranslations("control");
  return (
    <li className={`${p.cls} ${p.isCur ? "cur" : ""}`}>
      <span className="st">{p.state}</span>
      {p.ico}
      <span className="nm">{p.label}</span>
      {p.noted && (
        <span className="noted" title={t("run.notedHint")} role="img" aria-label={t("run.noted")}>
          <Icon name="note" size={14} />
        </span>
      )}
      <span className="tm">{p.spent ? mmssPlain(p.spent) : ""}</span>
      <span className="acts">{p.acts}</span>
    </li>
  );
}

/** The host fixes someone's check-in (forgotten, absent, asked by the person) */
function HostCheckIn({ memberId, onClose }: { memberId: string; onClose: () => void }) {
  const t = useTranslations("control");
  const draft = useCheckInDraft(memberId);
  const [asking, setAsking] = useState(false);
  // Unsaved changes: ask inside the dialog rather than with a browser prompt
  const close = () => (draft.dirty ? setAsking(true) : onClose());
  return (
    <Modal onClose={close}>
      <CheckInForm memberId={memberId} draft={draft} byHost onSaved={onClose} />
      <div className="controls" style={{ justifyContent: "flex-end" }}>
        {asking ? (
          <>
            <span className="hint">{t("unsavedCheckIn")}</span>
            <button className="btn danger" onClick={onClose}>
              {t("closeAnyway")}
            </button>
            <button className="btn" onClick={() => setAsking(false)}>
              {t("keepEditing")}
            </button>
          </>
        ) : (
          <button className="btn" onClick={close}>
            {t("close")}
          </button>
        )}
      </div>
    </Modal>
  );
}

/** Async mode: the session closes by itself at the planned time; the host can publish the digest earlier */
function AsyncBanner() {
  const t = useTranslations("control");
  const locale = useLocale();
  const { s, rpc } = useRonde();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const planned = s.meeting?.plannedAt;
  const when = planned
    ? new Date(planned).toLocaleString(locale, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })
    : "";
  return (
    <div className="async-banner" role="note">
      <strong>
        <Icon name="mail" size={16} /> {t("async.title")}
      </strong>
      <p>{when ? t("async.hint", { when }) : t("async.hintNoTime")}</p>
      <div className="controls">
        {confirm ? (
          <>
            <span>{t("async.confirm")}</span>
            <button
              type="button"
              className="btn primary sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                if (await rpc({ op: "meeting.publish" }, t("async.published"))) setConfirm(false);
                setBusy(false);
              }}
            >
              {t("async.yes")}
            </button>
            <button type="button" className="btn sm" onClick={() => setConfirm(false)}>
              {t("cancel")}
            </button>
          </>
        ) : (
          <button type="button" className="btn sm" onClick={() => setConfirm(true)}>
            {t("async.publish")}
          </button>
        )}
        <span className="hint">{t("async.orLive")}</span>
      </div>
    </div>
  );
}

function PaneRun() {
  const t = useTranslations("control");
  const { s, agenda, cur, members, rpc, now } = useRonde();
  const [editing, setEditing] = useState<string | null>(null);
  const m = s.meeting!;
  const absent = new Set(m.absent);
  const order = m.order.filter((id) => members[id]);
  const at = now();
  const idx = (k: string) => agenda.findIndex((x) => x.key === k);
  const st = (k: string) => {
    const i = idx(k);
    return i < 0 ? t("run.absent") : i < cur ? t("run.done") : i === cur ? t("run.current") : t("run.upcoming");
  };
  // No step jumping before the start
  const go = (k: string) =>
    m.startedAt ? (
      <button className="icon-btn" onClick={() => rpc({ op: "meeting.goto", key: k })}>
        {t("run.go")}
      </button>
    ) : null;
  const row = (k: string, label: string, acts: React.ReactNode, opts: { ico?: React.ReactNode; cls?: string } = {}) => (
    <RunRow
      key={k}
      state={st(k)}
      label={label}
      ico={opts.ico}
      acts={acts}
      cls={opts.cls ?? ""}
      isCur={m.stepKey === k}
      spent={spentOf(m, k, at)}
      noted={!!s.notes[k]?.trim()}
    />
  );
  const qa = (k: string) => {
    const x: Step | undefined = agenda.find((a) => a.key === "qa:" + k);
    return x ? row(x.key, `✋ ${t("run.questions", { pending: x.pending ?? 0, total: x.total ?? 0 })}`, go(x.key), { cls: "qa" }) : null;
  };
  // Blocks of the agenda whose module is on, in order
  const blocks = s.settings.agenda.filter((b) => !BLOCK_MODULE[b.type] || s.modules[BLOCK_MODULE[b.type]!]);
  const roundRows = () =>
    order.map((id, i) => {
      const f = s.checkIns[id];
      return [
        row(
          id,
          members[id]!.name,
          <>
            <button
              className="icon-btn"
              disabled={i === 0}
              aria-label={t("run.moveUp")}
              onClick={() => rpc({ op: "meeting.move", id, delta: -1 })}
            >
              ↑
            </button>
            <button
              className="icon-btn"
              disabled={i === order.length - 1}
              aria-label={t("run.moveDown")}
              onClick={() => rpc({ op: "meeting.move", id, delta: 1 })}
            >
              ↓
            </button>
            <button className="icon-btn" onClick={() => rpc({ op: "meeting.absent", id })}>
              {absent.has(id) ? t("run.markPresent") : t("run.markAbsent")}
            </button>
            <button className="icon-btn" onClick={() => setEditing(id)} title={t("run.editCheckIn", { name: first(members[id]!.name) })}>
              {t("run.checkIn")}
            </button>
            {!absent.has(id) && go(id)}
          </>,
          {
            cls: absent.has(id) ? "abs" : "",
            ico: (
              <>
                <span
                  className={"check-in-dot" + (isCheckInReady(f, s.lastArchivedAt) ? " ok" : "")}
                  title={
                    isCheckInReady(f, s.lastArchivedAt)
                      ? t("run.checkInFilled")
                      : isCheckInStale(f, s.lastArchivedAt)
                        ? t("run.checkInStale")
                        : t("run.checkInEmpty")
                  }
                />
                <Avatar id={id} sm />
              </>
            ),
          },
        ),
        qa(id),
      ];
    });
  return (
    <>
      {s.modules.async && !m.startedAt && <AsyncBanner />}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <MeetingDate />
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => rpc({ op: "meeting.shuffle" }, t("run.shuffled"))}>
          {t("run.shuffle")}
        </button>
      </div>
      <ul className="run" data-tour="run-list">
        {blocks.map((b) => {
          if (b.type === "intro") return [row("intro", t("run.intro"), go("intro")), qa("intro")];
          if (b.type === "topics") return [row("misc", t("run.topics"), go("misc")), qa("misc")];
          if (b.type === "round") return roundRows();
          // A module block: each of its steps (retro phases, a timebox…)
          return agenda
            .filter((x) => x.type === "block" && x.blockId === b.id)
            .flatMap((x) => [
              row(x.key, x.label, go(x.key), { ico: <Icon name={BLOCK_ICON[x.block ?? "timebox"]} size={14} /> }),
              qa(x.key),
            ]);
        })}
        {row("end", t("run.end"), go("end"))}
      </ul>
      <p className="hint" style={{ marginTop: 8 }}>
        {t.rich("run.legend", { note: () => <Icon name="note" size={13} /> })}
      </p>
      {editing && members[editing] && <HostCheckIn key={editing} memberId={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/** Meeting date: editable as long as it has not started (holidays, public holiday…) */
function MeetingDate() {
  const t = useTranslations("control");
  const fmt = formatters(useLocale());
  const { s, rpc, hydrated } = useRonde();
  const m = s.meeting!;
  const [date, setDate] = useState(m.date);
  useEffect(() => setDate(m.date), [m.date]);
  if (m.startedAt)
    return (
      <span className="muted cap" style={{ fontSize: 13 }}>
        {fmt.dateShort(m.date)}
      </span>
    );
  const past = hydrated && m.date < isoDay(new Date());
  return (
    <span className="controls" style={{ gap: 6 }} data-tour="meeting-date">
      <label htmlFor="meetingDate" className="lbl-s">
        {t("meetingOf")}
      </label>
      <input
        id="meetingDate"
        type="date"
        required
        value={date}
        onChange={(e) => setDate(e.target.value)}
        onBlur={async () => {
          if (date && date !== m.date && !(await rpc({ op: "meeting.setDate", date }, t("meetingMoved", { date: fmt.dateShort(date) }))))
            setDate(m.date);
        }}
        style={{ width: "auto" }}
      />
      {past && <span className="err">{t("pastDate")}</span>}
    </span>
  );
}

function LiveItem({ x, where }: { x: InteractionDTO; where: (k: string) => string }) {
  const t = useTranslations("control");
  const { rpc, nameOf } = useRonde();
  return (
    <div className={"item" + (x.resolved ? " done" : "")}>
      <Avatar id={x.byId} sm />
      <div className="body">
        <strong>{nameOf(x.byId)}</strong>
        {x.targetId && ` → ${first(nameOf(x.targetId))}`} <span className="muted">· {t("live.during", { step: where(x.stepKey) })}</span>
        <div>{x.type === "hand" ? `✋ ${t("live.asksToSpeak")}` : "❓ " + x.text}</div>
      </div>
      {x.resolved ? (
        <button className="icon-btn" onClick={() => rpc({ op: "hands.resolve", id: x.id, resolved: false })}>
          ↺ {t("live.reopen")}
        </button>
      ) : (
        <button className="btn soft" onClick={() => rpc({ op: "hands.resolve", id: x.id, resolved: true })}>
          ✓ {x.type === "hand" ? t("live.floorGiven") : t("live.markAnswered")}
        </button>
      )}
    </div>
  );
}

function PaneLive() {
  const t = useTranslations("control");
  const tAgenda = useTranslations("agenda");
  const { s, nameOf } = useRonde();
  const pending = s.interactions.filter((x) => !x.resolved);
  const done = s.interactions.filter((x) => x.resolved);
  const where = (k: string) => (k === "intro" ? tAgenda("intro") : k === "misc" ? tAgenda("topics") : first(nameOf(k)));
  const rx: Record<string, number> = {};
  const base = baseKeyOf(s.meeting!.stepKey);
  s.reactions.filter((r) => r.stepKey === base).forEach((r) => (rx[r.emoji] = (rx[r.emoji] ?? 0) + 1));
  return (
    <>
      <h3>{t("live.pending", { count: pending.length })}</h3>
      {pending.length ? pending.map((x) => <LiveItem key={x.id} x={x} where={where} />) : <p className="muted">{t("live.noHands")}</p>}
      {done.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>{t("live.handled")}</h3>
          {done.map((x) => (
            <LiveItem key={x.id} x={x} where={where} />
          ))}
        </>
      )}
      {s.kudos.length > 0 && (
        <>
          <h3 style={{ marginTop: 14 }}>{t("live.kudos", { count: s.kudos.length })}</h3>
          {s.kudos.map((k) => (
            <div className="item" key={k.id}>
              <span aria-hidden="true">💜</span>
              <div className="body">
                <strong>{first(nameOf(k.fromId))}</strong> → <strong>{first(nameOf(k.toId))}</strong>
                <div>{k.text}</div>
              </div>
            </div>
          ))}
        </>
      )}
      <p className="hint" style={{ marginTop: 12 }}>
        {t("live.reactions", {
          list:
            Object.entries(rx)
              .map(([e, n]) => `${e} ${n}`)
              .join("  ") || t("live.none"),
        })}
      </p>
    </>
  );
}

function PaneActions() {
  const t = useTranslations("control");
  const tStatus = useTranslations("actionStatus");
  const fmt = formatters(useLocale());
  const { s, agenda, rpc, sections } = useRonde();
  const [text, setText] = useState("");
  const owners = actionOwners(s);
  const [owner, setOwner] = useState(owners[0]?.id ?? "");
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  // Blockers of each turn (with the projects that have no step of their own), then of each project's step
  const blockers = blockersOf(s, agenda, sections, projectsWithTurn(agenda), projectEntries);
  const tracked = (id: string, b: string) => isTracked(s.actions, id, b);
  const sorted = sortActions(s.actions);
  return (
    <>
      <h3>{t("actions.blockers")}</h3>
      {blockers.length ? (
        blockers.map((x, i) => (
          <div className="item" key={i}>
            <Avatar id={x.id} sm />
            <div className="body">{x.b}</div>
            {tracked(x.id, x.b) ? (
              <span className="st-pill st-doing">{t("actions.tracked")}</span>
            ) : (
              <button
                className="btn soft"
                onClick={() =>
                  rpc({ op: "action.add", text: x.b, ownerId: x.id, originText: x.b, projectId: x.projectId }, t("actionCreated"))
                }
              >
                {t("actions.create")}
              </button>
            )}
          </div>
        ))
      ) : (
        <p className="muted">{t("actions.noBlockers")}</p>
      )}
      <h3 style={{ marginTop: 16 }}>{t("actions.title")}</h3>
      {sorted.length ? (
        sorted.map((a) => (
          <div className={"item" + (a.status === "done" ? " done" : "")} key={a.id}>
            <div className="body">
              {a.text}
              <div className="meta">{a.originDate ? t("actions.since", { date: fmt.dayMonth(a.originDate) }) : ""}</div>
              <div className="controls" style={{ marginTop: 6 }}>
                <Select
                  aria-label={t("owner")}
                  value={a.ownerId}
                  onChange={(e) => rpc({ op: "action.update", id: a.id, ownerId: e.target.value })}
                >
                  {owners.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label={t("status")}
                  value={a.status}
                  onChange={(e) => rpc({ op: "action.update", id: a.id, status: e.target.value as ActionStatus })}
                >
                  {ACTION_STATUSES.map((k) => (
                    <option key={k} value={k}>
                      {tStatus(k)}
                    </option>
                  ))}
                </Select>
                {confirmDel === a.id ? (
                  <>
                    <button className="btn danger" onClick={() => rpc({ op: "action.delete", id: a.id }).then(() => setConfirmDel(null))}>
                      {t("actions.confirmDelete")}
                    </button>
                    <button className="icon-btn" onClick={() => setConfirmDel(null)}>
                      {t("cancel")}
                    </button>
                  </>
                ) : (
                  <button className="icon-btn" onClick={() => setConfirmDel(a.id)}>
                    {t("actions.delete")}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))
      ) : (
        <p className="muted">{t("actions.none")}</p>
      )}
      <form
        className="controls"
        style={{ marginTop: 10 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim() || !owner) return;
          if (await rpc({ op: "action.add", text: text.trim(), ownerId: owner, originText: null }, t("actionCreated"))) setText("");
        }}
      >
        <label htmlFor="naText" className="sr-only">
          {t("actions.new")}
        </label>
        <input
          id="naText"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("actions.new")}
          style={{ flex: 1, minWidth: 140 }}
        />
        <Select aria-label={t("owner")} value={owner} onChange={(e) => setOwner(e.target.value)} style={{ width: "auto" }}>
          {owners.map((x) => (
            <option key={x.id} value={x.id}>
              {first(x.name)}
            </option>
          ))}
        </Select>
        <button className="btn" type="submit">
          {t("add")}
        </button>
      </form>
    </>
  );
}

function PaneTopics() {
  const t = useTranslations("control");
  const tMe = useTranslations("me");
  const tRetro = useTranslations("retro");
  const { s, rpc, nameOf, host, mod } = useRonde();
  const [text, setText] = useState("");
  const votesLeft = VOTES_PER_PERSON - s.topics.filter((x) => x.mine).length;
  const topics = [...s.topics].sort((a, b) => Number(a.done) - Number(b.done) || b.votes - a.votes || a.createdAt - b.createdAt);
  return (
    <>
      {/* The host votes too, with the same number of votes as everyone */}
      {topics.some((x) => !x.done) && <p className="hint">{tRetro("me.votesLeft", { count: votesLeft, total: VOTES_PER_PERSON })}</p>}
      {topics.length ? (
        topics.map((x) => (
          <div className="item" key={x.id}>
            <input
              type="checkbox"
              checked={x.done}
              aria-label={t("topics.handled")}
              onChange={(e) => rpc({ op: "topic.done", id: x.id, done: e.target.checked })}
            />
            <div className="body">
              {x.text}
              <div className="meta">{nameOf(x.byId) || host}</div>
            </div>
            <button
              type="button"
              className="vote-btn"
              aria-pressed={x.mine}
              aria-label={x.mine ? tMe("unvote") : tMe("vote")}
              title={x.mine ? tMe("unvote") : tMe("vote")}
              onClick={() => rpc({ op: "topic.vote", id: x.id })}
            >
              ▲ {x.votes}
            </button>
            {/* Shown big by the spotlight: without its module, the screen would show nothing */}
            {mod("spotlight") && (
              <button
                className="icon-btn"
                title={t("topics.showBig")}
                aria-label={t("topics.showBig")}
                onClick={() => rpc({ op: "spotlight.set", label: t("spotlight.topic"), text: x.text })}
              >
                ✨
              </button>
            )}
            <button className="icon-btn" onClick={() => rpc({ op: "topic.delete", id: x.id })}>
              {t("remove")}
            </button>
          </div>
        ))
      ) : (
        <p className="muted">{t("topics.none")}</p>
      )}
      <form
        className="controls"
        style={{ marginTop: 10 }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (text.trim() && (await rpc({ op: "topic.add", text: text.trim() }, t("topics.added")))) setText("");
        }}
      >
        <label htmlFor="hostTopic" className="sr-only">
          {t("topics.new")}
        </label>
        <input
          id="hostTopic"
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("topics.addPlaceholder")}
          style={{ flex: 1 }}
        />
        <button className="btn" type="submit">
          {t("add")}
        </button>
      </form>
      {s.modules.parking && <ParkingLot />}
    </>
  );
}

/** Parking lot: subjects set aside today, open topics of the next session */
function ParkingLot() {
  const t = useTranslations("control");
  const { s, rpc, nameOf, host } = useRonde();
  const [text, setText] = useState("");
  return (
    <section className="parking" aria-labelledby="parking-title">
      <h4 id="parking-title">🅿️ {t("parking.title")}</h4>
      <p className="hint">{t("parking.hint")}</p>
      {s.parking.map((x) => (
        <div className="item" key={x.id}>
          <div className="body">
            {x.text}
            <div className="meta">{nameOf(x.byId) || host}</div>
          </div>
          <button className="btn sm" onClick={() => rpc({ op: "parking.discuss", id: x.id }, t("parking.moved"))}>
            {t("parking.discuss")}
          </button>
          <button
            className="icon-btn"
            aria-label={t("parking.remove", { text: x.text })}
            onClick={() => rpc({ op: "topic.delete", id: x.id })}
          >
            ✕
          </button>
        </div>
      ))}
      <form
        className="controls"
        onSubmit={async (e) => {
          e.preventDefault();
          if (text.trim() && (await rpc({ op: "parking.add", text: text.trim() }, t("parking.added")))) setText("");
        }}
      >
        <input
          aria-label={t("parking.new")}
          value={text}
          maxLength={300}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("parking.placeholder")}
          style={{ flex: 1 }}
        />
        <button className="btn" type="submit" disabled={!text.trim()}>
          {t("parking.add")}
        </button>
      </form>
    </section>
  );
}

/** Early end (jump to the wrap-up) or cancelling the start, with confirmation */
function StopControls() {
  const t = useTranslations("control");
  const { s, rpc } = useRonde();
  const [ask, setAsk] = useState<null | "end" | "reset">(null);
  const m = s.meeting;
  if (!m?.startedAt) return null;
  if (ask)
    return (
      <div className="controls" role="group" aria-label={t("stop.confirmation")} data-tour="stop">
        <span style={{ flex: 1, minWidth: "14em", fontSize: 14.5 }}>{ask === "end" ? t("stop.endAsk") : t("stop.resetAsk")}</span>
        <button
          className="btn primary"
          onClick={async () => {
            const ok =
              ask === "end"
                ? await rpc({ op: "meeting.goto", key: "end" }, t("stop.ended"))
                : await rpc({ op: "meeting.reset" }, t("stop.reset"));
            if (ok) setAsk(null);
          }}
        >
          {ask === "end" ? t("stop.endYes") : t("stop.resetYes")}
        </button>
        <button className="btn" onClick={() => setAsk(null)}>
          {t("stop.no")}
        </button>
      </div>
    );
  return (
    <div className="controls" data-tour="stop">
      {m.stepKey !== "end" && (
        <button className="btn" onClick={() => setAsk("end")}>
          ■ {t("stop.end")}
        </button>
      )}
      <button className="linkbtn" onClick={() => setAsk("reset")}>
        {t("stop.cancelStart")}
      </button>
    </div>
  );
}

const MINUTES_OMIT_KEY = "ronde.minutes.omit";
/** Team inputs left out of the minutes: host preference, kept in this browser */
const readOmit = (): MinutesPart[] => {
  try {
    return parseOmit(localStorage.getItem(MINUTES_OMIT_KEY));
  } catch {
    return [];
  }
};
const writeOmit = (omit: MinutesPart[]) => {
  try {
    localStorage.setItem(MINUTES_OMIT_KEY, serializeOmit(omit));
  } catch {
    /* storage unavailable: the choice applies this time only */
  }
};

/** Summary before archiving: decisions, actions created, turns without notes (to complete here) */
function MinutesCheck() {
  const t = useTranslations("control");
  const tMinutes = useTranslations("minutes");
  const { s, agenda, members, host } = useRonde();
  const [open, setOpen] = useState<string | null>(null);
  const m = s.meeting!;
  const { decisions, created, silent } = minutesCheck(s, m.startedAt, agenda);
  return (
    <div className="minutes-check" role="status">
      <strong>{t("check.title")}</strong>
      <ul>
        <li className={decisions ? "ok" : ""}>{t("check.decisions", { count: decisions })}</li>
        <li className={created ? "ok" : ""}>{t("check.actions", { count: created })}</li>
        <li className={silent.length ? "" : "ok"}>
          {silent.length ? (
            <>
              {t("check.withoutNotes")}{" "}
              {silent.map((x, i) => (
                <span key={x.key}>
                  {i > 0 && ", "}
                  <button
                    type="button"
                    className="linkbtn"
                    onClick={() => setOpen(x.key)}
                    title={t("check.completeNotes", { name: first(x.label) })}
                  >
                    {first(x.label)}
                  </button>
                </span>
              ))}
            </>
          ) : (
            t("check.allNoted")
          )}
        </li>
      </ul>
      {silent.length > 0 && <span className="hint">{t("check.hint", { notes: tMinutes("hostNotes", { host }) })}</span>}
      {open && (
        <Modal onClose={() => setOpen(null)}>
          <NotesBox stepKey={open} label={first(members[open]?.name)} autoFocus />
          <div className="controls">
            <span className="sep" />
            <button className="btn" onClick={() => setOpen(null)}>
              {t("close")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PaneMinutes({ draft: saved, setDraft: setSaved }: { draft: MinutesDraft; setDraft: (d: MinutesDraft) => void }) {
  const t = useTranslations("control");
  const tParts = useTranslations("minutes");
  const { s, rpc, toast, api } = useRonde();
  const [confirm, setConfirm] = useState(false);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [record, setRecord] = useState<RecordV1 | null>(null);
  const [omit, setOmit] = useState<MinutesPart[]>(readOmit);
  const summary = saved?.summary ?? "";
  const atEnd = s.meeting?.stepKey === "end";

  // The generated part comes from the session as it stands: loaded on opening, then after the notes change
  const load = useCallback(async () => {
    setFailed(false);
    const r = await fetch(api("/draft"), { cache: "no-store" }).catch(() => null);
    if (r?.ok) setRecord(((await r.json()) as { record: RecordV1 }).record);
    else {
      // Shown in place: the pane never stays on "Generating…" forever
      setFailed(true);
      toast(t("minutesPane.generationFailed"));
    }
  }, [api, toast, t]);
  const notesSig = JSON.stringify(s.notes);
  useEffect(() => {
    const id = setTimeout(() => void load(), record ? 600 : 0);
    return () => clearTimeout(id);
  }, [notesSig, load]);

  const doc = useMemo(
    () => (record ? buildMinutes(record, s.settings.locale, { summary, omit }) : null),
    [record, summary, omit, s.settings.locale],
  );
  const choose = (next: MinutesPart[]) => {
    setOmit(next);
    writeOmit(next);
  };
  const userOnly = MINUTES_PARTS.every((p) => omit.includes(p));

  if (!doc)
    return failed ? (
      <div className="note-box" role="alert">
        {t("minutesPane.generationFailed")}{" "}
        <button type="button" className="btn" onClick={() => void load()}>
          {t("minutesPane.retry")}
        </button>
      </div>
    ) : (
      <p className="muted">{t("minutesPane.generating")}</p>
    );
  return (
    <>
      {atEnd && <MinutesCheck />}
      <p className="hint" style={{ marginBottom: 8 }}>
        {t("minutesPane.intro")}
      </p>
      <details className="minutes-parts" data-tour="minutes-parts">
        <summary>
          {t("minutesPane.content")}{" "}
          <strong>
            {omit.length === 0
              ? t("minutesPane.everything")
              : userOnly
                ? t("minutesPane.notesOnly")
                : t("minutesPane.partsOf", { count: MINUTES_PARTS.length - omit.length, total: MINUTES_PARTS.length })}
          </strong>
        </summary>
        <div className="minutes-parts-in">
          <div className="controls">
            <button type="button" className="btn soft" aria-pressed={userOnly} onClick={() => choose([...MINUTES_PARTS])}>
              {t("minutesPane.myNotesOnly")}
            </button>
            <button type="button" className="btn soft" aria-pressed={omit.length === 0} onClick={() => choose([])}>
              {t("minutesPane.includeAll")}
            </button>
          </div>
          <fieldset>
            <legend className="lbl-s">{t("minutesPane.teamInputs")}</legend>
            {MINUTES_PARTS.map((p) => (
              <label className="check" key={p}>
                <input
                  type="checkbox"
                  checked={!omit.includes(p)}
                  onChange={(e) => choose(e.target.checked ? omit.filter((k) => k !== p) : [...omit, p])}
                />{" "}
                {tParts(`parts.${p}`)}
              </label>
            ))}
          </fieldset>
          <span className="hint">{t("minutesPane.alwaysIncluded")}</span>
        </div>
      </details>
      {/* Visible title; the editor carries the accessible label itself */}
      <div className="lbl-s" aria-hidden="true">
        {tParts("summaryTitle")}
      </div>
      <MdEditor
        id="minutesSummary"
        label={tParts("summaryTitle")}
        placeholder={t("minutesPane.summaryPlaceholder")}
        className="minutes-area"
        value={summary}
        onChange={(v) => setSaved({ summary: v })}
      />
      <p className="hint">{t("minutesPane.summaryHint")}</p>
      <div className="controls" style={{ marginTop: 10 }}>
        <button type="button" className="btn" onClick={() => setPreview(true)}>
          {t("minutesPane.preview")}
        </button>
        <span className="sep" />
        {!atEnd ? (
          <span className="hint">{t("minutesPane.archiveAtEnd")}</span>
        ) : confirm ? (
          <>
            <span style={{ fontSize: 13 }}>{t("minutesPane.archiveAsk")}</span>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const ok = await rpc({ op: "meeting.archive", summary: summary.trim() || null, omit }, t("minutesPane.archived"));
                if (ok) track("session_archived");
                setBusy(false);
                if (ok) {
                  setConfirm(false);
                  setSaved(null);
                }
              }}
            >
              {t("minutesPane.archiveYes")}
            </button>
            <button type="button" className="btn" onClick={() => setConfirm(false)}>
              {t("cancel")}
            </button>
          </>
        ) : (
          <button type="button" className="btn primary" onClick={() => setConfirm(true)}>
            {t("minutesPane.archive")}
          </button>
        )}
      </div>
      {preview && (
        <Modal onClose={() => setPreview(false)}>
          <h2 style={{ marginTop: 0 }}>{doc.title}</h2>
          <MinutesView doc={doc} id="draft" />
          <div className="controls">
            <span className="sep" />
            <button type="button" className="btn" onClick={() => setPreview(false)}>
              {t("close")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** The project being presented: who speaks for it, and its health, which the host can set live */
function ProjectHost({ step }: { step: Step }) {
  const t = useTranslations("control");
  const { s, rpc, members, sections } = useRonde();
  const p = s.projects.find((x) => x.id === step.projectId);
  if (!p) return null;
  // Same people as on the stage: its members and whoever wrote about it, when they are marked absent
  const away = [...new Set([...p.memberIds, ...writersOf(s, p.id, sections)])].filter(
    (id) => members[id] && !step.speakers?.includes(id) && s.meeting?.absent.includes(id),
  );
  return (
    <div className="project-host">
      <p className="hint">
        {step.speakers?.length
          ? t("projectSpeakers", { names: step.speakers.map((id) => first(members[id]?.name)).join(", ") })
          : t("projectNoSpeaker")}
        {away.length > 0 && ` · ${t("projectAway", { names: away.map((id) => first(members[id]?.name)).join(", ") })}`}
      </p>
      <HealthPicker
        value={p.sheet?.health ?? p.health}
        onChange={(health) => rpc({ op: "project.sheet", projectId: p.id, health, live: true }, t("projectHealthSet"))}
      />
    </div>
  );
}

/** Order of the project round for this session: moved by hand, or drawn at random */
function ProjectOrder() {
  const t = useTranslations("control");
  const { s, agenda, rpc } = useRonde();
  // Projects nobody wrote about have no step (skipped): the host may present one anyway this session
  const { steps, ids, done, skipped, added, filled, showOrder } = projectOrderOf(s, agenda);
  const save = (order: string[]) => rpc({ op: "project.order", order });
  const move = (i: number, d: -1 | 1) => void save(moveProject(ids, i, d));
  const shuffle = () => void save(shuffleProjects(ids));
  if (!showOrder && !skipped.length) return null;
  return (
    <>
      {skipped.length > 0 && (
        <div className="project-skipped">
          <p className="hint">{t("projectsSkippedTitle", { count: skipped.length })}</p>
          <ul>
            {skipped.map((p) => (
              <li key={p.id}>
                <span className="grow">{p.name}</span>
                <button
                  type="button"
                  className="btn soft"
                  onClick={() => rpc({ op: "project.add", projectId: p.id, on: true }, t("projectAdded", { name: p.name }))}
                >
                  {t("presentAnyway")}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {showOrder && (
        <details className="project-order">
          <summary>{t("projectOrder")}</summary>
          <ol>
            {steps.map((x, i) => (
              <li key={x.key} className={done.has(x.key) ? "done" : ""}>
                <span className="grow">
                  {x.label}
                  {added.has(x.projectId!) && !filled.has(x.projectId!) && <span className="tag-added">{t("projectAddedTag")}</span>}
                </span>
                {added.has(x.projectId!) && !filled.has(x.projectId!) && !done.has(x.key) && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t("projectUnadd", { name: x.label })}
                    title={t("projectUnadd", { name: x.label })}
                    onClick={() => rpc({ op: "project.add", projectId: x.projectId!, on: false })}
                  >
                    ×
                  </button>
                )}
                <button
                  type="button"
                  className="icon-btn"
                  // A project never moves above the step running or already done: it would be skipped
                  disabled={!canMove(steps, done, i, -1)}
                  aria-label={t("projectUp", { name: x.label })}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={!canMove(steps, done, i, 1)}
                  aria-label={t("projectDown", { name: x.label })}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
              </li>
            ))}
          </ol>
          <div className="controls">
            <button type="button" className="btn" onClick={shuffle} disabled={steps.some((x) => done.has(x.key))}>
              <Icon name="shuffle" size={15} /> {t("projectShuffle")}
            </button>
            {s.meeting?.projectOrder.length ? (
              <button type="button" className="linkbtn" onClick={() => void save([])}>
                {t("projectOrderReset")}
              </button>
            ) : null}
          </div>
        </details>
      )}
    </>
  );
}

/** One line in the main column: how many sheets need someone, opening the "Sheets" tab */
function SheetsSummary({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations("control");
  const { s, sections } = useRonde();
  if (!s.projects.length) return null;
  const todo = sheetsToComplete(s, sections);
  return (
    <button type="button" className="sheets-summary" onClick={onOpen}>
      <span>{t("sheets.title")}</span>
      <span className={"pill " + (todo ? "warn" : "ok")}>{todo ? t("sheets.todo", { count: todo }) : t("sheets.allDone")}</span>
      <span className="go" aria-hidden="true">
        →
      </span>
    </button>
  );
}

/**
 * The project sheets, one line each however many there are: what each still needs (health, message of the
 * day, who has not written); the ones to complete by default, all of them on demand, a search past a dozen
 */
function PaneSheets() {
  const t = useTranslations("control");
  const { s, sections, nameOf } = useRonde();
  const [all, setAll] = useState(false);
  const [q, setQ] = useState("");
  const rows = sheetRows(s, sections, nameOf, t);
  const todo = rows.filter((r) => !r.complete).length;
  const needle = q.trim().toLowerCase();
  const shown = rows
    .filter((r) => (all || !r.complete) && (!needle || r.p.name.toLowerCase().includes(needle)))
    .sort((a, b) => Number(a.complete) - Number(b.complete) || b.missing.length - a.missing.length || a.p.position - b.p.position);
  return (
    <div className="pane-sheets">
      <div className="controls">
        <span className={"pill " + (todo ? "warn" : "ok")}>{todo ? t("sheets.todo", { count: todo }) : t("sheets.allDone")}</span>
        <label className="check">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {t("sheets.showAll", { count: rows.length })}
        </label>
      </div>
      {rows.length > 12 && (
        <input
          type="search"
          className="sheets-search"
          aria-label={t("sheets.search")}
          placeholder={t("sheets.search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      )}
      {shown.length ? (
        <ul className="sheets-list">
          {shown.map(({ p, missing, lines, complete }) => (
            <li key={p.id} className={complete ? "complete" : "incomplete"}>
              <span className="mark" aria-hidden="true">
                {complete ? "✓" : "○"}
              </span>
              <span className="name">{p.name}</span>
              <span className="what" title={lines.map((x) => `${nameOf(x.id)} · ${t("sheets.lines", { count: x.n })}`).join("\n")}>
                {complete ? t("sheets.complete") : t("sheets.missing", { what: missing.join(", ") })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{todo ? t("sheets.noMatch") : t("sheets.allDoneHint")}</p>
      )}
    </div>
  );
}
