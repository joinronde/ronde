"use client";

import {
  Children,
  Fragment,
  isValidElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

// A drawn select: the same props and <option>/<optgroup> children as a native <select>, a list of our own.
// Focus stays on the button (aria-activedescendant); the list floats above the page so no container clips it.

interface Choice {
  value: string;
  label: ReactNode;
  /** Text used for type-ahead */
  text: string;
  disabled: boolean;
  group: string | null;
  lang?: string;
}

/** What onChange receives, shaped like the native event for the usual `e.target.value` */
export interface SelectChange {
  target: { value: string; name?: string };
  currentTarget: { value: string; name?: string };
}

export type SelectProps = {
  value?: string | number;
  onChange?: (e: SelectChange) => void;
  children: ReactNode;
  id?: string;
  name?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  required?: boolean;
  title?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
};

const textOf = (node: ReactNode): string =>
  typeof node === "string" || typeof node === "number"
    ? String(node)
    : Array.isArray(node)
      ? node.map(textOf).join("")
      : isValidElement(node)
        ? textOf((node.props as { children?: ReactNode }).children)
        : "";

function choicesOf(children: ReactNode, group: string | null = null): Choice[] {
  const out: Choice[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const el = child as ReactElement<{ value?: string | number; children?: ReactNode; disabled?: boolean; label?: string; lang?: string }>;
    if (el.type === "optgroup") out.push(...choicesOf(el.props.children, el.props.label ?? null));
    else if (el.type === "option")
      out.push({
        value: String(el.props.value ?? textOf(el.props.children)),
        label: el.props.children,
        text: textOf(el.props.children),
        disabled: !!el.props.disabled,
        group,
        lang: el.props.lang,
      });
    else if (el.type === Fragment) out.push(...choicesOf((el.props as { children?: ReactNode }).children, group));
  });
  return out;
}

export function Select({ value: raw, onChange, children, id, name, className, style, disabled, required, title, ...aria }: SelectProps) {
  const value = raw === undefined ? "" : String(raw);
  const choices = choicesOf(children);
  const selected = choices.find((c) => c.value === value);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; top: number; width: number; up: boolean; max: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();
  const autoId = useId();
  const buttonId = id ?? autoId;

  const enabled = (i: number) => !!choices[i] && !choices[i]!.disabled;
  const step = (from: number, delta: number) => {
    for (let i = from + delta; i >= 0 && i < choices.length; i += delta) if (enabled(i)) return i;
    return from;
  };
  const show = () => {
    if (disabled) return;
    const at = choices.findIndex((c) => c.value === value);
    setActive(at >= 0 ? at : step(-1, 1));
    setOpen(true);
  };
  const pick = (i: number) => {
    const c = choices[i];
    if (!c || c.disabled) return;
    setOpen(false);
    button.current?.focus();
    if (c.value !== value) onChange?.({ target: { value: c.value, name }, currentTarget: { value: c.value, name } });
  };

  // The list sits under the button, or above it when the page lacks room below; it follows scrolling
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = button.current?.getBoundingClientRect();
      if (!r) return;
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const needed = Math.min(320, choices.length * 36 + 12);
      const up = below < needed && above > below;
      setPlace({ left: r.left, top: up ? r.top - 6 : r.bottom + 6, width: r.width, up, max: Math.min(320, up ? above : below) });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, choices.length]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);

  const onKey = (e: React.KeyboardEvent) => {
    const key = e.key;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (key === "Escape") {
      // Closes the list, not the dialog around it
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (key === "Tab") setOpen(false);
    else if (key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => step(a, 1));
    } else if (key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => step(a, -1));
    } else if (key === "Home") {
      e.preventDefault();
      setActive(step(-1, 1));
    } else if (key === "End") {
      e.preventDefault();
      setActive(step(choices.length, -1));
    } else if (key === "Enter" || key === " ") {
      e.preventDefault();
      pick(active);
    } else if (key.length === 1) {
      // Type-ahead: the first choice starting with what was typed in the last second
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 1000 ? typed.current.text : "") + key.toLowerCase(), at: now };
      const i = choices.findIndex((c, k) => enabled(k) && c.text.toLowerCase().startsWith(typed.current.text));
      if (i >= 0) setActive(i);
    }
  };

  let lastGroup: string | null = null;
  return (
    <span className={`select${className ? ` ${className}` : ""}${open ? " open" : ""}`} style={style}>
      <button
        ref={button}
        id={buttonId}
        type="button"
        className="select-btn"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-required={required || undefined}
        data-value={value}
        disabled={disabled}
        title={title}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
        {...aria}
      >
        <span className="select-value" lang={selected?.lang}>
          {selected ? selected.label : <span className="select-empty">—</span>}
        </span>
        <svg className="select-chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {(name || required) && (
        <input
          className="select-native"
          tabIndex={-1}
          aria-hidden="true"
          name={name}
          required={required}
          value={value}
          onChange={() => {}}
          onFocus={() => button.current?.focus()}
        />
      )}
      {open &&
        place &&
        createPortal(
          <ul
            ref={list}
            id={listId}
            role="listbox"
            aria-labelledby={buttonId}
            className={`select-list${place.up ? " up" : ""}`}
            style={{
              left: Math.min(place.left, window.innerWidth - Math.max(place.width, 180) - 8),
              minWidth: place.width,
              maxHeight: place.max,
              ...(place.up ? { bottom: window.innerHeight - place.top } : { top: place.top }),
            }}
          >
            {choices.map((c, i) => {
              const head = c.group !== lastGroup && c.group ? c.group : null;
              lastGroup = c.group;
              return (
                <li key={`${c.group ?? ""}:${c.value}`} role="presentation">
                  {head && (
                    <span className="select-group" aria-hidden="true">
                      {head}
                    </span>
                  )}
                  <span
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={c.value === value}
                    aria-disabled={c.disabled || undefined}
                    data-value={c.value}
                    lang={c.lang}
                    className={`select-option${i === active ? " active" : ""}`}
                    onPointerMove={() => !c.disabled && setActive(i)}
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => pick(i)}
                  >
                    <span className="select-label">{c.label}</span>
                    {c.value === value && (
                      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
                        <path
                          d="M20 6 9 17l-5-5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </span>
  );
}
