"use client";

import type { DrawDTO, DrawKind } from "@ronde/core/types";
import { first } from "@ronde/core/util";
import { coinTargetRotation, createSeededRandom, planWheelSpin } from "@ronde/random-core";
import { motionAllowed } from "@ronde/ui/effects";
import { Minus, Plus, Smile, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { sector } from "@/lib/shared/modules";
import { useRonde } from "./ronde-provider";
import { Icon } from "./shell/icons";

// Random tools: the server draws, every screen plays the same animation from the draw's seed

const KINDS: DrawKind[] = ["wheel", "order", "teams", "coin"];
const SPIN_MS = 4200;
/** Coordinates to the hundredth: the server and the browser then write them the same way (no hydration gap) */
const round2 = (x: number) => Math.round(x * 100) / 100;
/** A draw older than this shows its outcome straight away (screen opened or reloaded afterwards) */
const REPLAY_MS = 6000;

/** System setting, or animations turned off on this screen */
const reducedMotion = () => !motionAllowed();

/** The draw is still playing: true for the length of the animation, then false */
function usePlaying(draw: DrawDTO, ms: number): boolean {
  const { now } = useRonde();
  const left = draw.at + ms - now();
  const [playing, setPlaying] = useState(left > 0 && now() - draw.at < REPLAY_MS);
  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(() => setPlaying(false), Math.max(0, left));
    return () => clearTimeout(id);
  }, [playing, left]);
  return playing;
}

function Wheel({ draw }: { draw: DrawDTO }) {
  const t = useTranslations("random");
  const { members, nameOf } = useRonde();
  const disc = useRef<SVGGElement>(null);
  const playing = usePlaying(draw, SPIN_MS);
  const n = draw.entries.length;
  const size = 360 / n;
  const index = Math.max(0, draw.entries.indexOf(draw.pick ?? ""));
  // Only a new draw replays the spin
  useEffect(() => {
    const rng = createSeededRandom(`${draw.seed}:spin`);
    const plan = planWheelSpin(0, index, n, SPIN_MS, reducedMotion(), { jitter: rng.nextFloat(), turns: 5 + rng.nextInt(3) });
    const el = disc.current;
    if (!el) return;
    el.style.transform = `rotate(${plan.targetAngle}deg)`;
    if (!playing) return;
    const anim = el.animate(
      plan.samples.map((s) => ({ transform: `rotate(${s.angle}deg)`, offset: s.offset })),
      { duration: plan.duration, easing: "linear" },
    );
    return () => anim.cancel();
  }, [draw.id]);
  // Little lights round the rim, one at each border between two names and one between
  const lights = Array.from({ length: Math.max(12, n * 2) }, (_, i) => (i * 360) / Math.max(12, n * 2));
  return (
    <div className={`draw-wheel${playing ? " spinning" : " stopped"}`}>
      <svg viewBox="-112 -120 224 232" role="img" aria-label={t("kinds.wheel")}>
        <defs>
          <radialGradient id={`hub-${draw.id}`} cx="35%" cy="30%" r="80%">
            <stop offset="0%" stopColor="#fff7e6" />
            <stop offset="60%" stopColor="#f2c14e" />
            <stop offset="100%" stopColor="#b07a08" />
          </radialGradient>
        </defs>
        <circle r="108" className="rim" />
        <g ref={disc} className="draw-disc">
          {draw.entries.map((id, i) => (
            <g
              key={id}
              className={!playing && id === draw.pick ? "won" : undefined}
              style={{ "--c": `var(--c${(members[id]?.color ?? i) % 6})` } as React.CSSProperties}
            >
              <path d={sector(i * size, size)} className={i % 2 ? "alt" : undefined} />
              <text
                // Upright when its sector stops under the pointer: the name drawn is read the right way up
                transform={`rotate(${i * size}) translate(0 -64)`}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {first(nameOf(id)).slice(0, 12)}
              </text>
            </g>
          ))}
          <circle r="100" className="ring" />
        </g>
        {lights.map((a, i) => (
          <circle
            key={a}
            className={`light${i % 2 ? " odd" : ""}`}
            r="2.6"
            cx={round2(Math.sin((a * Math.PI) / 180) * 104)}
            cy={round2(-Math.cos((a * Math.PI) / 180) * 104)}
          />
        ))}
        <circle r="17" className="hub" fill={`url(#hub-${draw.id})`} />
        <circle r="6" className="hub-dot" />
        <path d="M0 -92 L-11 -116 Q0 -124 11 -116 Z" className="pointer" />
      </svg>
      <p className="draw-result" aria-live="polite">
        {!playing && draw.pick && t("picked", { name: nameOf(draw.pick) })}
      </p>
    </div>
  );
}

