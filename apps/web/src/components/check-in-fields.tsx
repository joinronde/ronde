"use client";

import type { Section } from "@ronde/core/types";
import { taskItem, taskOf } from "@ronde/core/util";
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Check-in item as shown: ticked or not for a checklist */
export function ItemText({ item }: { item: string }) {
  const tr = useTranslations("checkInFields");
  const t = taskOf(item);
  if (t.done === null) return <>{item}</>;
  return (
    <>
      <span className={"tick" + (t.done ? " on" : "")} aria-label={t.done ? tr("done") : tr("toDo")} role="img">
        {t.done ? "✓" : ""}
      </span>
      <span className={t.done ? "ticked" : undefined}>{t.text}</span>
    </>
  );
}

/** Text area that grows with its content */
function AutoText(
  p: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string; inputRef?: (el: HTMLTextAreaElement | null) => void },
) {
  const { inputRef, ...rest } = p;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const fit = () => {
    const el = ref.current;
    // Hidden (check-in tab hidden during the live meeting): nothing to measure, wait until it shows
    if (!el || !el.offsetParent) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + 2 + "px";
  };
  useLayoutEffect(fit, [p.value]);
  // Tab shown or width changed (line wrapping): new height
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let width = -1;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <textarea
      {...rest}
      rows={1}
      ref={(el) => {
        ref.current = el;
        inputRef?.(el);
      }}
    />
  );
}

/**
 * Items of a section, like a task list: Enter adds the next item, Backspace on an empty item removes it,
 * pasting several lines creates several items, the handle or Alt+↑/↓ reorders. In a checklist, each
 * item has its checkbox.
 */
