"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";

/** Labelled input with its hint and error wired to aria-describedby */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string | null;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => React.ReactNode;
}) {
  const id = useId();
  const described = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-describedby": described, "aria-invalid": error ? true : undefined })}
      {hint && (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
      {error && (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

/** Password input with a show/hide toggle */
export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const t = useTranslations("auth");
  const [shown, setShown] = useState(false);
  return (
    <span className="password-input">
      <input {...props} type={shown ? "text" : "password"} />
      <button
        type="button"
        className="eye-btn"
        aria-pressed={shown}
        aria-label={shown ? t("hidePassword") : t("showPassword")}
        title={shown ? t("hidePassword") : t("showPassword")}
        onClick={() => setShown(!shown)}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          aria-hidden="true"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        >
          <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="3" />
          {shown && <path d="M4 4l16 16" />}
        </svg>
      </button>
    </span>
  );
}

/** Form-level message, announced to screen readers */
export function FormAlert({ tone = "error", children }: { tone?: "error" | "ok" | "info"; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div className={`form-alert ${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}
