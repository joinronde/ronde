"use client";

import { type Layout, layoutKey, MAX_COLUMNS, mergeLayout, moveBlock, sameLayout, setColumnCount } from "@ronde/core/layout";
import { motionAllowed } from "@ronde/ui/effects";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, GripVertical, LayoutDashboard, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRonde } from "./ronde-provider";

export interface BoardBlock {
  id: string;
  /** Block name, shown on its handle and while customising */
  title: string;
  /** Content; null or false: block absent for now (it keeps its place) */
  node: React.ReactNode;
}

/**
 * Page made of block columns that everyone arranges their own way: grab a block by its ⠿ handle and drop
 * it anywhere, in 1 to 3 columns. "Customise" adds arrows (keyboard, touch screens) and the number of
 * columns. The layout is kept for each person.
 */
export function Board({
  page,
  className,
  columns,
  after,
}: {
  page: string;
  className: string;
  columns: BoardBlock[][];
  after?: React.ReactNode;
}) {
  const t = useTranslations("board");
  const { s, rpc } = useRonde();
  const defaults: Layout = columns.map((c) => c.map((b) => b.id));
  const [layout, setLayout] = useState<Layout>(() => mergeLayout(defaults, s.prefs[layoutKey(page)]));
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ col: number; index: number } | null>(null);
  const dragged = useRef<string | null>(null);

  const byId = Object.fromEntries(columns.flat().map((b) => [b.id, b]));
  // Blocks added to the page since the layout was saved
  const shown = mergeLayout(defaults, layout);
  const custom = !sameLayout(shown, defaults);
  const n = shown.length;

  // Blocks glide to their new place (and the customising frame comes in softly), where the browser can show it
  const smoothly = (change: () => void) => {
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (!doc.startViewTransition || !motionAllowed()) return change();
    doc.startViewTransition(() => flushSync(change));
  };
  const edit = (on: boolean) => smoothly(() => setEditing(on));
  const apply = (next: Layout) => {
    smoothly(() => setLayout(next));
    void rpc({ op: "pref.set", key: layoutKey(page), value: sameLayout(next, defaults) ? null : next });
  };
  const place = (id: string, col: number, index: number) => apply(moveBlock(shown, id, col, index));

  /** Insertion index (without the moved block) before or after block `target`; end of column without a target */
  const indexAt = (col: number, target: string | null, after: boolean) => {
    const list = shown[col]!.filter((x) => x !== dragged.current);
    const i = target ? list.indexOf(target) : -1;
    return i < 0 ? list.length : i + (after ? 1 : 0);
  };
  const visible = (col: number) => shown[col]!.filter((id) => byId[id]?.node);

  const endDrag = () => {
    dragged.current = null;
    setDragging(null);
    setDrop(null);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragged.current && drop) place(dragged.current, drop.col, drop.index);
    endDrag();
  };

  // Number of columns different from the page default: equal-width grid
  const grid =
    className +
    (n !== defaults.length ? ` lay-cols lay-cols-${n}` : "") +
    (editing ? " lay-editing" : "") +
    (dragging ? " lay-dragging" : "");

  return (
    <div className="lay">
      <div className={"lay-bar" + (editing ? " on" : "")}>
        {editing ? (
          <>
            <span className="grow">
              {t.rich("editingHint", {
                handle: () => <GripVertical className="lay-grip-ico" size={15} strokeWidth={2.2} aria-hidden="true" />,
              })}
            </span>
            <span className="seg" role="group" aria-label={t("columnCount")}>
              {Array.from({ length: MAX_COLUMNS }, (_, i) => i + 1).map((k) => (
                <button key={k} type="button" aria-pressed={n === k} onClick={() => apply(setColumnCount(shown, k))}>
                  {t("columns", { count: k })}
                </button>
              ))}
            </span>
            {custom && (
              <button type="button" className="btn" onClick={() => apply(defaults)}>
                <RotateCcw size={15} strokeWidth={2} aria-hidden="true" /> {t("defaultLayout")}
              </button>
            )}
            <button type="button" className="btn primary" onClick={() => edit(false)}>
              <Check size={15} strokeWidth={2.4} aria-hidden="true" /> {t("done")}
            </button>
          </>
        ) : (
          <button type="button" className="btn lay-toggle" onClick={() => edit(true)} title={t("customiseHint")}>
            <LayoutDashboard size={15} strokeWidth={2} aria-hidden="true" /> {custom ? t("customiseCustom") : t("customise")}
          </button>
        )}
      </div>
      <div className={grid} style={{ "--lay-n": n } as React.CSSProperties}>
        {shown.map((_, c) => {
          const ids = visible(c);
          return (
            <div
              key={c}
              className="col lay-col"
              onDragOver={(e) => {
                if (!dragged.current) return;
                e.preventDefault();
                // Below the last block, or empty column: at the end of the column
                if (e.target === e.currentTarget) setDrop({ col: c, index: indexAt(c, null, true) });
              }}
              onDrop={onDrop}
            >
              {ids.map((id, i) => {
                const b = byId[id]!;
                const at = (after: boolean) => !!dragging && drop?.col === c && drop.index === indexAt(c, id, after) && dragging !== id;
                // Same structure while customising and in use: blocks are not recreated (current input is kept)
                return (
                  <div
                    key={id}
                    style={{ viewTransitionName: `lay-${page}-${id}`.replace(/[^a-zA-Z0-9-]/g, "-") }}
                    className={
                      "lay-item" +
                      (editing ? " editing" : "") +
                      (dragging === id ? " dragged" : "") +
                      (at(false) ? " drop-before" : "") +
                      (i === ids.length - 1 && at(true) ? " drop-after" : "")
                    }
                    onDragOver={(e) => {
                      if (!dragged.current) return;
                      e.preventDefault();
                      e.stopPropagation();
                      const r = e.currentTarget.getBoundingClientRect();
                      setDrop({ col: c, index: indexAt(c, id, e.clientY > r.top + r.height / 2) });
                    }}
                    onDrop={onDrop}
                  >
                    {/* Not a <button>: browsers do not start a drag and drop from a button */}
                    <span
                      role="button"
                      tabIndex={0}
                      className="lay-handle"
                      draggable
                      title={t("dragHint", { title: b.title })}
                      aria-label={t("move", { title: b.title })}
                      onClick={() => edit(true)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" && e.key !== " ") return;
                        e.preventDefault();
                        edit(true);
                      }}
                      onDragStart={(e) => {
                        dragged.current = id;
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", b.title);
                        const item = e.currentTarget.parentElement;
                        if (item) e.dataTransfer.setDragImage(item, 40, 16);
                        // After the drag image is captured: the original block fades
                        requestAnimationFrame(() => setDragging(id));
                      }}
                      onDragEnd={endDrag}
                    >
                      <GripVertical size={14} strokeWidth={2.2} aria-hidden="true" />
                      <span>{b.title}</span>
                    </span>
                    {editing && (
                      <div className="lay-head">
                        <strong className="grow">{b.title}</strong>
                        <span className="lay-moves" role="group" aria-label={t("move", { title: b.title })}>
                          <button
                            type="button"
                            className="icon-btn"
                            disabled={i === 0}
                            aria-label={t("up")}
                            onClick={() => place(id, c, shown[c]!.indexOf(ids[i - 1]!))}
                          >
                            <ArrowUp size={14} strokeWidth={2.2} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            disabled={i === ids.length - 1}
                            aria-label={t("down")}
                            onClick={() => place(id, c, shown[c]!.filter((x) => x !== id).indexOf(ids[i + 1]!) + 1)}
                          >
                            <ArrowDown size={14} strokeWidth={2.2} aria-hidden="true" />
                          </button>
                          {n > 1 && (
                            <>
                              <button
                                type="button"
                                className="icon-btn"
                                disabled={c === 0}
                                aria-label={t("left")}
                                onClick={() => place(id, c - 1, i)}
                              >
                                <ArrowLeft size={14} strokeWidth={2.2} aria-hidden="true" className="flip-rtl" />
                              </button>
                              <button
                                type="button"
                                className="icon-btn"
                                disabled={c === n - 1}
                                aria-label={t("right")}
                                onClick={() => place(id, c + 1, i)}
                              >
                                <ArrowRight size={14} strokeWidth={2.2} aria-hidden="true" className="flip-rtl" />
                              </button>
                            </>
                          )}
                        </span>
                      </div>
                    )}
                    <div className="lay-body" inert={editing}>
                      {b.node}
                    </div>
                  </div>
                );
              })}
              {(editing || dragging) && (
                <div
                  className={"lay-empty" + (dragging && drop?.col === c && drop.index === indexAt(c, null, true) ? " drop" : "")}
                  onDragOver={(e) => {
                    if (!dragged.current) return;
                    e.preventDefault();
                    e.stopPropagation();
                    setDrop({ col: c, index: indexAt(c, null, true) });
                  }}
                  onDrop={onDrop}
                >
                  {ids.length ? t("dropAtEnd") : t("dropEmpty")}
                </div>
              )}
            </div>
          );
        })}
        {after}
      </div>
    </div>
  );
}
