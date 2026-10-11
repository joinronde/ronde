"use client";

import { motionAllowed } from "@ronde/ui/effects";
import { type HTMLAttributes, type ReactNode, type Ref, useEffect, useRef } from "react";
import { Icon } from "./shell/icons";

// A row of tabs or steps wider than its room: swiped with a finger, or moved with the arrows that show on
// the side where more is hidden (a mouse without a trackpad cannot scroll sideways). Its edges fade there too
// (data-more on the row and its wrapper, styled in globals.css), the selected item is brought into view, and
// the first time a row overflows in a visit it peeks a little to the end and back, so the swipe is discovered.

const PEEKED = "ronde:swipe-peeked";
/** Pixels from an end of the row that still count as that end */
const EDGE = 6;

export function useSwipeRow<T extends HTMLElement>(selected?: string) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      // Right to left, scrollLeft goes negative towards the end. A few pixels count as the edge: items snap to
      // their start, which sits after the row's padding, and an arrow would then cover the first item
      const x = Math.abs(el.scrollLeft);
      const more = max <= EDGE ? "" : x <= EDGE ? "end" : x >= max - EDGE ? "start" : "both";
      el.dataset.more = more;
      if (el.parentElement?.classList.contains("swipe-wrap")) el.parentElement.dataset.more = more;
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);

    let back: ReturnType<typeof setTimeout> | undefined;
    const still = !motionAllowed();
    let peeked = true;
    try {
      peeked = sessionStorage.getItem(PEEKED) === "1";
    } catch {}
    if (!still && !peeked && el.scrollWidth - el.clientWidth > 1) {
      try {
        sessionStorage.setItem(PEEKED, "1");
      } catch {}
      const dir = getComputedStyle(el).direction === "rtl" ? -1 : 1;
      const from = el.scrollLeft;
      el.scrollBy({ left: 48 * dir, behavior: "smooth" });
      // Back to where it was, not 48 pixels back: the items snap, and a relative move could stop on another one
      back = setTimeout(() => el.scrollTo({ left: from, behavior: "smooth" }), 650);
    }
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
      clearTimeout(back);
    };
  }, []);

  // The selected item stays in view as the selection moves
  useEffect(() => {
    const el = ref.current;
    const item = el?.querySelector<HTMLElement>('[aria-selected="true"], [aria-current="step"], [aria-current="page"]');
    if (!el || !item) return;
    // Measured on screen, so it holds right to left too; the page itself never scrolls
    const box = el.getBoundingClientRect();
    const at = item.getBoundingClientRect();
    const delta = at.left < box.left ? at.left - box.left - 24 : at.right > box.right ? at.right - box.right + 24 : 0;
    if (!delta) return;
    // Close to an end, go all the way: a row stopped a few pixels short shows its arrow over the first or last item
    const max = el.scrollWidth - el.clientWidth;
    const sign = getComputedStyle(el).direction === "rtl" ? -1 : 1;
    const x = Math.abs(el.scrollLeft + delta);
    el.scrollTo({ left: sign * (x < 40 ? 0 : x > max - 40 ? max : x), behavior: "smooth" });
  }, [selected]);

  return ref;
}

type Props = HTMLAttributes<HTMLElement> & {
  /** The key of the selected item: it is kept in view */
  selected?: string;
  /** A navigation landmark (the agenda) rather than a plain group (tabs) */
  nav?: boolean;
  wrapClassName?: string;
  children: ReactNode;
};

/** The row with its arrows; the arrows are for the mouse only, keyboard focus scrolls the row by itself */
export function SwipeRow({ selected, nav, className, wrapClassName, children, ...rest }: Props) {
  const row = useSwipeRow<HTMLElement>(selected);
  const go = (towardEnd: boolean) => {
    const el = row.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    el.scrollBy({ left: (towardEnd !== rtl ? 1 : -1) * el.clientWidth * 0.7, behavior: "smooth" });
  };
  const Tag = nav ? "nav" : "div";
  return (
    <div className={wrapClassName ? `swipe-wrap ${wrapClassName}` : "swipe-wrap"}>
      <Tag ref={row as Ref<HTMLDivElement>} className={className ? `${className} swipe-row` : "swipe-row"} {...rest}>
        {children}
      </Tag>
      <button type="button" className="swipe-arrow prev" tabIndex={-1} aria-hidden="true" onClick={() => go(false)}>
        <Icon name="chevronLeft" size={16} />
      </button>
      <button type="button" className="swipe-arrow next" tabIndex={-1} aria-hidden="true" onClick={() => go(true)}>
        <Icon name="chevronRight" size={16} />
      </button>
    </div>
  );
}
