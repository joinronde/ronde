"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { saveReportsAction, sendTestReportAction } from "@/app/w/[ws]/actions";
import { FormAlert } from "@/components/auth/fields";

export interface ReportSettingsView {
  frequency: "off" | "weekly" | "monthly";
  recipients: "admins" | "custom";
  emails: string;
}

/** Insights by email: how often, and to whom */
export function ReportSettings({ slug, initial }: { slug: string; initial: ReportSettingsView }) {
  const t = useTranslations("reports.settings");
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const set = (patch: Partial<ReportSettingsView>) => {
    setStatus(null);
    setV((x) => ({ ...x, ...patch }));
  };
  return (
    <section className="panel stack" aria-labelledby="report-title">
      <div>
        <h2 id="report-title" style={{ margin: 0 }}>
          {t("title")}
        </h2>
        <p className="hint">{t("intro")}</p>
      </div>
      <FormAlert>{error}</FormAlert>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          const res = await saveReportsAction(slug, v);
          if (!res.ok) return setError(res.error);
          setError(null);
          setStatus(`✓ ${t("saved")}`);
          router.refresh();
        }}
      >
        <fieldset className="plain stack">
          <legend className="lbl-s">{t("frequency")}</legend>
          {(["off", "weekly", "monthly"] as const).map((f) => (
            <label key={f} className="check">
              <input type="radio" name="frequency" checked={v.frequency === f} onChange={() => set({ frequency: f })} /> {t(f)}
            </label>
          ))}
        </fieldset>
        {v.frequency !== "off" && (
          <fieldset className="plain stack">
            <legend className="lbl-s">{t("recipients")}</legend>
            {(["admins", "custom"] as const).map((r) => (
              <label key={r} className="check">
                <input type="radio" name="recipients" checked={v.recipients === r} onChange={() => set({ recipients: r })} /> {t(r)}
              </label>
            ))}
            {v.recipients === "custom" && (
              <textarea
                aria-label={t("emails")}
                rows={3}
                value={v.emails}
                onChange={(e) => set({ emails: e.target.value })}
                placeholder="ceo@acme.com"
              />
            )}
          </fieldset>
        )}
        <div className="form-foot">
          <button type="submit" className="btn primary">
            {t("save")}
          </button>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              const res = await sendTestReportAction(slug);
              if (!res.ok) return setError(res.error);
              setError(null);
              setStatus(t("testSent", { email: res.data.email }));
            }}
          >
            {t("test")}
          </button>
          <span className="hint" role="status">
            {status}
          </span>
        </div>
      </form>
    </section>
  );
}
