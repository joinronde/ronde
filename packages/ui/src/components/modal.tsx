"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([type="hidden"]):not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** The dialogs open, the last one on top: only it answers the keyboard (Escape closes it alone) */
const open: HTMLElement[] = [];

/**
 * Dialog: focus trapped inside, Escape closes it, focus goes back to the element that opened it. It starts on
 * the element marked data-autofocus, otherwise on the first button or text area.
 */
export function Modal({ onClose, labelledBy, children }: { onClose: () => void; labelledBy?: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  // Some callers pass a new onClose on every render (the control room re-renders every second): keep the
  // latest one without re-running the effect, otherwise focus would keep jumping back to the first field
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const self = box.current;
    if (self) open.push(self);
    const onKey = (e: KeyboardEvent) => {
      // Another dialog opened over this one: the keyboard is its
      if (!box.current || open[open.length - 1] !== box.current) return;
      if (e.key === "Escape") closeRef.current();
      if (e.key !== "Tab") return;
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.tabIndex >= 0 && el.getClientRects().length,
      );
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (!firstItem || !lastItem) return;
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    (self?.querySelector<HTMLElement>("[data-autofocus]") ?? self?.querySelector<HTMLElement>("button,textarea"))?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      const at = self ? open.indexOf(self) : -1;
      if (at >= 0) open.splice(at, 1);
      opener?.focus?.();
    };
  }, []);
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="box" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={box}>
        {children}
      </div>
    </div>
  );
}
