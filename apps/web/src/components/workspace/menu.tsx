"use client";

import { useEffect, useId, useRef, useState } from "react";

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
  /** Opens above the button (near the bottom of the page) */
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
        <div className={`menu-pop ${align}${up ? " up" : ""}`} id={id}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
