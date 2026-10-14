"use client";

import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { nudged, parseDuration } from "@/lib/shared/pickers";

// A duration typed as people say it ("25", "1h15", "1:30", "90 s"), nudged with − and +, or picked among the usual
// ones: minutes and seconds for a speaking time, hours and minutes for a meeting. Any value in the range is kept as
// it is; a value outside the list (from a template, or typed before) shows as is.

export interface DurationFieldProps {
  id: string;
  /** In the unit below */
  value: number;
  unit: "seconds" | "minutes";
  presets: number[];
  min: number;
  max: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
  labels: { custom: string; big: string; small: string; bigUnit: string; smallUnit: string; range: string };
  describedBy?: string;
}

export function DurationField({ id, value, unit, presets, min, max, format, onChange, labels, describedBy }: DurationFieldProps) {
  const t = useTranslations("pickers.duration");
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  useEffect(() => setDraft(null), [value]);
  const step = unit === "minutes" ? 5 : 15;
  const options = presets.includes(value) ? presets : [...presets, value].sort((a, b) => a - b);
  const typed = draft === null ? value : parseDuration(draft, unit, max);
  const outside = typed === null || typed < min || typed > max;

  const set = (next: number) => {
    const clamped = Math.min(max, Math.max(min, next));
    setDraft(null);
    if (clamped !== value) onChange(clamped);
  };
  const commit = () => {
    if (draft === null) return;
    const parsed = parseDuration(draft, unit, max);
    if (parsed === null) return setDraft(null);
    set(parsed);
  };
  const nudge = (dir: 1 | -1) => set(nudged(value, step, dir));

  return (
    <div className="duration-field">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <div className={`duration-box${open ? " open" : ""}${draft !== null && outside ? " invalid" : ""}`}>
          <button
            type="button"
            className="duration-step"
            aria-label={`${t("less")} (${format(step)})`}
            disabled={value <= min}
            onClick={() => nudge(-1)}
          >
            <Minus size={15} strokeWidth={2.2} aria-hidden="true" />
          </button>
          <Popover.Anchor asChild>
            <input
              ref={input}
              id={id}
              type="text"
              inputMode="text"
              autoComplete="off"
              className="duration-text"
              value={draft ?? format(value)}
              aria-describedby={[describedBy, hintId].filter(Boolean).join(" ")}
              aria-invalid={(draft !== null && outside) || undefined}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                  e.preventDefault();
                  nudge(e.key === "ArrowUp" ? 1 : -1);
                } else if (e.key === "Escape" && draft !== null) {
                  setDraft(null);
                }
              }}
            />
          </Popover.Anchor>
          <Popover.Trigger asChild>
            <button type="button" className="duration-step duration-open" aria-label={t("suggestions")} tabIndex={-1}>
              <ChevronDown size={15} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </Popover.Trigger>
          <button
            type="button"
            className="duration-step"
            aria-label={`${t("more")} (${format(step)})`}
            disabled={value >= max}
            onClick={() => nudge(1)}
          >
            <Plus size={15} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>
        <Popover.Portal>
          <Popover.Content
            className="time-pop duration-pop"
            sideOffset={6}
            align="center"
            collisionPadding={12}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <p className="duration-pop-title">{t("suggestions")}</p>
            <ul className="time-list duration-list">
              {options.map((v) => (
                <li key={v}>
                  <button
                    type="button"
                    className={`time-opt${v === value ? " on" : ""}`}
                    onClick={() => {
                      set(v);
                      setOpen(false);
                      input.current?.focus();
                    }}
                  >
                    {format(v)}
                    {v === value && <Check size={14} strokeWidth={2.4} aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
            <p className="hint duration-pop-hint">{t("typeHint")}</p>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <span id={hintId} className={`hint duration-range${draft !== null && outside ? " duration-out" : ""}`}>
        {labels.range}
      </span>
    </div>
  );
}
