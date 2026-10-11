"use client";

import { AMBIENCES } from "@ronde/core/ambience";
import { first } from "@ronde/core/util";
import { motionAllowed } from "@ronde/ui/effects";
import { Logo } from "@ronde/ui/logo";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Select } from "@/components/select";
import { withBasePath } from "@/lib/shared/base-path";
import { AMBIENCE_KEY, readAmbienceChoice } from "./ambience";
import { NoMeeting } from "./common";
import { RecordingBanner } from "./recorder";
import { useRonde } from "./ronde-provider";
import { RoundTable } from "./roundtable";
import { SharedScreen } from "./screen-share";
import { SoundPlayer } from "./sound-player";
import { Stage, Strip } from "./stage";

type Theme = "auto" | "light" | "dark";

const load = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const save = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
};

/** Projection tab, to share in the video call */
export function ScreenView() {
  const t = useTranslations("screen");
  const tPages = useTranslations("pages");
  const tAmbience = useTranslations("ambience");
  const { s, mod } = useRonde();
  const [menu, setMenu] = useState(false);
  const [theme, setTheme] = useState<Theme>("auto");
  const [calm, setCalm] = useState(false);
  const [replay, setReplay] = useState(0);
  const [ambience, setAmbience] = useState("auto");

  useEffect(() => {
    const saved = load("ronde.screenTheme") as Theme | null;
    if (saved) setTheme(saved);
    setCalm(load("ronde.calm") === "1");
    setAmbience(readAmbienceChoice());
  }, []);
  useEffect(() => {
    document.body.classList.toggle("th-dark", theme === "dark");
    document.body.classList.toggle("th-light", theme === "light");
    save("ronde.screenTheme", theme);
  }, [theme]);
  // Reactions and kudos (rendered outside the page) bigger on the shared screen
  useEffect(() => {
    document.body.classList.add("screen-mode");
    return () => document.body.classList.remove("screen-mode");
  }, []);
  useEffect(() => {
    document.body.classList.toggle("calm", calm);
    save("ronde.calm", calm ? "1" : "0");
  }, [calm]);

  // Tell the control room (same browser) that the projection tab is open
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("ronde");
    } catch {
      return;
    }
    const ping = () => bc?.postMessage({ t: "live-here" });
    ping();
    const timer = setInterval(ping, 2000);
    return () => {
      clearInterval(timer);
      bc?.close();
    };
  }, []);

  useEffect(() => {
    document.title = `${tPages("screen")} · ${s.settings.teamName}`;
  }, [s.settings.teamName, tPages]);

  return (
    <div className="screen-page">
      {s.meeting ? (
        <div className="screen-stage">
          <Stage stepKey={s.meeting.stepKey} replay={replay} celebrate logo={s.brand.logo && withBasePath(s.brand.logo)} />
          {/* The steps, then (without a workspace logo, which sits in the stage) a discreet mention of Ronde:
              in the flow, never over the stage */}
          <div className="screen-foot">
            <Strip />
            {!s.brand.logo && (
              <div className="screen-brand">
                <Logo />
                <span>{t("poweredBy")}</span>
              </div>
            )}
          </div>
          <Handover />
        </div>
      ) : (
        <NoMeeting />
      )}
      <SoundPlayer where="screen" />
      <SharedScreen />
      <div className="screen-rec">
        <RecordingBanner />
      </div>
      <div className="screen-menu">
        <button className="btn" aria-expanded={menu} aria-label={t("options")} onClick={() => setMenu(!menu)}>
          ⋯
        </button>
        {menu && (
          <div className="pop">
            <div className="lbl-s">{t("theme")}</div>
            <div className="seg">
              {(["auto", "light", "dark"] as Theme[]).map((v) => (
                <button key={v} aria-pressed={theme === v} onClick={() => setTheme(v)}>
                  {t(`themes.${v}`)}
                </button>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={calm} onChange={(e) => setCalm(e.target.checked)} /> {t("reducedMotion")}
            </label>
            {mod("ambience") && (
              <>
                <label className="lbl-s" htmlFor="kAmb">
                  {t("ambience")}
                </label>
                <Select
                  id="kAmb"
                  value={ambience}
                  onChange={(e) => {
                    setAmbience(e.target.value);
                    save(AMBIENCE_KEY, e.target.value);
                    window.dispatchEvent(new Event("ronde-ambience"));
                  }}
                >
                  <option value="auto">{tAmbience("names.auto")}</option>
                  <option value="off">{tAmbience("names.off")}</option>
                  <optgroup label={t("previewTheme")}>
                    {AMBIENCES.map((a) => (
                      <option key={a.key} value={a.key}>
                        {a.particles[0]} {tAmbience(a.key as "birthday")}
                      </option>
                    ))}
                  </optgroup>
                </Select>
              </>
            )}
            {s.meeting?.stepKey === "intro" && (
              <button
                className="btn"
                onClick={() => {
                  setReplay((r) => r + 1);
                  setMenu(false);
                }}
              >
                {t("replayIntro")}
              </button>
            )}
            <button
              className="btn"
              onClick={() => {
                document.documentElement.requestFullscreen?.().catch(() => undefined);
                setMenu(false);
              }}
            >
              {t("fullscreen")}
            </button>
            <p className="hint">{t("drivenFromControl")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** "Your turn, Alex!": the arc grows round the table from the last speaker to the person taking the floor */
function Handover() {
  const t = useTranslations("screen");
  const { s, agenda } = useRonde();
  const stepKey = s.meeting?.stepKey;
  const prevSpeaker = useRef<string | null>(null);
  const prevKey = useRef(stepKey);
  const [show, setShow] = useState<{ from: string | null; to: string; n: number } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const ids = agenda.filter((x) => x.type === "speaker").map((x) => x.id!);

  useEffect(() => {
    if (stepKey === prevKey.current) return;
    prevKey.current = stepKey;
    const step = agenda.find((x) => x.key === stepKey);
    if (step?.type !== "speaker" || !motionAllowed()) {
      if (step?.type === "speaker") prevSpeaker.current = step.id!;
      setShow(null);
      return;
    }
    const from = prevSpeaker.current;
    prevSpeaker.current = step.id!;
    setShow({ from, to: step.id!, n: Date.now() });
    setFocus(from ?? ids[0] ?? null);
    const t1 = setTimeout(() => setFocus(step.id!), 80);
    const t2 = setTimeout(() => setShow(null), 2600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  if (!show) return null;
  return (
    <div className="handover" key={show.n} aria-hidden="true">
      <div className="inner">
        <RoundTable ids={ids} focusId={focus} names={false} />
        <h2>
          {t.rich("yourTurn", { name: first(s.members.find((m) => m.id === show.to)?.name), span: (chunks) => <span>{chunks}</span> })}
        </h2>
      </div>
    </div>
  );
}
