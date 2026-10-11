"use client";

import { birthdaysAround } from "@ronde/core/ambience";
import { spentOf } from "@ronde/core/meeting";
import type { SoundKey, SoundOutput } from "@ronde/core/sound";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useRonde, useTick } from "./ronde-provider";
import { Icon } from "./shell/icons";
import { getSynth } from "./synth";

/**
 * Personal setting, kept in this browser: on by default for the host and the admin, on "My screen" as in the
 * control room (monitoring, to hear what participants hear); everyone can turn it off.
 * For participants, see `AUTO_BEFORE`.
 */
const PREFS = {
  me: { on: "ronde.sound.on", vol: "ronde.sound.vol", defaultOn: true },
  control: { on: "ronde.sound.control.on", vol: "ronde.sound.control.vol", defaultOn: true },
};
/** Waiting music in the control room: off by default (it gets tiring while preparing), cues stay */
const CONTROL_MUSIC = "ronde.sound.control.music";
/**
 * Participants: sounds off by default, turned on by themselves a quarter of an hour before the planned time
 * (no waiting music all day long in a tab left open). Turning them off applies to this meeting only.
 */
const AUTO_BEFORE = 15 * 60_000;
/** Meeting never started (date to update): sounds do not stay on forever */
const AUTO_AFTER = 2 * 3_600_000;
/** Participant: date of the meeting for which sounds were turned off */
const PARTICIPANT_OFF = "ronde.sound.off";
/** Control-room monitoring turned on in this browser (on by default) */
export const controlMonitorOn = () => load(PREFS.control.on) !== "0";

const load = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const store = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
};

/** Planned start date and time of the meeting */
function startAt(date: string, time: string) {
  const [h, min] = time.split(":").map(Number);
  return new Date(date + "T00:00:00").setHours(h ?? 14, min ?? 0, 0, 0);
}

/**
 * Meeting sounds: waiting music, meeting cues and the control-room soundboard.
 * Played where the host picked: on everyone's "My screen" (`where="participants"`), who can turn them off,
 * or on the shared screen (`where="screen"`). The browser only allows sound after a gesture.
 * `control`: host monitoring in the control room, when sounds play on "My screen".
 */
/** Sound player of a page; nothing at all when the meeting has the sounds module off */
export function SoundPlayer(props: { where: SoundOutput; control?: boolean }) {
  const { mod } = useRonde();
  return mod("sounds") ? <ActiveSoundPlayer {...props} /> : null;
}

