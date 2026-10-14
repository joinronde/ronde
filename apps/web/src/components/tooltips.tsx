"use client";

import { useEffect } from "react";

// Tooltips drawn by Ronde, for the whole app: whatever carries a `title` (or `data-tip`), and the icon-only buttons
// and links named by their `aria-label`, show it in a bubble of our own on hover and on keyboard focus. The
// browser's own tooltip is held back while ours shows (the title comes back on leaving, so screen readers and
// React keep it). Touch screens get none: a tap is a click.

const DELAY = 380;
/** The tooltip moves to a neighbour without waiting again when the pointer goes from one to the next */
const GRACE = 300;

/** Some text in it is cut by an ellipsis: the tooltip then gives it whole */
const truncated = (el: Element) => [el, ...el.querySelectorAll("*")].some((x) => x.scrollWidth > x.clientWidth + 1);

function tipOf(el: Element): string | null {
  const own = el.getAttribute("title") ?? (el as HTMLElement).dataset.tipTitle ?? (el as HTMLElement).dataset.tip;
  if (own?.trim()) {
    // A label already on screen in full needs no tooltip (a sidebar link, unless folded to its icon)
    const shown = (el as HTMLElement).innerText?.trim() ?? "";
    if (shown && shown.includes(own.trim()) && !truncated(el)) return null;
    return own.trim();
  }
  // An icon-only control: its name is all it says
  if (el.matches("button[aria-label],a[aria-label],[role=button][aria-label]") && !el.textContent?.trim())
    return el.getAttribute("aria-label");
  return null;
}

function target(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  const el = node.closest<HTMLElement>("[title],[data-tip],[data-tip-title],button[aria-label],a[aria-label],[role=button][aria-label]");
  if (!el || el.closest("[data-no-tip]") || el.matches("iframe,option,input[type=hidden]")) return null;
  return tipOf(el) ? el : null;
}

export function Tooltips() {
  useEffect(() => {
    const bubble = document.createElement("div");
    bubble.className = "tip";
    bubble.setAttribute("role", "tooltip");
    bubble.setAttribute("aria-hidden", "true");
    document.body.appendChild(bubble);
    let current: HTMLElement | null = null;
    let timer = 0;
    let lastHide = 0;

    const restore = (el: HTMLElement) => {
      const saved = el.dataset.tipTitle;
      if (saved !== undefined) {
        if (!el.hasAttribute("title")) el.setAttribute("title", saved);
        delete el.dataset.tipTitle;
      }
    };
    const place = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const b = bubble.getBoundingClientRect();
      const margin = 8;
      let top = r.top - b.height - 8;
      let side = "top";
      if (top < margin) {
        top = r.bottom + 8;
        side = "bottom";
      }
      const center = r.left + r.width / 2;
      const left = Math.min(Math.max(center - b.width / 2, margin), window.innerWidth - b.width - margin);
      bubble.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      bubble.style.setProperty("--arrow", `${Math.round(center - left)}px`);
      bubble.dataset.side = side;
    };
    const show = (el: HTMLElement) => {
      const text = tipOf(el);
      if (!text || !el.isConnected) return;
      bubble.textContent = text;
      bubble.classList.add("on");
      place(el);
    };
    /** Out of the way (a click, a scroll) until the pointer leaves: the title stays held back meanwhile */
    const dismiss = () => {
      window.clearTimeout(timer);
      if (bubble.classList.contains("on")) lastHide = Date.now();
      bubble.classList.remove("on");
    };
    const hide = () => {
      window.clearTimeout(timer);
      if (current) restore(current);
      if (bubble.classList.contains("on")) lastHide = Date.now();
      current = null;
      bubble.classList.remove("on");
    };
    const enter = (el: HTMLElement, fromPointer: boolean) => {
      if (current === el) return;
      hide();
      current = el;
      // The browser's own tooltip would show on top of ours
      const title = el.getAttribute("title");
      if (fromPointer && title !== null) {
        el.dataset.tipTitle = title;
        el.removeAttribute("title");
      }
      const wait = Date.now() - lastHide < GRACE ? 0 : DELAY;
      timer = window.setTimeout(() => current === el && show(el), wait);
    };

    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = target(e.target);
      if (el) enter(el, true);
      else if (current && !current.contains(e.target as Node)) hide();
    };
    const out = (e: PointerEvent) => {
      if (current && !current.contains(e.relatedTarget as Node | null)) hide();
    };
    const focus = (e: FocusEvent) => {
      const el = target(e.target);
      if (el && el.matches(":focus-visible")) enter(el, false);
    };
    const blur = () => hide();
    const key = (e: KeyboardEvent) => e.key === "Escape" && hide();

    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("focusin", focus, true);
    document.addEventListener("focusout", blur, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("blur", hide);
    return () => {
      hide();
      bubble.remove();
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("pointerdown", dismiss, true);
      document.removeEventListener("focusin", focus, true);
      document.removeEventListener("focusout", blur, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("blur", hide);
    };
  }, []);
  return null;
}
