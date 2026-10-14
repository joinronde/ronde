"use client";

import * as Popover from "@radix-ui/react-popover";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { dateProblem } from "@/lib/shared/date-check";

// A date field drawn by Ronde: the date written out in the reader's language, a calendar of our own in a popover
// (the browser's cannot be styled), the keyboard of a grid (arrows, Page Up/Down for months, Home/End for the
// week). Values are ISO days ("2026-10-13"), like a native <input type="date">.

export interface DateInputProps {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  id?: string;
  /** Sent with a form, through a hidden input */
  name?: string;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  /** Shorter label: "13 Oct 2026" rather than "Tuesday 13 October 2026" */
  compact?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00`) : null);
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, 12);
const addMonths = (d: Date, n: number) => {
  const last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0, 12).getDate();
  return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last), 12);
};
/** Monday first: the weeks of the app start on Monday (ISO) */
const weekdayOf = (d: Date) => (d.getDay() + 6) % 7;

export function DateInput({
  value: controlled,
  defaultValue,
  onChange,
  id,
  name,
  min,
  max,
  required,
  disabled,
  placeholder,
  className,
  compact,
  ...aria
}: DateInputProps) {
  const t = useTranslations("pickers.date");
  const locale = useLocale();
  const [own, setOwn] = useState(defaultValue ?? "");
  const value = controlled ?? own;
  const selected = parse(value);
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<Date>(() => selected ?? new Date());
  const grid = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const check = useRef<HTMLInputElement>(null);
  const titleId = useId();

  const outOfRange = (d: Date) => (!!min && iso(d) < min) || (!!max && iso(d) > max);
  const commit = (next: string) => {
    if (controlled === undefined) setOwn(next);
    onChange?.(next);
  };
  const pick = (d: Date) => {
    if (outOfRange(d)) return;
    commit(iso(d));
    setOpen(false);
  };

  // Opening shows the chosen month, or this one
  useEffect(() => {
    if (open) setFocus(selected ?? (min && iso(new Date()) < min ? new Date(`${min}T12:00:00`) : new Date()));
  }, [open]);
  // The focused day takes the keyboard focus as it moves
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-day="${iso(focus)}"]`)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, focus]);

  const label = useMemo(() => {
    if (!selected) return "";
    return selected.toLocaleDateString(
      locale,
      compact ? { day: "numeric", month: "short", year: "numeric" } : { weekday: "long", day: "numeric", month: "long", year: "numeric" },
    );
  }, [value, locale, compact]);

  // What the form checks before it is sent, as a native date field would: required, and within its bounds
  const dayOf = (v: string) => parse(v)?.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) ?? v;
  const wrong = dateProblem(value, { required, min, max });
  const problem = !wrong ? "" : wrong.kind === "required" ? t("required") : t(wrong.kind, { date: dayOf(wrong.bound) });
  useEffect(() => check.current?.setCustomValidity(problem), [problem]);

  // Six weeks from the Monday on or before the first of the month
  const first = new Date(focus.getFullYear(), focus.getMonth(), 1, 12);
  const start = addDays(first, -weekdayOf(first));
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const today = iso(new Date());
  const monthTitle = first.toLocaleDateString(locale, { month: "long", year: "numeric" });
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    addDays(new Date(2024, 0, 1, 12), i)
      .toLocaleDateString(locale, { weekday: "short" })
      .replace(/\.$/, ""),
  );

  const onKey = (e: React.KeyboardEvent) => {
    const moves: Record<string, () => Date> = {
      ArrowLeft: () => addDays(focus, document.dir === "rtl" ? 1 : -1),
      ArrowRight: () => addDays(focus, document.dir === "rtl" ? -1 : 1),
      ArrowUp: () => addDays(focus, -7),
      ArrowDown: () => addDays(focus, 7),
      PageUp: () => addMonths(focus, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focus, e.shiftKey ? 12 : 1),
      Home: () => addDays(focus, -weekdayOf(focus)),
      End: () => addDays(focus, 6 - weekdayOf(focus)),
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      setFocus(move());
    }
  };

  return (
    <Popover.Root open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      {/* Sent with the form, and checked by it: a form never goes out without a required day, or with one out of bounds */}
      <input
        ref={check}
        className="date-input-check"
        tabIndex={-1}
        aria-hidden="true"
        name={name}
        value={value}
        onChange={() => {}}
        onFocus={() => trigger.current?.focus()}
      />
      <Popover.Trigger asChild>
        <button
          ref={trigger}
          type="button"
          id={id}
          className={`date-input${className ? ` ${className}` : ""}${open ? " open" : ""}`}
          disabled={disabled}
          // A field that opens a calendar: a combobox (which may be required), not a plain button (which may not)
          role="combobox"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-required={required || undefined}
          {...aria}
        >
          <CalendarDays className="ico date-input-ico" size={17} strokeWidth={1.8} aria-hidden="true" />
          <span className={`date-input-value${selected ? "" : " empty"}`}>{label || placeholder || t("placeholder")}</span>
          {selected && !required && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              className="date-input-clear"
              aria-label={t("clear")}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                commit("");
              }}
            >
              <X size={14} strokeWidth={2} aria-hidden="true" />
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="date-pop" sideOffset={6} align="start" collisionPadding={12} aria-labelledby={titleId}>
          <div className="date-pop-head">
            <button type="button" className="date-nav" aria-label={t("previous")} onClick={() => setFocus(addMonths(focus, -1))}>
              <ChevronLeft size={18} strokeWidth={2} aria-hidden="true" className="flip-rtl" />
            </button>
            <strong id={titleId} className="date-pop-title" aria-live="polite">
              {monthTitle}
            </strong>
            <button type="button" className="date-nav" aria-label={t("next")} onClick={() => setFocus(addMonths(focus, 1))}>
              <ChevronRight size={18} strokeWidth={2} aria-hidden="true" className="flip-rtl" />
            </button>
          </div>
          <div className="date-grid" role="grid" aria-labelledby={titleId} ref={grid} onKeyDown={onKey}>
            <div role="row" className="date-row">
              {weekdays.map((w) => (
                <span key={w} role="columnheader" className="date-wd">
                  {w}
                </span>
              ))}
            </div>
            {Array.from({ length: 6 }, (_, w) => (
              <div role="row" className="date-row" key={w}>
                {days.slice(w * 7, w * 7 + 7).map((d) => {
                  const day = iso(d);
                  const off = outOfRange(d);
                  return (
                    <span role="gridcell" key={day} aria-selected={day === value}>
                      <button
                        type="button"
                        data-day={day}
                        tabIndex={day === iso(focus) ? 0 : -1}
                        className={`date-day${d.getMonth() !== first.getMonth() ? " out" : ""}${day === today ? " today" : ""}${day === value ? " on" : ""}`}
                        disabled={off}
                        aria-current={day === today ? "date" : undefined}
                        aria-label={d.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                        onClick={() => pick(d)}
                      >
                        {d.getDate()}
                      </button>
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="date-pop-foot">
            {!required ? (
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => {
                  commit("");
                  setOpen(false);
                }}
              >
                {t("clear")}
              </button>
            ) : (
              <span />
            )}
            <button type="button" className="btn soft sm" disabled={outOfRange(new Date())} onClick={() => pick(new Date())}>
              {t("today")}
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
