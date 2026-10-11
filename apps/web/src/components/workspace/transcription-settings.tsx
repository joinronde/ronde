"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { saveTranscriptionAction } from "@/app/w/[ws]/actions";
import { FormAlert } from "@/components/auth/fields";
import { Select } from "@/components/select";
import { Icon } from "@/components/shell/icons";
import { NewTab } from "../shell/new-tab";

export interface TranscriptionSettingsProps {
  slug: string;
  available: boolean;
  enabled: boolean;
  baseUrl: string;
  model: string;
  language: string;
  keyHint: string | null;
  /** The instance provides a service to every workspace */
  instanceService: boolean;
  canEncrypt: boolean;
  plansUrl: string | null;
}

/** Spoken languages offered, empty to detect it: Ronde's languages, then other common ones */
const LANGUAGES = ["", "en", "zh", "hi", "es", "ar", "fr", "pt", "ru", "de", "it", "ja", "ko", "nl", "pl", "tr"];

/** The speech-to-text service of the workspace, for the transcript of the sessions (Team) */
export function TranscriptionSettings(p: TranscriptionSettingsProps) {
  const t = useTranslations("transcriptionSettings");
  const tm = useTranslations("modules");
  const tf = useTranslations("features");
  const router = useRouter();
  const [enabled, setEnabled] = useState(p.enabled);
  const [baseUrl, setBaseUrl] = useState(p.baseUrl);
  const [model, setModel] = useState(p.model);
  const [language, setLanguage] = useState(p.language);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!p.available)
    return (
      <section className="panel" aria-labelledby="stt-title">
        <h2 id="stt-title">{t("title")}</h2>
        <div className="logo-locked">
          <p className="muted">{tm("upgrade.comesWith", { feature: tf("modules.transcription"), edition: tm("editions.team") })}</p>
          {p.plansUrl && (
            <a
              data-umami-event="upgrade_click"
              data-umami-event-from="transcription-settings"
              className="link"
              href={p.plansUrl}
              target="_blank"
              rel="noopener"
            >
              {tm("upgrade.plans")}
              <NewTab />
            </a>
          )}
        </div>
      </section>
    );

  return (
    <section className="panel transcription-settings" aria-labelledby="stt-title">
      <h2 id="stt-title">
        <Icon name="mic" size={18} /> {t("title")}
      </h2>
      <p className="muted">{t("intro")}</p>
      <FormAlert>{error}</FormAlert>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setSaved(false);
          const res = await saveTranscriptionAction(p.slug, { enabled, baseUrl, model, language, ...(key.trim() ? { key } : {}) });
          setBusy(false);
          if (!res.ok) return setError(res.error);
          setError(null);
          setKey("");
          setSaved(true);
          router.refresh();
        }}
      >
        <label className="check">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> <strong>{t("enable")}</strong>
        </label>
        <div className="grid2">
          <div className="field">
            <label htmlFor="sttUrl">{t("url")}</label>
            <input
              id="sttUrl"
              type="url"
              value={baseUrl}
              placeholder="https://api.openai.com/v1"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <span className="hint">{t("urlHint")}</span>
          </div>
          <div className="field">
            <label htmlFor="sttModel">{t("model")}</label>
            <input id="sttModel" value={model} placeholder="whisper-1" onChange={(e) => setModel(e.target.value)} />
            <span className="hint">{t("modelHint")}</span>
          </div>
          <div className="field">
            <label htmlFor="sttLang">{t("language")}</label>
            <Select id="sttLang" value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l ? new Intl.DisplayNames([l], { type: "language" }).of(l) : t("detect")}
                </option>
              ))}
            </Select>
          </div>
          <div className="field">
            <label htmlFor="sttKey">{t("key")}</label>
            <input
              id="sttKey"
              type="password"
              autoComplete="off"
              disabled={!p.canEncrypt}
              value={key}
              placeholder={p.keyHint ? `•••• ${p.keyHint}` : p.instanceService ? t("instance") : "sk-…"}
              onChange={(e) => setKey(e.target.value)}
            />
            <span className="hint">{p.keyHint ? t("keySaved") : t("keyHint")}</span>
          </div>
        </div>
        <p className="hint ai-privacy">{t("privacy")}</p>
        <div className="form-foot">
          <button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>
            {t("save")}
          </button>
          <span className="hint" role="status">
            {saved ? `✓ ${t("saved")}` : ""}
          </span>
        </div>
      </form>
    </section>
  );
}
