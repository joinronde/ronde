"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { choicesOf } from "@/lib/shared/helpers";
import { SEARCH_FROM, searchChoices } from "@/lib/shared/select-search";
import { Highlighted } from "./highlighted";

// A drawn select: the same props and <option>/<optgroup> children as a native <select>, a list of our own.
// Focus stays on the button (aria-activedescendant); the list floats above the page so no container clips it.
// A long list (time zones, countries) opens with a search field that takes the focus and narrows it as one types.

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
  /** A search field above the list; by default for long lists */
  searchable?: boolean;
};

export function Select({
  value: raw,
  onChange,
  children,
  id,
  name,
  className,
  style,
  disabled,
  required,
  title,
  searchable: searchableProp,
  ...aria
}: SelectProps) {
  const t = useTranslations("common");
  const value = raw === undefined ? "" : String(raw);
  const choices = choicesOf(children);
  const selected = choices.find((c) => c.value === value);
  const searchable = searchableProp ?? choices.length > SEARCH_FROM;
  const [query, setQuery] = useState("");
  /** The choices shown, by index: all of them, or those answering the search */
  const shown = searchable && query.trim() ? searchChoices(choices, query) : choices.map((_, i) => i);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; top: number; width: number; up: boolean; max: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement & HTMLUListElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();
  const autoId = useId();
  const buttonId = id ?? autoId;

  const enabled = (i: number) => !!choices[i] && !choices[i]!.disabled;
  /** The next choice that can be picked among those shown, from `from` (a choice index; one not shown: an end) */
  const stepIn = (order: number[], from: number, delta: number) => {
    const at = order.indexOf(from);
    const start = at >= 0 ? at : delta > 0 ? -1 : order.length;
    for (let k = start + delta; k >= 0 && k < order.length; k += delta) if (enabled(order[k]!)) return order[k]!;
    return at >= 0 ? from : (order.find(enabled) ?? -1);
  };
  const step = (from: number, delta: number) => stepIn(shown, from, delta);
  const close = (refocus = false) => {
    setOpen(false);
    setQuery("");
    if (refocus) button.current?.focus();
  };
  const show = (typed = "") => {
    if (disabled) return;
    const order = typed ? searchChoices(choices, typed) : choices.map((_, i) => i);
    const at = typed ? -1 : choices.findIndex((c) => c.value === value);
    setQuery(typed);
    setActive(at >= 0 ? at : stepIn(order, -1, 1));
    setOpen(true);
  };
  const pick = (i: number) => {
    const c = choices[i];
    if (!c || c.disabled) return;
    close(true);
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
      const needed = Math.min(320, choices.length * 36 + 12 + (searchable ? 48 : 0));
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
  }, [open, choices.length, searchable]);
  // The search field takes the focus as the list opens
  const placed = place !== null;
  useEffect(() => {
    if (open && searchable && placed) search.current?.focus();
  }, [open, searchable, placed]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!button.current?.contains(t) && !list.current?.contains(t)) close();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, listId]);

  const onKey = (e: React.KeyboardEvent) => {
    const key = e.key;
    const inSearch = e.currentTarget === search.current;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(key)) {
        e.preventDefault();
        show();
      } else if (searchable && key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Typing on a closed long list starts searching it
        e.preventDefault();
        show(key);
      }
      return;
    }
    if (key === "Escape") {
      // Closes the list, not the dialog around it
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (key === "Tab") close();
    else if (key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => step(a, 1));
    } else if (key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => step(a, -1));
    } else if (key === "Home" && !inSearch) {
      e.preventDefault();
      setActive(step(-1, 1));
    } else if (key === "End" && !inSearch) {
      e.preventDefault();
      setActive(step(choices.length, -1));
    } else if (key === "Enter" || (key === " " && !inSearch)) {
      e.preventDefault();
      pick(active);
    } else if (key.length === 1 && !inSearch) {
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
        onClick={() => (open ? close() : show())}
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
          (() => {
            const position: React.CSSProperties = {
              left: Math.min(place.left, window.innerWidth - Math.max(place.width, searchable ? 260 : 180) - 8),
              minWidth: searchable ? Math.max(place.width, 260) : place.width,
              maxHeight: place.max,
              ...(place.up ? { bottom: window.innerHeight - place.top } : { top: place.top }),
            };
            const items = (
              <ul
                ref={searchable ? undefined : list}
                id={listId}
                role="listbox"
                aria-labelledby={buttonId}
                className={searchable ? "select-items" : `select-list${place.up ? " up" : ""}`}
                style={searchable ? undefined : position}
              >
                {shown.map((i) => {
                  const c = choices[i]!;
                  // Groups are said while the whole list shows; a search mixes them
                  const head = !query.trim() && c.group !== lastGroup && c.group ? c.group : null;
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
                        <span className="select-label">{query.trim() ? <Highlighted text={c.text} query={query} /> : c.label}</span>
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
                {!shown.length && (
                  <li role="presentation" className="select-none">
                    {t("noResults")}
                  </li>
                )}
              </ul>
            );
            if (!searchable) return items;
            return (
              <div ref={list} className={`select-list select-pop${place.up ? " up" : ""}`} style={position}>
                <label className="select-search">
                  <Search size={15} strokeWidth={2} aria-hidden="true" />
                  <input
                    ref={search}
                    type="text"
                    role="combobox"
                    aria-label={t("searchPlaceholder")}
                    aria-expanded
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-activedescendant={shown.includes(active) ? `${listId}-${active}` : undefined}
                    placeholder={t("searchPlaceholder")}
                    autoComplete="off"
                    spellCheck={false}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setActive(stepIn(searchChoices(choices, e.target.value), -1, 1));
                    }}
                    onKeyDown={onKey}
                  />
                </label>
                {items}
              </div>
            );
          })(),
          document.body,
        )}
    </span>
  );
}
