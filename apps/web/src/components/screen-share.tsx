"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRonde } from "./ronde-provider";
import { Icon } from "./shell/icons";

// Screen sharing to the room: the host's tab sends its screen straight to the shared screen tabs (WebRTC,
// no media server); the meeting's event stream only carries the handshake.

type Signal = { to: string; from: string; type: "share" | "stop" | "hello" | "offer" | "answer" | "ice"; data: unknown };

function useSignals(handler: (s: Signal) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const on = (e: Event) => ref.current((e as CustomEvent<Signal>).detail);
    window.addEventListener("ronde-signal", on);
    return () => window.removeEventListener("ronde-signal", on);
  }, []);
}

// The screen being shared from this tab, for the control room's preview: the room screens show it, so the
// preview shows it too
let shared: { stream: MediaStream; screens: number } | null = null;
const watchers = new Set<() => void>();
function setShared(next: typeof shared) {
  shared = next;
  for (const w of watchers) w();
}
const watch = (w: () => void) => {
  watchers.add(w);
  return () => watchers.delete(w);
};

/** Over the control room's preview: the shared screen, as the room sees it */
export function SharePreview() {
  const t = useTranslations("screenShare");
  const current = useSyncExternalStore(
    watch,
    () => shared,
    () => null,
  );
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current && current) {
      video.current.srcObject = current.stream;
      void video.current.play().catch(() => {});
    }
  }, [current]);
  if (!current) return null;
  return (
    <div className="share-preview">
      <video ref={video} autoPlay muted playsInline />
      <span className="share-preview-badge">
        <span className="share-dot" aria-hidden="true" /> {t("previewBadge", { count: current.screens })}
      </span>
    </div>
  );
}

/** The control room's button: shares the host's screen (a window, a tab, the whole screen) on the room screen */
export function ShareScreenButton() {
  const t = useTranslations("screenShare");
  const { s, signal, toast } = useRonde();
  const [sharing, setSharing] = useState(false);
  const [screens, setScreens] = useState(0);
  const stream = useRef<MediaStream | null>(null);
  const peers = useRef(new Map<string, RTCPeerConnection>());
  /** Number of the last offer to each screen: an answer only counts for the offer it answers */
  const offers = useRef(new Map<string, number>());
  const offerCount = useRef(0);
  const signalRef = useRef(signal);
  signalRef.current = signal;

  const count = () => {
    const n = [...peers.current.values()].filter((p) => p.connectionState === "connected").length;
    setScreens(n);
    if (stream.current) setShared({ stream: stream.current, screens: n });
  };

  const connect = useCallback(
    async (screenId: string) => {
      const media = stream.current;
      if (!media) return;
      // A screen says hello twice (stream opened, then the announcement): one connection is enough
      const existing = peers.current.get(screenId);
      if (existing && ["new", "connecting", "connected"].includes(existing.connectionState)) return;
      existing?.close();
      const pc = new RTCPeerConnection({ iceServers: s.iceServers });
      peers.current.set(screenId, pc);
      for (const track of media.getTracks()) pc.addTrack(track, media);
      pc.onicecandidate = (e) => e.candidate && void signalRef.current(screenId, "ice", e.candidate.toJSON());
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") peers.current.delete(screenId);
        count();
      };
      await pc.setLocalDescription(await pc.createOffer());
      const n = ++offerCount.current;
      offers.current.set(screenId, n);
      await signalRef.current(screenId, "offer", { n, sdp: pc.localDescription?.toJSON() });
    },
    [s.iceServers],
  );

  const stop = useCallback(() => {
    for (const pc of peers.current.values()) pc.close();
    peers.current.clear();
    offers.current.clear();
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    setShared(null);
    setSharing(false);
    setScreens(0);
    void signalRef.current("*", "stop");
  }, []);

  useSignals((sig) => {
    if (!stream.current) return;
    if (sig.type === "hello") void connect(sig.from);
    else if (sig.type === "answer") {
      const answer = sig.data as { n: number; sdp: RTCSessionDescriptionInit };
      const pc = peers.current.get(sig.from);
      if (pc && answer.n === offers.current.get(sig.from) && pc.signalingState === "have-local-offer")
        void pc.setRemoteDescription(answer.sdp).catch(() => {});
    } else if (sig.type === "ice")
      void peers.current
        .get(sig.from)
        ?.addIceCandidate(sig.data as RTCIceCandidateInit)
        .catch(() => {});
  });
  // Leaving the control room ends the share
  useEffect(
    () => () => {
      if (stream.current) stop();
    },
    [stop],
  );

  const start = async () => {
    try {
      const media = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: true });
      stream.current = media;
      setShared({ stream: media, screens: 0 });
      // Sharing stopped from the browser's own bar
      for (const track of media.getVideoTracks()) track.onended = stop;
      setSharing(true);
      // The open screens answer "hello", each gets its own connection
      await signal("*", "share", { by: s.viewer.name });
    } catch {
      toast(t("denied"));
    }
  };

  if (!s.viewer.isHost || typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) return null;
  return sharing ? (
    <button type="button" className="btn sm share-btn on" onClick={stop} title={t("stop")}>
      <span className="share-dot" aria-hidden="true" /> <span className="hide-sm">{t("stopShort")}</span>
      <span className="share-count" aria-label={t("screens", { count: screens })}>
        {screens}
      </span>
    </button>
  ) : (
    <button type="button" className="btn ghost sm share-btn" onClick={() => void start()} title={t("start")}>
      <Icon name="screen" size={16} />
      <span className="hide-sm">{t("startShort")}</span>
    </button>
  );
}

