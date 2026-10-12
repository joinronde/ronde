"use client";

import { BLOCK_MODULE } from "@ronde/core/agenda";
import { baseKeyOf, buildAgenda, currentIndex, type Step } from "@ronde/core/meeting";
import type { MemberDTO, Section, Snapshot } from "@ronde/core/types";
import {
  animOf,
  COMBO_WINDOW_MS,
  comboCount,
  comboThreshold,
  first,
  HOST_ID,
  hostName,
  resolveSections,
  signalCombo,
  signalOf,
} from "@ronde/core/util";
import { confetti } from "@ronde/ui/effects";
import { useLocale, useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Op } from "@/lib/server/meeting/ops";
import { withBasePath } from "@/lib/shared/base-path";

interface RondeCtx {
  s: Snapshot;
  members: Record<string, MemberDTO>;
  agenda: Step[];
  cur: number;
  /** Server time (corrects the device clock offset) */
  now: () => number;
  /** `silent`: a background call (a renewal), which neither reloads the state nor reports a failure; `tone`: the
   * colour of the confirmation (something turned on, or off) */
  rpc: (op: Op, okMessage?: string, opts?: { silent?: boolean; tone?: ToastTone }) => Promise<boolean>;
  toast: (msg: string, tone?: ToastTone) => void;
  /** Changes when a session is archived or its summary edited: history and stats load again */
  historyRev: number;
  connected: boolean;
  /** Last ping from the projection tab open in this browser */
  liveSeen: number;
  nameOf: (id: string | null | undefined) => string;
  /** Focus mode chosen in this browser, and whether it is on now (by choice, or during one's own turn) */
  focus: boolean;
  focusNow: boolean;
  setFocus: (on: boolean) => void;
  /** Name shown for the person running the meeting, from the settings */
  host: string;
  /** Check-in sections, from the settings */
  sections: Section[];
  /** True once the page is loaded in the browser (local time and time zone available) */
  hydrated: boolean;
  /** URL of a meeting API call: api("/draft") */
  api: (path: string) => string;
  /** URL of a person's photo */
  avatarUrl: (id: string, version: number) => string;
  /** Where a project of the meeting has its logo; null without one */
  projectLogo: (p: { id: string; logo?: number | null }) => string | null;
  /** Whether a module is on for this meeting ("kudos", "hands"…) */
  mod: (id: string) => boolean;
  /** This tab, for screen sharing: its id, and a signal to another tab ("*": every tab) */
  clientId: string;
  signal: (to: string, type: "share" | "stop" | "hello" | "offer" | "answer" | "ice", data?: unknown) => Promise<void>;
}

const Ctx = createContext<RondeCtx | null>(null);
const FOCUS_KEY = "ronde.focus";

export function useRonde(): RondeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useRonde must be used inside <RondeProvider>");
  return c;
}

/** Re-render the component at a regular interval (timers) */
export function useTick(ms = 250) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
}

/** How a message reads at a glance: done or turned on (green), turned off (neutral), failed (red) */
export type ToastTone = "ok" | "off" | "error";
interface Toast {
  id: number;
  msg: string;
  tone?: ToastTone;
}
interface KudoPop {
  id: number;
  from: string;
  to: string;
  text: string;
}
interface Fly {
  id: number;
  emoji: string;
  who: string;
  left: number;
  /** Message of a signal */
  label?: string;
  anim?: string;
}
interface Combo {
  id: number;
  emoji: string;
  count: number;
  text: string;
  anim: string;
}

