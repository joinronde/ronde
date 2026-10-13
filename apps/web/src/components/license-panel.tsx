"use client";

import { formatters, type Locale } from "@ronde/i18n";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { saveLicenseAction } from "@/app/admin/actions";
import { FormAlert } from "@/components/auth/fields";

/** What the administration page shows of the license (never the key itself) */
export interface LicenseInfo {
  status: "none" | "invalid" | "active" | "grace" | "expired";
  reason?: "format" | "payload" | "signature" | "unknownKey";
  customer?: string;
  edition?: "team" | "enterprise";
  seats?: number;
  expiresAt?: string;
  graceEndsAt?: string;
  /** People who took part in a meeting in the last 30 days */
  usedSeats: number;
  /** The highest count since the license was saved, settled at its renewal */
  peak?: { count: number; at: string };
  /** Set by RONDE_LICENSE: shown, not editable here */
  fromEnv: boolean;
  /** "stub": a pure Community build, without the paid editions' code */
  build: "ee" | "stub";
}

const day = (iso?: string) => (iso ? iso.slice(0, 10) : "");

/** License of the instance: its state, and a field to paste a new key */
export function LicensePanel({ info }: { info: LicenseInfo }) {
  const t = useTranslations("admin.license");
  const fmt = formatters(useLocale() as Locale);
  const router = useRouter();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (value: string) => {
    setBusy(true);
    const res = await saveLicenseAction(value);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    setKey("");
    router.refresh();
  };
  const tone = info.status === "active" ? "ok" : info.status === "none" ? "" : "warn";
  return (
    <section className="panel form" aria-labelledby="license-title">
      <h2 id="license-title" style={{ margin: 0 }}>
        {t("title")}
      </h2>
      {info.build === "stub" ? (
        <p className="note-box">{t("pureCommunity")}</p>
      ) : (
        <>
          <div className={`license-state ${tone}`} role="status">
            <strong>{t(`status.${info.status}`)}</strong>
            {info.status === "invalid" && <span>{t(`reasons.${info.reason ?? "format"}`)}</span>}
            {info.edition && (
              <span>
                {t("summary", {
                  edition: t(`editions.${info.edition}`),
                  customer: info.customer ?? "",
                  date: fmt.date(day(info.expiresAt)),
                })}
              </span>
            )}
            {info.status === "grace" && <span>{t("graceUntil", { date: fmt.date(day(info.graceEndsAt)) })}</span>}
            {info.status === "expired" && <span>{t("readOnly")}</span>}
            {info.edition && (
              <span className="hint">
                {info.seats ? t("seats", { used: info.usedSeats, seats: info.seats }) : t("seatsUnlimited", { used: info.usedSeats })}
                {" · "}
                {t("seatsRule")}
              </span>
            )}
            {info.edition && info.peak && (
              <span className="hint">{t("peak", { count: info.peak.count, date: fmt.dayMonth(day(info.peak.at)) })}</span>
            )}
          </div>
          {/* Nothing is ever blocked: today's count above the license, or a peak above it that the renewal settles */}
          {!!info.seats && info.usedSeats > info.seats ? (
            <p className="note-box">{t("overSeats", { seats: info.seats })}</p>
          ) : (
            !!info.seats &&
            !!info.peak &&
            info.peak.count > info.seats && <p className="note-box">{t("overPeak", { count: info.peak.count, seats: info.seats })}</p>
          )}
          {info.fromEnv ? (
            <p className="hint">{t("fromEnv")}</p>
          ) : (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                void submit(key);
              }}
            >
              <FormAlert>{error}</FormAlert>
              <label htmlFor="licenseKey" className="lbl-s">
                {t("key")}
              </label>
              <textarea
                id="licenseKey"
                rows={3}
                spellCheck={false}
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="ronde_lic_v1.…"
              />
              <span className="hint">{t("keyHint")}</span>
              <div className="form-foot">
                <button type="submit" className="btn primary" disabled={busy || !key.trim()}>
                  {t("save")}
                </button>
                {info.status !== "none" && (
                  <button type="button" className="btn danger" disabled={busy} onClick={() => submit("")}>
                    {t("remove")}
                  </button>
                )}
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
