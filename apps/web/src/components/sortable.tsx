"use client";

import { GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { dropIndex, moved, rowShift } from "@/lib/shared/sortable";

// A list reordered by dragging the grip of a row (mouse, pen or finger), or with the arrow keys once the grip has
// the focus. The other rows make way as the row moves; the new order shows at once, before the server answers.

interface Drag {
  from: number;
  over: number;
  dy: number;
  /** Height of the row dragged, with the gap after it: how far the others make way */
  size: number;
}

export function useSortable<T>({
  items,
  keyOf,
  onMove,
  canMove = () => true,
  disabled = false,
}: {
  items: T[];
  keyOf: (item: T) => string;
  /** The row at `from` goes to `to`, the keys then in `order`; a false answer (refused) puts it back */
  onMove: (from: number, to: number, order: string[]) => unknown;
  /** Whether the row at `from` may go to `to` (a step already done stays where it is) */
  canMove?: (from: number, to: number) => boolean;
  /** Nothing moves for now (the agenda while a session runs) */
  disabled?: boolean;
}) {
  // Rows are found by this mark, wherever they are (a list of their own, or among other rows)
  const group = useId();
  const grips = useRef<(HTMLButtonElement | null)[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const origin = useRef<{ y: number; mids: number[] } | null>(null);
  const focusAfter = useRef<number | null>(null);
  // The order chosen, shown until the list comes back in another order
  const [pending, setPending] = useState<{ base: string; keys: string[] } | null>(null);
  const keys = items.map(keyOf);
  const base = keys.join("\n");
  // Keys not unique (rows not saved yet): the list as it is, nothing shown ahead
  const unique = new Set(keys).size === keys.length;
  const order = unique && pending && pending.base === base ? pending.keys : keys;
  const byKey = new Map(items.map((x) => [keyOf(x), x]));
  const list = unique ? order.map((k) => byKey.get(k)!).filter(Boolean) : items;

  useEffect(() => {
    if (focusAfter.current === null) return;
    grips.current[focusAfter.current]?.focus();
    focusAfter.current = null;
  });

  const commit = (from: number, to: number) => {
    if (from === to || !canMove(from, to)) return;
    const next = moved(order, from, to);
    setPending({ base, keys: next });
    void Promise.resolve(onMove(from, to, next)).then((ok) => {
      if (ok === false) setPending(null);
    });
  };
  const update = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const end = (drop: boolean) => {
    const d = dragRef.current;
    origin.current = null;
    update(null);
    document.documentElement.classList.remove("sorting");
    if (drop && d) commit(d.from, d.over);
  };

  const grip = (i: number, label: string) => ({
    ref: (el: HTMLButtonElement | null) => {
      grips.current[i] = el;
    },
    label,
    disabled: disabled || list.length < 2,
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 || disabled || list.length < 2) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const rows = [...document.querySelectorAll<HTMLElement>(`[data-sort-row="${CSS.escape(group)}"]`)];
      const rects = rows.map((r) => r.getBoundingClientRect());
      const gap = rects.length > 1 ? Math.max(0, rects[1]!.top - rects[0]!.bottom) : 0;
      origin.current = { y: e.clientY, mids: rects.map((r) => r.top + r.height / 2) };
      document.documentElement.classList.add("sorting");
      update({ from: i, over: i, dy: 0, size: (rects[i]?.height ?? 0) + gap });
    },
    onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => {
      const o = origin.current;
      const d = dragRef.current;
      if (!o || !d) return;
      const dy = e.clientY - o.y;
      const over = dropIndex(o.mids, d.from, o.mids[d.from]! + dy);
      update({ ...d, dy, over: canMove(d.from, over) ? over : d.over });
    },
    onPointerUp: () => end(true),
    onPointerCancel: () => end(false),
    onLostPointerCapture: () => {
      if (dragRef.current) end(true);
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "Escape" && dragRef.current) return end(false);
      const step = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
      if (!step) return;
      e.preventDefault();
      const to = i + step;
      if (to < 0 || to >= list.length || !canMove(i, to)) return;
      focusAfter.current = to;
      commit(i, to);
    },
  });

  /** Where a row stands while another one is dragged */
  const row = (i: number): { className: string; style?: React.CSSProperties; "data-sort-row": string } => {
    const mark = { "data-sort-row": group };
    if (!drag) return { className: "sort-row", ...mark };
    if (i === drag.from) return { className: "sort-row sort-dragging", style: { transform: `translateY(${drag.dy}px)` }, ...mark };
    const shift = rowShift(i, drag.from, drag.over) * drag.size;
    return { className: "sort-row", style: shift ? { transform: `translateY(${shift}px)` } : undefined, ...mark };
  };

  return { list, row, grip, dragging: drag !== null };
}

/** The handle of a row: dragged, or moved with the arrow keys */
export function SortGrip({ label, ...props }: ReturnType<ReturnType<typeof useSortable>["grip"]>) {
  const t = useTranslations("common");
  return (
    <button type="button" className="sort-grip" aria-label={label} title={t("dragToReorder")} {...props}>
      <GripVertical size={16} strokeWidth={2.2} aria-hidden="true" />
    </button>
  );
}
