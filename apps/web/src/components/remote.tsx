"use client";

import { first } from "@ronde/core/util";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useRonde } from "./ronde-provider";
import { Timer, UpCount } from "./stage";

/** The control room on a phone: big buttons to move on, pause and give extra time */
export function RemoteView() {
  const t = useTranslations("remote");
  const tStage = useTranslations("stage");
  const { s, agenda, cur, rpc, connected } = useRonde();
  const m = s.meeting;
  const step = m ? agenda[cur] : undefined;
  const next = agenda[cur + 1];
  const started = !!m?.startedAt;

  // The screen stays on while the remote is open (where the browser allows it)
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } };
    const take = () => {
      if (document.visibilityState === "visible")
        nav.wakeLock
          ?.request("screen")
          .then((l) => {
            lock = l;
          })
          .catch(() => undefined);
    };
    take();
    document.addEventListener("visibilitychange", take);
    return () => {
      document.removeEventListener("visibilitychange", take);
      void lock?.release().catch(() => undefined);
    };
  }, []);

  const press = (op: Parameters<typeof rpc>[0]) => {
    navigator.vibrate?.(15);
    void rpc(op);
  };

  if (!m || !step)
    return (
      <main id="main" className="remote">
        <p className="remote-empty">{t("noMeeting")}</p>
        <Link href={`${s.context.path}/control`} className="btn">
          {t("back")}
        </Link>
      </main>
    );
  const title =
    step.type === "speaker" || step.type === "block" || step.type === "project"
      ? step.label
      : step.type === "qa"
        ? tStage("qaTitle")
        : tStage(`stepTitles.${step.type}`);
  return (
    <main id="main" className="remote">
      <header className="remote-head">
        <span className={`remote-dot ${connected ? "ok" : ""}`} aria-hidden="true" />
        <span className="remote-team">{s.settings.teamName}</span>
        <Link href={`${s.context.path}/control`} className="remote-back">
          {t("back")}
        </Link>
      </header>
      <section className="remote-now" aria-live="polite">
        <div className="eyebrow">{t("now")}</div>
        <h1>{title}</h1>
        <div className="remote-timer">
          {step.type === "speaker" || step.type === "project" ? (
            <Timer stepKey={step.key} live />
          ) : step.type !== "end" ? (
            <UpCount className="upcount" />
          ) : null}
        </div>
        <p className="remote-next">{next ? t("then", { next: next.type === "speaker" ? first(next.label) : next.label }) : t("last")}</p>
      </section>
      {!started ? (
        <div className="remote-pad">
          <button type="button" className="btn primary remote-big" onClick={() => press({ op: "meeting.togglePlay" })}>
            ▶ {t("start")}
          </button>
        </div>
      ) : (
        <div className="remote-pad">
          <button
            type="button"
            className="btn remote-big"
            disabled={cur <= 0}
            onClick={() => press({ op: "meeting.step", delta: -1, from: m?.stepKey })}
          >
            ← {t("previous")}
          </button>
          <button
            type="button"
            className="btn primary remote-big"
            disabled={!next}
            onClick={() => press({ op: "meeting.step", delta: 1, from: m?.stepKey })}
          >
            {t("next")} →
          </button>
          <button type="button" className="btn remote-mid" onClick={() => press({ op: "meeting.togglePlay" })}>
            {m.timer.running ? `⏸ ${t("pause")}` : `▶ ${t("resume")}`}
          </button>
          <button type="button" className="btn remote-mid" disabled={step.type === "end"} onClick={() => press({ op: "meeting.bonus" })}>
            {t("bonus")}
          </button>
        </div>
      )}
    </main>
  );
}