export function RondeProvider({ initial, children }: { initial: Snapshot; children: React.ReactNode }) {
  const t = useTranslations("app");
  const tSignals = useTranslations("signals");
  const locale = useLocale();
  const [s, setS] = useState<Snapshot>(initial);
  const [offset, setOffset] = useState(initial.serverNow - Date.now());
  const [historyRev, setHistoryRev] = useState(0);
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [flies, setFlies] = useState<Fly[]>([]);
  const [kudos, setKudos] = useState<KudoPop[]>([]);
  const [combo, setCombo] = useState<Combo | null>(null);
  /** Recent signals, to spot a combo */
  const hits = useRef<{ emoji: string; byId: string | null; at: number }[]>([]);
  const [liveSeen, setLiveSeen] = useState(0);
  const [expired, setExpired] = useState(false);
  /** Base of the meeting API calls, base path included */
  const api = initial.context.api;
  // Accent colour of the meeting, on every page of it (the styles carry its light and dark variants)
  const accent = s.settings.appearance.accent;
  useEffect(() => {
    const targets = [document.documentElement, document.body];
    for (const el of targets) el.dataset.accent = accent;
    return () => {
      for (const el of targets) delete el.dataset.accent;
    };
  }, [accent]);

  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sRef = useRef(s);
  sRef.current = s;
  // Focus: no flying reactions, combos or confetti, to keep to the content; on by choice, and always during one's
  // own turn (kept in this browser only)
  const [focus, setFocusState] = useState(false);
  useEffect(() => {
    try {
      setFocusState(localStorage.getItem(FOCUS_KEY) === "1");
    } catch {}
  }, []);
  const setFocus = useCallback((on: boolean) => {
    setFocusState(on);
    try {
      localStorage.setItem(FOCUS_KEY, on ? "1" : "0");
    } catch {}
  }, []);
  const myTurn = !!s.meeting?.startedAt && !!s.viewer.memberId && baseKeyOf(s.meeting.stepKey) === s.viewer.memberId;
  const focusNow = focus || myTurn;
  const focusRef = useRef(focusNow);
  focusRef.current = focusNow;

  const toast = useCallback((msg: string, tone?: ToastTone) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  // A single state load at a time: a request arriving during a load triggers a single other one, after.
  // Two parallel loads could finish out of order, and the older state overwrote the newer one (a raised
  // hand disappearing, a step going back…).
  const inFlight = useRef(false);
  const again = useRef(false);
  const refetch = useCallback(async (): Promise<void> => {
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    try {
      const t0 = Date.now();
      const res = await fetch(`${api}/state`, { cache: "no-store" });
      // Signed out (session expired or revoked): a banner offers to sign in again without leaving the page
      if (res.status === 401) {
        setExpired(true);
        return;
      }
      // No longer allowed to see the meeting: back to the workspace
      if (res.status === 403) {
        window.location.href = withBasePath(`/w/${initial.context.workspace.slug}`);
        return;
      }
      if (!res.ok) return;
      const snap = (await res.json()) as Snapshot;
      const rtt = Date.now() - t0;
      setOffset(snap.serverNow + rtt / 2 - Date.now());
      setS(snap);
      // Session back (reconnection from the banner): banner removed, reload re-armed
      setExpired(false);
    } catch {
      /* network down: the event stream will trigger the load again */
    } finally {
      inFlight.current = false;
      if (again.current) {
        again.current = false;
        void refetch();
      }
    }
  }, [api, initial.context.workspace.slug]);

  /**
   * Session over: sign-in happens in a small window, which keeps the check-in or notes being typed. State
   * loading resumes as soon as the session is back, and the window closes. Window blocked: reload the page.
   */
  const reconnect = useCallback(() => {
    const w = window.open(withBasePath("/sign-in?next=%2Faccount"), "ronde-reconnect", "popup,width=520,height=760");
    if (!w) {
      window.location.reload();
      return;
    }
    const started = Date.now();
    const poll = setInterval(async () => {
      const done = () => {
        clearInterval(poll);
        w.close();
      };
      // Give up after 5 minutes (window closed without signing in): the button stays available
      if (Date.now() - started > 300_000) return done();
      try {
        const res = await fetch(`${api}/state`, { cache: "no-store" });
        if (res.ok) {
          done();
          void refetch();
        }
      } catch {
        /* network down: retry */
      }
    }, 1_500);
  }, [refetch, api]);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) return;
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      void refetch();
    }, 60);
  }, [refetch]);

  const rpc = useCallback(
    async (op: Op, okMessage?: string, opts?: { silent?: boolean; tone?: ToastTone }) => {
      try {
        const res = await fetch(`${api}/rpc`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(op),
        });
        if (res.status === 401) {
          setExpired(true);
          return false;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          if (!opts?.silent) {
            toast(body?.error ?? t("actionFailed"), "error");
            // Refused, often because the page was behind (a check-in saved elsewhere): catch up
            scheduleRefetch();
          }
          return false;
        }
        if (!opts?.silent) scheduleRefetch();
        if (okMessage) toast(okMessage, opts?.tone);
        return true;
      } catch {
        if (!opts?.silent) toast(t("serverUnreachable"), "error");
        return false;
      }
    },
    [scheduleRefetch, toast, t, api],
  );

  // This tab, for screen sharing between tabs
  const clientId = useRef(globalThis.crypto?.randomUUID?.() ?? String(Math.random()).slice(2)).current;
  // Live events
  useEffect(() => {
    let es: EventSource | null = null;
    let lastSignal = Date.now();
    const open = () => {
      es?.close();
      lastSignal = Date.now();
      const src = new EventSource(`${api}/events?client=${clientId}`);
      es = src;
      const alive = () => (lastSignal = Date.now());
      src.addEventListener("ready", () => {
        alive();
        setConnected(true);
        scheduleRefetch();
      });
      src.addEventListener("ping", alive);
      src.addEventListener("state", () => {
        alive();
        scheduleRefetch();
      });
      src.addEventListener("history", () => {
        alive();
        setHistoryRev((n) => n + 1);
      });
      src.addEventListener("reaction", (e) => {
        alive();
        const d = JSON.parse((e as MessageEvent).data) as { emoji: string; byId: string | null };
        // Counted on the step all the same (with the state); only the show is left out
        if (focusRef.current) return;
        const m = sRef.current.members.find((x) => x.id === d.byId);
        const sig = signalOf(d.emoji);
        const fly = {
          id: Math.random(),
          emoji: d.emoji,
          who: first(m?.name ?? (d.byId === HOST_ID ? hostName(sRef.current.settings, locale) : "")),
          left: 8 + Math.random() * 80,
          label: sig ? tSignals(`${sig.key}.label`) : undefined,
          anim: animOf(d.emoji),
        };
        setFlies((f) => [...f.slice(-10), fly]);
        setTimeout(() => setFlies((f) => f.filter((x) => x.id !== fly.id)), 3200);
        if (d.emoji === "🎉") confetti(45);
        if (sig) {
          // Combo: the same signal sent by several people within a short time shows up big
          const at = Date.now();
          hits.current = [...hits.current.filter((h) => at - h.at <= COMBO_WINDOW_MS), { emoji: d.emoji, byId: d.byId, at }];
          const cur = sRef.current;
          const team = cur.members.filter((x) => x.active).length;
          const count = comboCount(hits.current, d.emoji, at, comboThreshold(team));
          if (count) {
            const key = cur.meeting ? baseKeyOf(cur.meeting.stepKey) : "";
            const speaker = cur.members.find((x) => x.id === key);
            const c = {
              id: Math.random(),
              emoji: d.emoji,
              count,
              text: signalCombo(sig.key, speaker ? first(speaker.name) : "", locale),
              anim: sig.anim,
            };
            setCombo(c);
            setTimeout(() => setCombo((x) => (x?.id === c.id ? null : x)), 5000);
          }
        }
      });
      src.addEventListener("kudo", (e) => {
        alive();
        const d = JSON.parse((e as MessageEvent).data) as { fromId: string; toId: string; text: string };
        const nm = (id: string) =>
          sRef.current.members.find((x) => x.id === id)?.name ?? (id === HOST_ID ? hostName(sRef.current.settings, locale) : "");
        const k = { id: Math.random(), from: nm(d.fromId), to: nm(d.toId), text: d.text };
        setKudos((list) => [...list.slice(-2), k]);
        setTimeout(() => setKudos((list) => list.filter((x) => x.id !== k.id)), 6600);
      });
      // Screen sharing: handed to the components that share or show a screen
      src.addEventListener("signal", (e) => {
        alive();
        window.dispatchEvent(new CustomEvent("ronde-signal", { detail: JSON.parse((e as MessageEvent).data) }));
      });
      src.addEventListener("sound", (e) => {
        alive();
        // Played by the sound players of the page (see SoundPlayer), when turned on
        const d = JSON.parse((e as MessageEvent).data) as { sound: string };
        window.dispatchEvent(new CustomEvent("ronde-sound", { detail: d.sound }));
      });
      src.onerror = () => {
        setConnected(false);
        // Stream cut: if the proxy session expired, refetch reloads the page
        scheduleRefetch();
      };
    };
    open();
    // Stuck stream (the server pings every 15 s): reopen it and reload the state
    const watchdog = setInterval(() => {
      if (Date.now() - lastSignal > 40_000) {
        setConnected(false);
        open();
        scheduleRefetch();
      }
    }, 5_000);
    // Safety net: the state is reloaded regularly, even if an event got lost
    const resync = setInterval(() => {
      if (document.visibilityState === "visible") scheduleRefetch();
    }, 30_000);
    // Tab back in front, device out of sleep or network back: the state may have changed
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastSignal > 20_000) open();
      scheduleRefetch();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    return () => {
      clearInterval(watchdog);
      clearInterval(resync);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
      es?.close();
    };
  }, [scheduleRefetch, locale, tSignals, api]);

  // Presence of the projection tab (same browser)
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel("ronde");
      bc.onmessage = (e) => {
        if ((e.data as { t?: string })?.t === "live-here") setLiveSeen(Date.now());
      };
    } catch {
      /* browser without BroadcastChannel */
    }
    return () => bc?.close();
  }, []);

  const members = useMemo(() => Object.fromEntries(s.members.map((m) => [m.id, m])), [s.members]);
  // Blocks of modules turned off are left out, as on the server
  const blocks = useMemo(
    () => s.settings.agenda.filter((b) => !BLOCK_MODULE[b.type] || s.modules[BLOCK_MODULE[b.type]!]),
    [s.settings.agenda, s.modules],
  );
  const agenda = useMemo(
    () => buildAgenda(s.meeting, members, s.interactions, locale, blocks, s.blockData),
    [s.meeting, members, s.interactions, locale, blocks, s.blockData],
  );
  const cur = currentIndex(agenda, s.meeting?.stepKey);
  // First render: frozen server time, so the server HTML and the browser agree
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const now = useCallback(() => (hydrated ? Date.now() + offset : initial.serverNow), [hydrated, offset, initial.serverNow]);
  const host = useMemo(() => hostName(s.settings, locale), [s.settings, locale]);
  const nameOf = useCallback(
    (id: string | null | undefined) => (id ? (members[id]?.name ?? (id === HOST_ID ? host : "")) : ""),
    [members, host],
  );

  const sections = useMemo(() => resolveSections(s.settings, locale), [s.settings, locale]);
  const value: RondeCtx = {
    s,
    focus,
    focusNow,
    setFocus,
    members,
    agenda,
    cur,
    now,
    rpc,
    toast,
    historyRev,
    connected,
    liveSeen,
    nameOf,
    host,
    sections,
    hydrated,
    api: (path: string) => `${api}${path}`,
    avatarUrl: (id: string, version: number) => `${initial.context.workspaceApi}/avatar/${id}?v=${version}`,
    projectLogo: (p: { id: string; logo?: number | null }) =>
      p.logo ? `${initial.context.workspaceApi}/projects/${p.id}/logo?v=${p.logo}` : null,
    mod: (id: string) => !!s.modules[id],
    clientId,
    signal: async (to, type, data = null) => {
      try {
        await fetch(`${api}/signal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ to, from: clientId, type, data }),
        });
      } catch {}
    },
  };
  return (
    <Ctx.Provider value={value}>
      {children}
      {expired && (
        <div className="banner expired" role="alert">
          <span className="grow">{t("sessionExpired")}</span>
          <button type="button" className="btn primary" onClick={reconnect}>
            {t("reconnect")}
          </button>
        </div>
      )}
      <div id="fx" aria-hidden="true">
        {flies.map((f) => (
          <span key={f.id} className="fly" style={{ left: f.left + "%" }}>
            <i className={f.anim ? "fx-" + f.anim : undefined}>
              {f.emoji}
              <Particles anim={f.anim} />
            </i>
            {f.label && <b>{f.label}</b>}
            <small>{f.who}</small>
          </span>
        ))}
      </div>
      {combo && (
        <div className="combo" key={combo.id} role="status">
          <span className={"combo-e fx-" + combo.anim} aria-hidden="true">
            {combo.emoji}
            <Particles anim={combo.anim} />
          </span>
          <span className="combo-n">×{combo.count}</span>
          <p>{combo.text}</p>
        </div>
      )}
      <div className="kudos-layer" aria-live="polite">
        {kudos.map((k) => (
          <div className="kudo" key={k.id}>
            <span className="who2">💜 {t("kudoFrom", { from: first(k.from), to: k.to })}</span>
            <p>{t("quoted", { text: k.text })}</p>
          </div>
        ))}
      </div>
      {toasts.map((t, i) => (
        <div
          key={t.id}
          className={`toast${t.tone ? ` ${t.tone}` : ""}`}
          role={t.tone === "error" ? "alert" : "status"}
          style={{ transform: `translate(-50%, ${-i * 48}px)` }}
        >
          {t.tone === "ok" ? "✓ " : t.tone === "off" ? "○ " : ""}
          {t.msg}
        </div>
      ))}
    </Ctx.Provider>
  );
}

/** Small characters escaping from some reactions: the "z" of a yawn, the "?" of thinking */
const PARTICLES: Record<string, string[]> = { zzz: ["z", "Z", "z"], think: ["?", "?", "?"] };
function Particles({ anim }: { anim?: string }) {
  return anim && PARTICLES[anim] ? PARTICLES[anim].map((c, i) => <em key={i}>{c}</em>) : null;
}