function ActiveSoundPlayer({ where, control }: { where: SoundOutput; control?: boolean }) {
  const t = useTranslations("soundPlayer");
  const { s, agenda, now, hydrated } = useRonde();
  const cfg = s.settings.sound;
  const m = s.meeting;
  const synth = getSynth();
  const mine = where === "participants";
  const prefs = PREFS[control ? "control" : "me"];
  const [ready, setReady] = useState(false);
  // On "My screen" or in the control room, everyone picks; the shared screen follows the control room
  const [myOn, setMyOn] = useState(!mine);
  // Participant: choice made on this page, otherwise the setting follows the meeting time
  const auto = mine && !control && !s.viewer.isHost && !s.viewer.isAdmin;
  const [picked, setPicked] = useState<boolean | null>(null);
  const toStart = m ? (m.plannedAt ?? startAt(m.date, m.time)) - now() : Infinity;
  const near = auto && hydrated && !!m && (!!m.startedAt || (toStart <= AUTO_BEFORE && toStart > -AUTO_AFTER));
  useTick(auto && !near ? 30_000 : 3_600_000);
  // Entering the last quarter of an hour: the page goes back to the automatic setting
  useEffect(() => setPicked(null), [near]);
  const [myVol, setMyVol] = useState(70);
  const [controlMusic, setControlMusic] = useState(false);
  useEffect(() => {
    if (control) setControlMusic(load(CONTROL_MUSIC) === "1");
  }, [control]);
  useEffect(() => {
    if (!mine) return;
    if (auto) {
      setMyOn(picked ?? (near && load(PARTICIPANT_OFF) !== m?.date));
    } else {
      const on = load(prefs.on);
      setMyOn(on === null ? prefs.defaultOn : on === "1");
    }
    const v = Number(load(prefs.vol));
    if (v >= 0 && v <= 100 && load(prefs.vol) !== null) setMyVol(v);
  }, [mine, prefs, auto, picked, near, m?.date]);
  const active = cfg.enabled && cfg.output === where && myOn;

  // A browser that already knows the site may allow sound right away; otherwise, first click or key
  useEffect(() => {
    if (!active) return;
    void synth.unlock().then(setReady);
    const onGesture = () => void synth.unlock().then(setReady);
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
  }, [synth, active]);

  const level = active ? (cfg.volume / 100) * (mine ? myVol / 100 : 1) : 0;
  useEffect(() => synth.setVolume(level), [synth, level, ready]);

  // Waiting music: waiting screen only, it fades out at the start
  const music = ready && active && cfg.music && (!control || controlMusic) && !!m && m.stepKey === "intro" && !m.startedAt;
  // Server time, always up to date (the clock offset gets refined after load)
  const nowRef = useRef(now);
  nowRef.current = now;
  useEffect(() => {
    // Every screen plays the music at the same position
    if (music) synth.startMusic(cfg.musicStyle, () => nowRef.current());
    else synth.stopMusic();
  }, [synth, music, cfg.musicStyle]);
  useEffect(() => () => synth.stopMusic(0.3), [synth]);

  const play = (k: SoundKey) => {
    if (ready && active) synth.play(k);
  };
  const playRef = useRef(play);
  playRef.current = play;

  // Meeting cues, on the changes this screen sees (not on page load)
  const prev = useRef({ date: m?.date, started: !!m?.startedAt, step: m?.stepKey });
  useEffect(() => {
    const p = prev.current;
    prev.current = { date: m?.date, started: !!m?.startedAt, step: m?.stepKey };
    if (!m || p.date !== m.date) return;
    if (!p.started && m.startedAt) {
      if (cfg.cues.start) play("start");
      // Birthday week (same people as on the waiting screen): the song follows the chime
      const party = birthdaysAround(
        s.members.filter((x) => x.active),
        new Date(now()),
      );
      // No cancellation: a "Next" right after the start does not cut the song
      if (cfg.cues.birthday && party.length) setTimeout(() => playRef.current("birthday"), cfg.cues.start ? 1800 : 0);
    } else if (p.step !== m.stepKey) {
      const type = agenda.find((x) => x.key === m.stepKey)?.type;
      if (type === "end" && cfg.cues.end) play("applause");
      else if ((type === "speaker" || type === "project") && cfg.cues.speaker) play("speaker");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m?.date, m?.startedAt, m?.stepKey]);

  // End of speaking time: once per turn (and again after a +30 s)
  const speaking = active && !!m && m.timer.running && s.members.some((x) => x.id === m.stepKey);
  useTick(speaking && cfg.cues.timeUp ? 500 : 60_000);
  const lastUp = useRef("");
  if (speaking && cfg.cues.timeUp) {
    const rem = s.settings.speakSec * 1000 + (m.bonus[m.stepKey] ?? 0) - spentOf(m, m.stepKey, now());
    const tag = m.date + m.stepKey + ":" + (m.bonus[m.stepKey] ?? 0);
    if (rem <= 0 && rem > -2000 && lastUp.current !== tag) {
      lastUp.current = tag;
      play("timeUp");
    }
  }

  // Control-room soundboard
  useEffect(() => {
    const onSound = (e: Event) => playRef.current((e as CustomEvent<SoundKey>).detail);
    window.addEventListener("ronde-sound", onSound);
    return () => window.removeEventListener("ronde-sound", onSound);
  }, []);

  if (!cfg.enabled || cfg.output !== where) return null;
  if (!mine)
    return ready ? null : (
      <button className="btn sound-unlock" onClick={() => void synth.unlock().then(setReady)}>
        <Icon name="volume" size={16} />
        {t("enable")}
      </button>
    );
  return (
    <span className={control ? "my-sound control" : "my-sound"}>
      <button
        type="button"
        aria-pressed={myOn}
        title={control ? t("monitorHint") : myOn ? t("muteHint") : auto && !near ? t("autoHint") : t("listenHint")}
        onClick={() => {
          const on = !myOn;
          setMyOn(on);
          if (auto) {
            setPicked(on);
            // Turned off for this meeting: not turned back on when the page reloads
            if (near) store(PARTICIPANT_OFF, on ? "" : (m?.date ?? ""));
          } else store(prefs.on, on ? "1" : "0");
          // The click counts as the browser permission
          if (on) void synth.unlock().then(setReady);
        }}
      >
        <Icon name={control ? "headphones" : myOn ? "volume" : "mute"} size={15} />
        {control ? (myOn ? t("monitorOn") : t("monitorOff")) : myOn ? t("soundsOn") : t("soundsOff")}
      </button>
      {myOn && (
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={myVol}
          aria-label={control ? t("monitorVolume") : t("volume")}
          onChange={(e) => {
            setMyVol(Number(e.target.value));
            store(prefs.vol, e.target.value);
          }}
        />
      )}
      {control && myOn && cfg.music && (
        <button
          type="button"
          className="snd-mus"
          aria-pressed={controlMusic}
          title={controlMusic ? t("musicMuteHint") : t("musicListenHint")}
          onClick={() => {
            setControlMusic(!controlMusic);
            store(CONTROL_MUSIC, controlMusic ? "0" : "1");
          }}
        >
          <Icon name="music" size={14} />
          {controlMusic ? t("musicOn") : t("musicOff")}
        </button>
      )}
      {/* Sound is only allowed after a gesture: say so until it is */}
      {myOn && !ready && (
        <button type="button" className="linkbtn" onClick={() => void synth.unlock().then(setReady)}>
          {t("allow")}
        </button>
      )}
    </span>
  );
}