/** On the shared screen: the host's screen, over the stage, while it is shared */
export function SharedScreen() {
  const t = useTranslations("screenShare");
  const { s, signal, connected } = useRonde();
  const [by, setBy] = useState<string | null>(null);
  // Browsers only play a video by themselves when it is muted: the sound comes on with a click
  const [muted, setMuted] = useState(true);
  const [hasSound, setHasSound] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const pc = useRef<RTCPeerConnection | null>(null);
  const host = useRef<string | null>(null);
  const pending = useRef<RTCIceCandidateInit[]>([]);
  const signalRef = useRef(signal);
  signalRef.current = signal;

  const close = useCallback(() => {
    pc.current?.close();
    pc.current = null;
    host.current = null;
    pending.current = [];
    setBy(null);
    setHasSound(false);
    setMuted(true);
  }, []);

  // A share may already be going on: say hello once the event stream is open (and again after a reconnection)
  useEffect(() => {
    if (connected) void signalRef.current("*", "hello");
  }, [connected]);
  useEffect(() => close, [close]);

  useSignals((sig) => {
    if (sig.type === "share") {
      setBy((sig.data as { by?: string } | null)?.by ?? "");
      void signalRef.current(sig.from, "hello");
    } else if (sig.type === "stop") {
      if (!host.current || host.current === sig.from) close();
    } else if (sig.type === "offer") {
      const offer = sig.data as { n: number; sdp: RTCSessionDescriptionInit };
      void (async () => {
        pc.current?.close();
        const conn = new RTCPeerConnection({ iceServers: s.iceServers });
        pc.current = conn;
        host.current = sig.from;
        conn.ontrack = (e) => {
          const media = e.streams[0];
          if (video.current && media) {
            video.current.srcObject = media;
            void video.current.play().catch(() => {});
          }
          setHasSound(!!media?.getAudioTracks().length);
          setBy((b) => b ?? "");
        };
        conn.onicecandidate = (e) => e.candidate && void signalRef.current(sig.from, "ice", e.candidate.toJSON());
        conn.onconnectionstatechange = () => (conn.connectionState === "failed" || conn.connectionState === "closed") && close();
        await conn.setRemoteDescription(offer.sdp);
        for (const c of pending.current.splice(0)) await conn.addIceCandidate(c).catch(() => {});
        await conn.setLocalDescription(await conn.createAnswer());
        await signalRef.current(sig.from, "answer", { n: offer.n, sdp: conn.localDescription?.toJSON() });
      })();
    } else if (sig.type === "ice") {
      const c = sig.data as RTCIceCandidateInit;
      if (pc.current?.remoteDescription) void pc.current.addIceCandidate(c).catch(() => {});
      else pending.current.push(c);
    }
  });

  return (
    <div className={`share-view${by !== null ? " on" : ""}`} aria-hidden={by === null}>
      <video ref={video} autoPlay playsInline muted={muted} />
      {by !== null && <p className="share-label">{by ? t("sharedBy", { name: by }) : t("shared")}</p>}
      {by !== null && hasSound && muted && (
        <button
          type="button"
          className="btn share-sound"
          onClick={() => {
            setMuted(false);
            void video.current?.play().catch(() => {});
          }}
        >
          🔊 {t("sound")}
        </button>
      )}
    </div>
  );
}
