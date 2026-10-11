"use client";

import { useEffect, useState } from "react";
import { Select } from "@/components/select";

// A duration picked from usual values, or typed exactly ("Other duration…"): minutes and seconds for a speaking
// time, hours and minutes for a meeting. A value outside the list (from a template, or typed before) shows as is.

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

/** Seconds as minutes and seconds, minutes as hours and minutes */
const split = (v: number) => [Math.floor(v / 60), v % 60] as const;

export function DurationField({ id, value, unit, presets, min, max, format, onChange, labels, describedBy }: DurationFieldProps) {
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState(() => split(value).map(String));
  useEffect(() => setDraft(split(value).map(String)), [value]);
  const options = presets.includes(value) ? presets : [...presets, value].sort((a, b) => a - b);
  const commit = (next: string[]) => {
    const total = (Number(next[0]) || 0) * 60 + (Number(next[1]) || 0);
    const clamped = Math.min(max, Math.max(min, Math.round(total)));
    setDraft(split(clamped).map(String));
    if (clamped !== value) onChange(clamped);
  };
  const outside = (() => {
    const total = (Number(draft[0]) || 0) * 60 + (Number(draft[1]) || 0);
    return total < min || total > max;
  })();
  return (
    <div className="duration-field">
      <Select
        id={id}
        value={custom ? "custom" : value}
        aria-describedby={describedBy}
        onChange={(e) => {
          if (e.target.value === "custom") return setCustom(true);
          setCustom(false);
          onChange(Number(e.target.value));
        }}
      >
        {options.map((v) => (
          <option key={v} value={v}>
            {format(v)}
          </option>
        ))}
        <option value="custom">{labels.custom}</option>
      </Select>
      {custom && (
        <div className="duration-exact">
          <label className="duration-part">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={Math.floor(max / 60)}
              value={draft[0]}
              aria-label={labels.big}
              onChange={(e) => setDraft([e.target.value, draft[1] ?? "0"])}
              onBlur={() => commit(draft)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit(draft))}
              autoFocus
            />
            <span aria-hidden="true">{labels.bigUnit}</span>
          </label>
          <label className="duration-part">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={59}
              step={unit === "seconds" ? 5 : 5}
              value={draft[1]}
              aria-label={labels.small}
              onChange={(e) => setDraft([draft[0] ?? "0", e.target.value])}
              onBlur={() => commit(draft)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commit(draft))}
            />
            <span aria-hidden="true">{labels.smallUnit}</span>
          </label>
          <span className={`hint${outside ? " duration-out" : ""}`} role={outside ? "status" : undefined}>
            {labels.range}
          </span>
        </div>
      )}
    </div>
  );
}