export function ListEditor({
  id,
  sec,
  items,
  onChange,
  aside,
}: {
  id: string;
  sec: Section;
  items: string[];
  onChange: (items: string[]) => void;
  /** Shown at the end of an item (the faces of the people who joined it) */
  aside?: (item: string) => React.ReactNode;
}) {
  const t = useTranslations("checkInFields");
  const checklist = sec.type === "checklist";
  const inputs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const newInput = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState("");
  // A line typed without Enter joins the list when the field is left; closing the page meanwhile would lose it:
  // the browser asks first
  const typing = !!draft.trim();
  useEffect(() => {
    if (!typing) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [typing]);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const focusAt = useRef<{ i: number; caret?: number } | null>(null);
  const [, redraw] = useState(0);
  /** Put the caret on item `i` (or on "Add" past the end of the list) */
  const refocus = (i: number, caret?: number) => {
    focusAt.current = { i, caret };
    redraw((n) => n + 1);
  };

  // Focus requested by a keyboard action, once the list is redrawn
  useLayoutEffect(() => {
    const f = focusAt.current;
    if (!f) return;
    focusAt.current = null;
    const el = f.i >= items.length ? newInput.current : inputs.current[f.i];
    if (!el) return;
    el.focus();
    const c = f.caret ?? el.value.length;
    el.setSelectionRange(c, c);
  });

  const rows = items.map((x) => (checklist ? taskOf(x) : { done: null, text: x }));
  const encode = (text: string, done: boolean | null) => (checklist ? taskItem(text, !!done) : text);
  const setText = (i: number, text: string) => onChange(items.map((x, j) => (j === i ? encode(text, rows[i]!.done) : x)));
  const toggle = (i: number) => onChange(items.map((x, j) => (j === i ? encode(rows[i]!.text, !rows[i]!.done) : x)));
  const insert = (at: number, texts: string[], focus = at + texts.length - 1) => {
    onChange([...items.slice(0, at), ...texts.map((x) => encode(x, false)), ...items.slice(at)]);
    focusAt.current = { i: focus };
  };
  const remove = (i: number, focus: number | null) => {
    onChange(items.filter((_, j) => j !== i));
    if (focus !== null) focusAt.current = { i: focus };
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x!);
    onChange(next);
    focusAt.current = { i: to };
  };
  /** Pasting several lines: one item per line (bullets and checkboxes removed) */
  const pasted = (e: React.ClipboardEvent<HTMLTextAreaElement>, at: number, replace: boolean) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\n")) return false;
    e.preventDefault();
    const lines = text
      .split(/\r?\n/)
      .map((l) =>
        l
          .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
          .replace(/^\[( |x|X)\]\s+/, "")
          .trim(),
      )
      .filter(Boolean);
    if (!lines.length) return true;
    if (replace) onChange([...items.slice(0, at), ...lines.map((x) => encode(x, false)), ...items.slice(at + 1)]);
    else insert(at, lines);
    focusAt.current = { i: at + lines.length - 1 };
    return true;
  };

  return (
    <div className={"list-ed" + (checklist ? " checklist" : "")} role="group" aria-labelledby={id + "-lbl"}>
      {items.length > 0 && (
        <ul>
          {rows.map((r, i) => (
            <li
              key={i}
              className={
                (drag === i ? "dragging" : "") +
                (over === i && drag !== null && drag !== i ? (drag < i ? " over-after" : " over-before") : "")
              }
              onDragOver={(e) => {
                if (drag === null) return;
                e.preventDefault();
                setOver(i);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag !== null) move(drag, i);
                setDrag(null);
                setOver(null);
              }}
            >
              <span
                className="grip"
                draggable
                title={t("dragHint")}
                aria-hidden="true"
                onDragStart={(e) => {
                  setDrag(i);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", r.text);
                  const li = e.currentTarget.parentElement;
                  if (li) e.dataTransfer.setDragImage(li, 12, 12);
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setOver(null);
                }}
              >
                ⠿
              </span>
              {checklist && (
                <input type="checkbox" checked={!!r.done} onChange={() => toggle(i)} aria-label={r.done ? t("markToDo") : t("markDone")} />
              )}
              <AutoText
                inputRef={(el) => (inputs.current[i] = el)}
                aria-label={t("itemLabel", { section: sec.label, n: i + 1 })}
                className={r.done ? "ticked" : undefined}
                value={r.text}
                maxLength={2000}
                onChange={(e) => setText(i, e.target.value.replace(/\n/g, " "))}
                onPaste={(e) => {
                  if (!r.text.trim()) pasted(e, i, true);
                  else pasted(e, i + 1, false);
                }}
                onKeyDown={(e) => {
                  const el = e.currentTarget;
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    // Enter: the rest of the text goes into a new item
                    const head = r.text.slice(0, el.selectionStart);
                    const tail = r.text.slice(el.selectionEnd);
                    if (!r.text.trim()) return refocus(i + 1);
                    onChange([
                      ...items.slice(0, i),
                      encode(head.trimEnd(), r.done),
                      encode(tail.trimStart(), false),
                      ...items.slice(i + 1),
                    ]);
                    focusAt.current = { i: i + 1, caret: 0 };
                  } else if (e.key === "Backspace" && !r.text && el.selectionStart === 0) {
                    e.preventDefault();
                    remove(i, i > 0 ? i - 1 : items.length > 1 ? 0 : items.length - 1);
                  } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                    e.preventDefault();
                    move(i, i + (e.key === "ArrowUp" ? -1 : 1));
                  } else if (e.key === "ArrowUp" && el.selectionStart === 0 && i > 0) {
                    e.preventDefault();
                    refocus(i - 1);
                  } else if (e.key === "ArrowDown" && el.selectionEnd === el.value.length) {
                    e.preventDefault();
                    refocus(i + 1);
                  }
                }}
              />
              {aside?.(items[i]!)}
              <button
                type="button"
                className="del danger"
                aria-label={t("removeItem", { text: r.text || t("emptyItem") })}
                title={t("remove")}
                onClick={() => remove(i, null)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="list-new">
        <span className="plus" aria-hidden="true">
          +
        </span>
        <AutoText
          id={id}
          inputRef={(el) => (newInput.current = el)}
          value={draft}
          maxLength={2000}
          placeholder={items.length ? t("addItem") : checklist ? t("addTaskFirst") : t("addItemFirst")}
          onChange={(e) => setDraft(e.target.value.replace(/\n/g, " "))}
          onPaste={(e) => {
            if (pasted(e, items.length, false)) setDraft("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!draft.trim()) return;
              onChange([...items, encode(draft.trim(), false)]);
              setDraft("");
            } else if ((e.key === "Backspace" && !draft) || (e.key === "ArrowUp" && e.currentTarget.selectionStart === 0)) {
              if (!items.length) return;
              e.preventDefault();
              refocus(items.length - 1);
            }
          }}
          onBlur={(e) => {
            // Item typed without Enter: kept anyway
            if (!draft.trim()) return;
            onChange([...items, encode(draft.trim(), false)]);
            setDraft("");
            // Leaving the field for the save button: the new row pushes the button down before the click
            // lands, so the form is submitted here, once the item is in (the form ignores a second submit)
            const to = e.relatedTarget;
            if (to instanceof HTMLButtonElement && to.type === "submit" && to.form && to.form === e.currentTarget.form) {
              const form = to.form;
              setTimeout(() => form.requestSubmit(to), 0);
            }
          }}
        />
      </div>
    </div>
  );
}

/** Free-text section: a single block of text, over several lines if needed */
export function FreeText({ id, sec, value, onChange }: { id: string; sec: Section; value: string; onChange: (v: string) => void }) {
  const t = useTranslations("checkInFields");
  return (
    <AutoText
      id={id}
      className="free-text"
      value={value}
      maxLength={2000}
      onChange={(e) => onChange(e.target.value)}
      placeholder={t("freeTextPlaceholder", { section: sec.label })}
    />
  );
}
