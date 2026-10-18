"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { menuPlacement } from "@/lib/shared/menu-placement";

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
  // Measured once open: the side it fits on, and how tall it may be (the sticky top bar counted)
  const [place, setPlace] = useState<{ up: boolean; maxHeight: number } | null>(null);
  useLayoutEffect(() => {
    if (!open || !trigger.current || !pop.current) return setPlace(null);
    const r = trigger.current.getBoundingClientRect();
    const bar = document.querySelector<HTMLElement>(".topbar")?.getBoundingClientRect().bottom ?? 0;
    setPlace(
      menuPlacement({
        top: r.top,
        bottom: r.bottom,
        viewport: innerHeight,
        topInset: Math.max(0, bar),
        height: pop.current.scrollHeight,
        preferUp: up,
      }),
    );
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
          style={place ? { maxHeight: place.maxHeight, overflowY: "auto" } : undefined}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
