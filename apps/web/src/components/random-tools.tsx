"use client";

import type { DrawDTO, DrawKind } from "@ronde/core/types";
import { first } from "@ronde/core/util";
import { coinTargetRotation, createSeededRandom, planWheelSpin } from "@ronde/random-core";
import { motionAllowed } from "@ronde/ui/effects";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useRonde } from "./ronde-provider";
import { Icon } from "./shell/icons";

// Random tools: the server draws, every screen plays the same animation from the draw's seed

const KINDS: DrawKind[] = ["wheel", "order", "teams", "coin"];
const SPIN_MS = 4200;
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

/** Sector path of a wheel of radius 100 centred on 0,0, around `angle` (degrees, clockwise from the top) */
function sector(angle: number, size: number): string {
  const pt = (a: number) => {
    const r = ((a - 90) * Math.PI) / 180;
    return `${(100 * Math.cos(r)).toFixed(2)} ${(100 * Math.sin(r)).toFixed(2)}`;
  };
  return `M0 0 L${pt(angle - size / 2)} A100 100 0 ${size > 180 ? 1 : 0} 1 ${pt(angle + size / 2)} Z`;
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
  return (
    <div className="draw-wheel">
      <svg viewBox="-104 -112 208 216" role="img" aria-label={t("kinds.wheel")}>
        <g ref={disc} className="draw-disc">
          {draw.entries.map((id, i) => (
            <g key={id} style={{ "--c": `var(--c${(members[id]?.color ?? i) % 6})` } as React.CSSProperties}>
              <path d={sector(i * size, size)} className={i % 2 ? "alt" : undefined} />
              <text
                transform={`rotate(${i * size}) translate(0 -62) rotate(${i * size > 90 && i * size < 270 ? 180 : 0})`}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {first(nameOf(id)).slice(0, 12)}
              </text>
            </g>
          ))}
          <circle r="14" className="hub" />
        </g>
        <path d="M-9 -110 L9 -110 L0 -92 Z" className="pointer" />
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
  const playing = usePlaying(draw, 2200);
  // Only a new draw replays the flip
  useEffect(() => {
    const el = face.current;
    if (!el) return;
    const end = coinTargetRotation(0, !!draw.tails, reducedMotion() ? 1 : 6);
    el.style.transform = `rotateY(${end}deg)`;
    if (!playing) return;
    const anim = el.animate([{ transform: "rotateY(0deg)" }, { transform: `rotateY(${end}deg)` }], {
      duration: reducedMotion() ? 400 : 2200,
      easing: "cubic-bezier(.2,.7,.2,1)",
    });
    return () => anim.cancel();
  }, [draw.id]);
  return (
    <div className="draw-coin">
      <div className="coin" ref={face} aria-hidden="true">
        <span className="heads">{t("heads")}</span>
        <span className="tails">{t("tails")}</span>
      </div>
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
      <div className="seg" role="group" aria-label={t("tool")}>
        {KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
            {t(`kinds.${k}`)}
          </button>
        ))}
      </div>
      <p className="hint">{t(`hints.${kind}`)}</p>
      <div className="controls">
        {kind === "teams" && (
          <label className="check">
            {t("teamSize")}{" "}
            <input
              type="number"
              min={2}
              max={10}
              value={teamSize}
              onChange={(e) => setTeamSize(Number(e.target.value) || 2)}
              style={{ width: "4.5em" }}
            />
          </label>
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