function Coin({ draw }: { draw: DrawDTO }) {
  const t = useTranslations("random");
  const face = useRef<HTMLDivElement>(null);
  const toss = useRef<HTMLDivElement>(null);
  const playing = usePlaying(draw, 2200);
  // Only a new draw replays the flip
  useEffect(() => {
    const el = face.current;
    if (!el) return;
    const end = coinTargetRotation(0, !!draw.tails, reducedMotion() ? 1 : 6);
    el.style.transform = `rotateY(${end}deg)`;
    if (!playing) return;
    const duration = reducedMotion() ? 400 : 2200;
    const anim = el.animate([{ transform: "rotateY(0deg)" }, { transform: `rotateY(${end}deg)` }], {
      duration,
      easing: "cubic-bezier(.2,.7,.2,1)",
    });
    // Tossed up, then caught: the coin rises and falls while it turns, its shadow shrinks and grows on the table
    const air = reducedMotion()
      ? null
      : toss.current?.animate(
          [
            { transform: "translateY(0)" },
            { transform: "translateY(-70px)", offset: 0.45 },
            { transform: "translateY(0)", offset: 0.85 },
            { transform: "translateY(-6px)", offset: 0.93 },
            { transform: "translateY(0)" },
          ],
          { duration, easing: "ease-in-out" },
        );
    return () => {
      anim.cancel();
      air?.cancel();
    };
  }, [draw.id]);
  return (
    <div className={`draw-coin${playing ? " tossing" : ""}`}>
      <div className="coin-toss" ref={toss}>
        <div className="coin" ref={face} aria-hidden="true">
          <span className="heads">
            <Smile size={44} strokeWidth={1.8} />
            <b>{t("heads")}</b>
          </span>
          <span className="tails">
            <Star size={40} strokeWidth={1.8} />
            <b>{t("tails")}</b>
          </span>
        </div>
      </div>
      <span className="coin-shadow" aria-hidden="true" />
      <p className="draw-result" aria-live="polite">
        {!playing && (draw.tails ? t("tails") : t("heads"))}
      </p>
    </div>
  );
}

/** Names dealt one after the other */
function Dealt({ draw }: { draw: DrawDTO }) {
  const t = useTranslations("random");
  const { members, nameOf } = useRonde();
  const playing = usePlaying(draw, 400 * draw.entries.length);
  const person = (id: string, i: number) => (
    <li
      key={id}
      style={{ "--c": `var(--c${(members[id]?.color ?? 0) % 6})`, animationDelay: playing ? `${i * 0.4}s` : "0s" } as React.CSSProperties}
    >
      {nameOf(id)}
    </li>
  );
  if (draw.kind === "order")
    return (
      <div className="draw-order">
        <h4>{t("orderTitle")}</h4>
        <ol>{draw.order.map(person)}</ol>
      </div>
    );
  let i = 0;
  return (
    <div className="draw-teams">
      {draw.teams.map((team, n) => (
        <section key={team.join()}>
          <h4>{t("team", { n: n + 1 })}</h4>
          <ul>{team.map((id) => person(id, i++))}</ul>
        </section>
      ))}
    </div>
  );
}

/** How long a draw stays in front of everything once its animation is over, to read the outcome */
const HOLD_MS = 6000;

/** The last draw, as a band below the stage */
export function DrawBand({ draw, onClose }: { draw: DrawDTO; onClose?: () => void }) {
  const t = useTranslations("random");
  return (
    <div className="draw-band" role="status" key={draw.id}>
      <span className="eyebrow draw-kind">
        <Icon name="shuffle" size={14} />
        {t(`kinds.${draw.kind}`)}
      </span>
      {onClose && (
        <button type="button" className="icon-btn draw-close" aria-label={t("close")} onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      )}
      {draw.kind === "wheel" && <Wheel draw={draw} />}
      {draw.kind === "coin" && <Coin draw={draw} />}
      {(draw.kind === "order" || draw.kind === "teams") && <Dealt draw={draw} />}
    </div>
  );
}

