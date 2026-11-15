"use client";

import { useEffect, useRef, useState } from "react";

/** A wide table's wrapper: a named, focusable region only while it really scrolls, so the keyboard can reach the rest */
export function ScrollRegion({ label, children }: { label: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="tbl-wrap" {...(scrolls ? { tabIndex: 0, role: "region", "aria-label": label } : {})}>
      {children}
    </div>
  );
}
