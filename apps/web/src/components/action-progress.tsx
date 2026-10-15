"use client";

import { formatters, type Locale } from "@ronde/i18n";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

/** Day of a moment in the viewer's time zone, as the formatters take it */
const dayOf = (at: number | string) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * Where a follow-up action stands, in its owner's words: what was tried, what is left. A line under the action,
 * written in place by its owner or the host; read-only for everyone else, and hidden when there is nothing to say.
 */
export function ActionProgress({
  text,
  progress,
  at,
  editable,
  onSave,
}: {
  /** The action, to name the field */
  text: string;
  progress: string | null;
  at: number | string | null;
  editable: boolean;
  /** Saves the sentence (empty clears it); false when it failed, so the field stays open */
  onSave: (progress: string) => Promise<boolean>;
}) {
  const t = useTranslations("actions");
  const fmt = formatters(useLocale() as Locale);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(progress ?? "");
  const [busy, setBusy] = useState(false);
  // What was just saved, shown until the page brings it back (null: cleared)
  const [saved, setSaved] = useState<{ text: string | null; at: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  useEffect(() => {
    // Into the field when it opens, back to the button that opened it when it closes
    if (editing) input.current?.focus();
    else if (wasEditing.current) toggle.current?.focus();
    wasEditing.current = editing;
  }, [editing]);
  useEffect(() => setSaved(null), [progress, at]);
  const shown = saved ? saved.text : progress;
  const shownAt = saved ? saved.at : at;

  const open = () => {
    setValue(shown ?? "");
    setEditing(true);
  };
  const close = (e?: React.KeyboardEvent) => {
    e?.stopPropagation();
    setEditing(false);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = value.replace(/\s+/g, " ").trim();
    if (text === (shown ?? "")) return setEditing(false);
    setBusy(true);
    const ok = await onSave(text);
    setBusy(false);
    if (!ok) return;
    setSaved({ text: text || null, at: Date.now() });
    setEditing(false);
  };

  if (editing)
    return (
      <form className="act-progress-form" onSubmit={save}>
        <input
          ref={input}
          type="text"
          value={value}
          maxLength={300}
          aria-label={t("progressFor", { text })}
          placeholder={t("progressPlaceholder")}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && close(e)}
          disabled={busy}
        />
        <button type="submit" className="btn sm primary" disabled={busy}>
          {t("progressSave")}
        </button>
        <button type="button" className="btn sm ghost" onClick={() => close()} disabled={busy}>
          {t("cancel")}
        </button>
      </form>
    );
  if (shown)
    return (
      <p className="act-progress">
        <span className="act-progress-text">{shown}</span>
        {shownAt && <span className="hint">{t("progressOn", { date: fmt.dayMonth(dayOf(shownAt)) })}</span>}
        {editable && (
          <button
            ref={toggle}
            type="button"
            className="link-btn"
            onClick={open}
            aria-label={`${t("progressEdit")} · ${t("progressFor", { text })}`}
          >
            {t("progressEdit")}
          </button>
        )}
      </p>
    );
  return editable ? (
    <button ref={toggle} type="button" className="link-btn act-progress-add" onClick={open} aria-label={`${t("progress")} · ${text}`}>
      + {t("progress")}
    </button>
  ) : null;
}