/**
 * Shared screen and "My screen": a new draw comes in front of the stage while it plays and a few seconds
 * after, so the whole room watches it; then it settles as a band below. Each viewer may close it sooner.
 */
export function DrawShow({ draw }: { draw: DrawDTO }) {
  const { now } = useRonde();
  const showFor = (draw.kind === "wheel" || draw.kind === "coin" ? SPIN_MS : 1200) + HOLD_MS;
  const [front, setFront] = useState(() => now() - draw.at < showFor);
  useEffect(() => {
    setFront(now() - draw.at < showFor);
    const left = draw.at + showFor - now();
    if (left <= 0) return;
    const id = setTimeout(() => setFront(false), left);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw.id]);
  if (!front) return <DrawBand draw={draw} />;
  return (
    <div className="draw-overlay">
      <DrawBand draw={draw} onClose={() => setFront(false)} />
    </div>
  );
}

/** Control room: pick a tool, draw, then apply the outcome to the speaking order */
export function RandomHost() {
  const t = useTranslations("random");
  const { s, rpc, nameOf } = useRonde();
  const [kind, setKind] = useState<DrawKind>("wheel");
  const [teamSize, setTeamSize] = useState(2);
  const draw = s.meeting?.draw ?? null;
  if (!s.meeting) return null;
  return (
    <div className="stack">
      <div className="seg seg-grid" role="group" aria-label={t("tool")}>
        {KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {t(`kinds.${k}`)}
          </button>
        ))}
      </div>
      <p className="hint">{t(`hints.${kind}`)}</p>
      <div className="controls">
        {kind === "teams" && (
          // Between 2 and 10 per team, stepped: nothing outside can be typed
          <span className="stepper" role="group" aria-label={t("teamSize")}>
            <span className="stepper-label">{t("teamSize")}</span>
            <button
              type="button"
              className="stepper-btn"
              aria-label={`${t("teamSize")} −1`}
              disabled={teamSize <= 2}
              onClick={() => setTeamSize((n) => Math.max(2, n - 1))}
            >
              <Minus size={14} strokeWidth={2.4} aria-hidden="true" />
            </button>
            <output className="stepper-value" aria-live="polite">
              {teamSize}
            </output>
            <button
              type="button"
              className="stepper-btn"
              aria-label={`${t("teamSize")} +1`}
              disabled={teamSize >= 10}
              onClick={() => setTeamSize((n) => Math.min(10, n + 1))}
            >
              <Plus size={14} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </span>
        )}
        <button type="button" className="btn primary" onClick={() => rpc({ op: "random.draw", kind, teamSize })}>
          {draw?.kind === kind ? t("drawAgain") : t("draw")}
        </button>
      </div>
      {draw && (
        <div className="poll-host">
          <header>
            <strong>{t(`kinds.${draw.kind}`)}</strong>
            <span className="hint">
              {draw.kind === "wheel" && draw.pick && nameOf(draw.pick)}
              {draw.kind === "coin" && (draw.tails ? t("tails") : t("heads"))}
              {draw.kind === "order" && draw.order.map((id) => first(nameOf(id))).join(" → ")}
              {draw.kind === "teams" && draw.teams.map((team) => team.map((id) => first(nameOf(id))).join(", ")).join(" | ")}
            </span>
          </header>
          <div className="controls">
            {(draw.kind === "wheel" || draw.kind === "order") &&
              (draw.applied ? (
                <span className="hint">✓ {t("applied")}</span>
              ) : (
                <button type="button" className="btn sm" onClick={() => rpc({ op: "random.apply" }, t("applied"))}>
                  {draw.kind === "wheel" ? t("applyWheel", { name: first(nameOf(draw.pick)) }) : t("applyOrder")}
                </button>
              ))}
            <button type="button" className="btn sm" onClick={() => rpc({ op: "random.clear" })}>
              {t("clear")}
            </button>
          </div>
        </div>
      )}
      <p className="hint">{t("everyone")}</p>
    </div>
  );
}
