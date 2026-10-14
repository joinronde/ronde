"use client";

import * as Popover from "@radix-ui/react-popover";
import { Clock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { parseTime } from "@/lib/shared/pickers";

// A time field drawn by Ronde: typed as people say it ("9h30", "930", "9:30 pm"), or picked in a list of the
// quarter hours that opens on the current one. Values are "HH:MM" (24 h), like a native <input type="time">.

export interface TimeInputProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  /** Minutes between two times of the list */
  step?: number;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function TimeInput({ value, onChange, id, required, disabled, step = 15, className, ...aria }: TimeInputProps) {
  const t = useTranslations("pickers.time");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const hintId = useId();
  const label = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(2024, 0, 1, h, m).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  };
  const times = Array.from({ length: (24 * 60) / step }, (_, i) => `${pad(Math.floor((i * step) / 60))}:${pad((i * step) % 60)}`);
  const invalid = draft !== null && draft.trim() !== "" && parseTime(draft) === null;

  const commit = () => {
    if (draft === null) return;
    const parsed = parseTime(draft);
    if (parsed && parsed !== value) onChange(parsed);
    if (parsed || !draft.trim()) setDraft(null);
  };
  const pick = (v: string) => {
    setDraft(null);
    if (v !== value) onChange(v);
    setOpen(false);
    input.current?.focus();
  };

  // The list opens on the chosen time (or the nearest one before it)
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const at = times.filter((x) => x <= (value || "09:00")).at(-1) ?? times[0];
      list.current?.querySelector<HTMLElement>(`[data-time="${at}"]`)?.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  return (
    <Popover.Root open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <Popover.Anchor asChild>
        <div className={`time-input${open ? " open" : ""}${invalid ? " invalid" : ""}${className ? ` ${className}` : ""}`}>
          <input
            ref={input}
            id={id}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            required={required}
            disabled={disabled}
            value={draft ?? (value ? label(value) : "")}
            placeholder={t("placeholder")}
            aria-invalid={invalid || undefined}
            aria-describedby={[aria["aria-describedby"], invalid ? hintId : ""].filter(Boolean).join(" ") || undefined}
            aria-label={aria["aria-label"]}
            aria-labelledby={aria["aria-labelledby"]}
            aria-controls={open ? listId : undefined}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
                setOpen(false);
              } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const at = times.indexOf(value);
                const next = times[(at + (e.key === "ArrowDown" ? 1 : -1) + times.length) % times.length] ?? times[0]!;
                setDraft(null);
                onChange(next);
              }
            }}
          />
          <Popover.Trigger asChild>
            <button type="button" className="time-input-btn" disabled={disabled} aria-label={t("list")} tabIndex={-1}>
              <Clock size={16} strokeWidth={1.9} aria-hidden="true" />
            </button>
          </Popover.Trigger>
          {invalid && (
            <span id={hintId} className="sr-only" role="status">
              {t("invalid")}
            </span>
          )}
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          className="time-pop"
          sideOffset={6}
          align="start"
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <ul ref={list} id={listId} className="time-list" aria-label={t("list")}>
            {times.map((x) => (
              <li key={x}>
                <button type="button" data-time={x} className={`time-opt${x === value ? " on" : ""}`} onClick={() => pick(x)}>
                  {label(x)}
                </button>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
