"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { menuPlacement, menuShift } from "@/lib/shared/menu-placement";

/** Disclosure menu: a button opening a popover; Escape, a click outside or a choice closes it */
export function Menu({
  label,
  button,
  align = "end",
  up = false,
  className,
  onOpen,
  children,
}: {
  label: string;
  button: React.ReactNode;
  align?: "start" | "end";
  /** Opens above the button (near the bottom of the page), unless there is more room below */
  up?: boolean;
  className?: string;
  /** Called each time the menu opens */
  onOpen?: () => void;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const pop = useRef<HTMLDivElement>(null);
  // Measured while open: the side it fits on, how tall it may be, and how far to move it sideways to stay on
  // screen; again when the window changes size or its content arrives (a list loaded as it opens)
  const [place, setPlace] = useState<{ up: boolean; maxHeight: number; clamp: boolean; shift: number } | null>(null);
  const shiftRef = useRef(0);
  useLayoutEffect(() => {
    if (!open) {
      shiftRef.current = 0;
      return setPlace(null);
    }
    const measure = () => {
      const b = trigger.current;
      const p = pop.current;
      if (!b || !p) return;
      const r = b.getBoundingClientRect();
      // The sticky top bar covers only the page's content, not the sidebar nor a dialog
      const bar = b.closest("#main") ? (document.querySelector<HTMLElement>(".topbar")?.getBoundingClientRect().bottom ?? 0) : 0;
      const v = menuPlacement({
        top: r.top,
        bottom: r.bottom,
        viewport: innerHeight,
        topInset: Math.max(0, bar),
        height: p.scrollHeight,
        preferUp: up,
      });
      const box = p.getBoundingClientRect();
      const shift = menuShift({ left: box.left - shiftRef.current, right: box.right - shiftRef.current, viewport: innerWidth });
      shiftRef.current = shift;
      setPlace({ ...v, clamp: p.scrollHeight > v.maxHeight, shift });
    };
    measure();
    const content = new ResizeObserver(measure);
    if (pop.current?.firstElementChild) content.observe(pop.current.firstElementChild);
    addEventListener("resize", measure);
    return () => {
      content.disconnect();
      removeEventListener("resize", measure);
    };
  }, [open, up]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    root.current?.querySelector<HTMLElement>(".menu-pop a, .menu-pop button, .menu-pop select")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className={className ? `menu ${className}` : "menu"} ref={root}>
      <button
        ref={trigger}
        type="button"
        className="menu-btn"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
      >
        {button}
      </button>
      {open && (
        <div
          ref={pop}
          className={`menu-pop ${align}${(place?.up ?? up) ? " up" : ""}`}
          id={id}
          style={{
            // Capped and scrolling only when it does not fit: a menu's own overflow rules stay otherwise
            ...(place?.clamp ? { maxHeight: place.maxHeight, overflowY: "auto" } : {}),
            ...(place?.shift ? { translate: `${place.shift}px 0` } : {}),
          }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
