"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface TourStep {
  /** Chapter shown above the title ("Prepare", "Run"…) */
  chapter: string;
  title: string;
  body: React.ReactNode;
  /** Highlighted element: value of its data-tour attribute. Without a target, the card is centred. */
  target?: string;
  /** Fallback target when the first one is not shown (e.g. a button that only exists after the start) */
  fallback?: string;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;
const GAP = 14;
const MARGIN = 16;
/** Up to this width, the card is a sheet across the screen, and what it shows goes to the top */
const PHONE = 640;
const isPhone = () => window.innerWidth <= PHONE;

const findTarget = (step: TourStep): HTMLElement | null => {
  for (const name of [step.target, step.fallback]) {
    if (!name) continue;
    const el = document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
    if (el && el.getClientRects().length) return el;
  }
  return null;
};

const same = (a: Box | null, b: Box | null) =>
  a === b ||
  (!!a &&
    !!b &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5);

/** Highlighted area, slightly larger than the target and kept within the screen */
function spotOf(r: DOMRect): Box {
  const top = Math.max(r.top - PAD, 4);
  const left = Math.max(r.left - PAD, 4);
  const bottom = Math.min(r.bottom + PAD, window.innerHeight - 4);
  const right = Math.min(r.right + PAD, window.innerWidth - 4);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/** Card position: below the target, otherwise above, right, left, or at the bottom of the screen */
function cardPosition(spot: Box | null, cw: number, ch: number): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // A phone has no room beside the target: the sheet sits at the bottom, or at the top when the target is low
  // on the screen (the end of a page that cannot scroll further)
  if (vw <= PHONE) {
    const low = !!spot && spot.top + spot.height / 2 > vh / 2;
    return { top: low ? 8 : Math.max(8, vh - ch - 8), left: Math.max(0, (vw - cw) / 2) };
  }
  const clampX = (x: number) => Math.min(Math.max(x, MARGIN), Math.max(MARGIN, vw - cw - MARGIN));
  const clampY = (y: number) => Math.min(Math.max(y, MARGIN), Math.max(MARGIN, vh - ch - MARGIN));
  if (!spot) return { top: clampY((vh - ch) / 2), left: clampX((vw - cw) / 2) };
  const cx = spot.left + spot.width / 2 - cw / 2;
  if (vh - (spot.top + spot.height) >= ch + GAP + MARGIN) return { top: spot.top + spot.height + GAP, left: clampX(cx) };
  if (spot.top >= ch + GAP + MARGIN) return { top: spot.top - GAP - ch, left: clampX(cx) };
  if (vw - (spot.left + spot.width) >= cw + GAP + MARGIN) return { top: clampY(spot.top), left: spot.left + spot.width + GAP };
  if (spot.left >= cw + GAP + MARGIN) return { top: clampY(spot.top), left: spot.left - GAP - cw };
  return { top: vh - ch - MARGIN, left: clampX(cx) };
}

/**
 * Guided tour: dims the page, highlights one element at a time and explains it in a card.
 * Keyboard: → / ← to move forward or back, Escape to quit; the page shortcuts are suspended.
 */
export function Tour({ steps, onStep, onClose }: { steps: TourStep[]; onStep?: (i: number) => void; onClose: () => void }) {
  const t = useTranslations("tour");
  const [i, setI] = useState(0);
  const [spot, setSpot] = useState<Box | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const scrolled = useRef(-1);
  const step = steps[i]!;
  const last = i === steps.length - 1;

  const go = useCallback((n: number) => setI((x) => Math.min(Math.max(x + n, 0), steps.length - 1)), [steps.length]);

  // Tell the page (pane change…) then focus the main action
  useEffect(() => {
    onStep?.(i);
    scrolled.current = -1;
    primary.current?.focus({ preventScroll: true });
  }, [i, onStep]);

  // Follow the target on every frame: pane opening, scrolling, resizing
  useLayoutEffect(() => {
    let raf = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = () => {
      const el = findTarget(step);
      if (el && scrolled.current !== i) {
        scrolled.current = i;
        const r = el.getBoundingClientRect();
        // On a phone the target goes to the top, above the sheet
        el.scrollIntoView({
          block: isPhone() || r.height > window.innerHeight * 0.6 ? "start" : "center",
          behavior: reduce ? "auto" : "smooth",
        });
      }
      const next = el ? spotOf(el.getBoundingClientRect()) : null;
      setSpot((prev) => (same(prev, next) ? prev : next));
      if (card.current) {
        const p = cardPosition(next, card.current.offsetWidth, card.current.offsetHeight);
        setPos((prev) => (prev && Math.abs(prev.top - p.top) < 0.5 && Math.abs(prev.left - p.left) < 0.5 ? prev : p));
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [i, step]);

  // Keyboard, captured before the page shortcuts; focus stays in the card
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (last) onClose();
        else go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Tab" && card.current) {
        const f = [...card.current.querySelectorAll<HTMLElement>("button")];
        if (!f.length) return;
        const idx = f.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && idx <= 0) {
          e.preventDefault();
          f[f.length - 1]!.focus();
        } else if (!e.shiftKey && (idx === -1 || idx === f.length - 1)) {
          e.preventDefault();
          f[0]!.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [go, last, onClose]);

  return createPortal(
    <div className="tour">
      <div className={"tour-block" + (spot ? "" : " dim")} aria-hidden="true" />
      {spot && <div className="tour-spot" style={spot} aria-hidden="true" />}
      <div
        ref={card}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tourTitle"
        aria-describedby="tourBody"
        style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
      >
        <div className="tour-head">
          <span className="eyebrow">
            {step.chapter} · {i + 1}/{steps.length}
          </span>
          <button type="button" className="tour-x" onClick={onClose} aria-label={t("quit")}>
            ×
          </button>
        </div>
        <h3 id="tourTitle" key={"t" + i}>
          {step.title}
        </h3>
        <div id="tourBody" className="tour-body" key={"b" + i}>
          {step.body}
        </div>
        <div className="tour-progress" aria-hidden="true">
          {steps.map((_, n) => (
            <i key={n} className={n < i ? "done" : n === i ? "cur" : ""} />
          ))}
        </div>
        <div className="tour-foot">
          {!last && (
            <button type="button" className="linkbtn" onClick={onClose}>
              {t("skip")}
            </button>
          )}
          {/* Previous and next together, next on the right: they wrap as a pair, never apart */}
          <span className="tour-nav">
            {i > 0 && (
              <button type="button" className="btn" onClick={() => go(-1)}>
                ← {t("previous")}
              </button>
            )}
            <button type="button" ref={primary} className="btn primary" onClick={() => (last ? onClose() : go(1))}>
              {last ? t("finish") : i === 0 ? `${t("start")} →` : `${t("next")} →`}
            </button>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
