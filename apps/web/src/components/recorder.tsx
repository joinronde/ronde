"use client";

import { Modal } from "@ronde/ui/modal";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRonde } from "./ronde-provider";

// Transcript of the session (Team): the control room records the room's microphone or the call's tab, in
// pieces of about thirty seconds that each stand alone; each piece goes with the steps it covers, so every
// passage goes to the person whose turn it was.

const PIECE_MS = 30_000;
const TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

type Source = "mic" | "tab";

/** Banner seen by everyone while the session is recorded */
export function RecordingBanner({ withOptOut = false }: { withOptOut?: boolean }) {
  const t = useTranslations("transcript");
  const { s, rpc } = useRonde();
  const tr = s.transcription;
  if (!tr?.recording) return null;
  return (
    <div className="rec-banner" role="status">
      <span className="rec-dot" aria-hidden="true" />
      <span>{tr.recording.by ? t("recordingBy", { name: tr.recording.by }) : t("recording")}</span>
      {withOptOut && s.viewer.memberId && (
        <label className="rec-optout">
          <input type="checkbox" checked={tr.optedOut} onChange={(e) => void rpc({ op: "transcript.optOut", out: e.target.checked })} />{" "}
          {t("optOut")}
        </label>
      )}
    </div>
  );
}

/** The control room's record button, and the recording itself */
export function Recorder() {
  const t = useTranslations("transcript");
  const { s, rpc, api, toast } = useRonde();
  const titleId = useId();
  const [asking, setAsking] = useState(false);
  const [source, setSource] = useState<Source>("mic");
  const [active, setActive] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const running = useRef(false);
  const steps = useRef<{ at: number; key: string }[]>([]);
  const stepKey = useRef(s.meeting?.stepKey ?? "intro");
  const tr = s.transcription;

  // Every change of step is noted with its time: it tells who spoke
  useEffect(() => {
    const key = s.meeting?.stepKey ?? "intro";
    if (key !== stepKey.current) {
      stepKey.current = key;
      if (running.current) steps.current.push({ at: Date.now(), key });
    }
  }, [s.meeting?.stepKey]);

  const upload = useCallback(
    async (blob: Blob, start: number, end: number, timeline: { at: number; key: string }[]) => {
      if (!blob.size) return;
      try {
        await fetch(api("/audio"), {
          method: "POST",
          headers: {
            "content-type": blob.type.split(";")[0] || "audio/webm",
            "x-ronde-start": String(start),
            "x-ronde-end": String(end),
            "x-ronde-steps": JSON.stringify(timeline.slice(-200)),
          },
          body: blob,
        });
      } catch {}
    },
    [api],
  );

  const piece = useCallback(() => {
    const audio = stream.current;
    if (!audio || !running.current) return;
    const type = TYPES.find((x) => MediaRecorder.isTypeSupported(x)) ?? "";
    const rec = new MediaRecorder(audio, type ? { mimeType: type } : undefined);
    const parts: Blob[] = [];
    const start = Date.now();
    steps.current = [{ at: start, key: stepKey.current }];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec.onstop = () => {
      void upload(new Blob(parts, { type: rec.mimeType || type }), start, Date.now(), steps.current);
      // The next piece starts at once: each one stands alone for the speech-to-text service
      if (running.current) piece();
    };
    rec.start();
    recorder.current = rec;
    timer.current = setTimeout(() => rec.state === "recording" && rec.stop(), PIECE_MS);
  }, [upload]);

  const halt = useCallback(() => {
    running.current = false;
    if (timer.current) clearTimeout(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    setActive(false);
  }, []);

  const begin = async () => {
    setAsking(false);
    if (typeof MediaRecorder === "undefined") return toast(t("unsupported"));
    let media: MediaStream;
    try {
      if (source === "mic")
        media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      else {
        const shared = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        for (const v of shared.getVideoTracks()) v.stop();
        media = new MediaStream(shared.getAudioTracks());
      }
    } catch {
      return toast(t("denied"));
    }
    if (!media.getAudioTracks().length) return toast(t("noSound"));
    if (!(await rpc({ op: "recording.start" }))) {
      for (const track of media.getTracks()) track.stop();
      return;
    }
    stream.current = media;
    // The person stops sharing: the recording ends
    for (const track of media.getAudioTracks()) track.onended = () => void stop();
    running.current = true;
    setActive(true);
    piece();
  };
  const stop = async () => {
    halt();
    await rpc({ op: "recording.stop" });
  };

  // Stopped from another browser, or the meeting no longer allows it
  useEffect(() => {
    if (active && !tr?.recording) halt();
  }, [active, tr?.recording, halt]);
  useEffect(() => () => halt(), [halt]);

  if (!tr?.ready || !s.viewer.isHost) return null;
  return (
    <>
      {active ? (
        <button type="button" className="btn sm rec-btn on" onClick={() => void stop()} title={t("stop")}>
          <span className="rec-dot" aria-hidden="true" /> {t("stopShort")}
        </button>
      ) : (
        <button
          type="button"
          className="btn ghost sm rec-btn"
          onClick={() => setAsking(true)}
          disabled={!!tr.recording}
          title={t("record")}
        >
          <span className="rec-dot idle" aria-hidden="true" /> <span className="hide-sm">{t("recordShort")}</span>
        </button>
      )}
      {asking && (
        <Modal onClose={() => setAsking(false)} labelledBy={titleId}>
          <h3 id={titleId}>{t("consentTitle")}</h3>
          <p>{t("consent")}</p>
          <fieldset className="plain stack">
            <legend className="lbl-s">{t("source")}</legend>
            <label className="check">
              <input type="radio" name="recSource" checked={source === "mic"} onChange={() => setSource("mic")} /> {t("sourceMic")}
            </label>
            <label className="check">
              <input type="radio" name="recSource" checked={source === "tab"} onChange={() => setSource("tab")} /> {t("sourceTab")}
            </label>
            {source === "tab" && <p className="hint">{t("sourceTabHint")}</p>}
          </fieldset>
          <div className="controls">
            <span className="sep" />
            <button type="button" className="btn" onClick={() => setAsking(false)}>
              {t("cancel")}
            </button>
            <button type="button" className="btn primary" onClick={() => void begin()}>
              {t("start")}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
