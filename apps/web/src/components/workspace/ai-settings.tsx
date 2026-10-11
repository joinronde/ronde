"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { saveAiAction, testAiAction } from "@/app/w/[ws]/actions";
import { FormAlert } from "@/components/auth/fields";
import { Select } from "@/components/select";
import { Icon } from "@/components/shell/icons";
import { NewTab } from "../shell/new-tab";

export interface AiSettingsProps {
  slug: string;
  /** The license has the assistant */
  available: boolean;
  enabled: boolean;
  model: string;
  models: readonly string[];
  /** Last characters of the workspace's own key; null when it has none */
  keyHint: string | null;
  /** The instance gives a key to every workspace */
  instanceKey: boolean;
  canEncrypt: boolean;
  plansUrl: string | null;
}

const MODEL_NAMES: Record<string, string> = {
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
};

/** The AI assistant of the workspace: on or off, the model, the provider key (Team) */
export function AiSettings(p: AiSettingsProps) {
  const t = useTranslations("aiSettings");
  const tm = useTranslations("modules");
  const tf = useTranslations("features");
  const router = useRouter();
  const [enabled, setEnabled] = useState(p.enabled);
  const [model, setModel] = useState(p.model);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  if (!p.available)
    return (
      <section className="panel" aria-labelledby="ai-title">
        <h2 id="ai-title">{t("title")}</h2>
        <div className="logo-locked">
          <p className="muted">{tm("upgrade.comesWith", { feature: tf("modules.aiAssistant"), edition: tm("editions.team") })}</p>
          {p.plansUrl && (
            <a
              data-umami-event="upgrade_click"
              data-umami-event-from="ai-settings"
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

  const save = async (removeKey = false) => {
    setBusy("save");
    setError(null);
    setStatus(null);
    const res = await saveAiAction(p.slug, { enabled, model, ...(removeKey ? { key: "" } : key.trim() ? { key } : {}) });
    setBusy(null);
    if (!res.ok) return setError(res.error);
    setKey("");
    setStatus(t("saved"));
    router.refresh();
  };
  const test = async () => {
    setBusy("test");
    setError(null);
    setStatus(null);
    const res = await testAiAction(p.slug);
    setBusy(null);
    if (!res.ok) return setError(res.error);
    setStatus(t("works"));
  };
  return (
    <section className="panel ai-settings" aria-labelledby="ai-title">
      <h2 id="ai-title">
        <Icon name="sparkles" size={18} /> {t("title")}
      </h2>
      <p className="muted">{t("intro")}</p>
      <FormAlert>{error}</FormAlert>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="check">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> <strong>{t("enable")}</strong>
        </label>
        <div className="grid2">
          <div className="field">
            <label htmlFor="aiModel">{t("model")}</label>
            <Select id="aiModel" value={model} onChange={(e) => setModel(e.target.value)}>
              {p.models.map((m) => (
                <option key={m} value={m}>
                  {MODEL_NAMES[m] ?? m}
                </option>
              ))}
            </Select>
          </div>
          <div className="field">
            <label htmlFor="aiKey">{t("key")}</label>
            <input
              id="aiKey"
              type="password"
              autoComplete="off"
              placeholder={p.keyHint ? `•••• ${p.keyHint}` : p.instanceKey ? t("instanceKey") : "sk-ant-…"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={!p.canEncrypt}
              aria-describedby="aiKeyHint"
            />
            <span className="hint" id="aiKeyHint">
              {!p.canEncrypt ? t("noEncryption") : p.keyHint ? t("keySaved") : p.instanceKey ? t("instanceKeyHint") : t("keyHint")}
            </span>
          </div>
        </div>
        <p className="hint ai-privacy">{t("privacy")}</p>
        <div className="form-foot">
          <button type="submit" className="btn primary" disabled={!!busy} aria-busy={busy === "save"}>
            {t("save")}
          </button>
          <button type="button" className="btn" onClick={() => void test()} disabled={!!busy || !p.enabled} aria-busy={busy === "test"}>
            {t("test")}
          </button>
          {p.keyHint && (
            <button type="button" className="btn ghost" onClick={() => void save(true)} disabled={!!busy}>
              {t("removeKey")}
            </button>
          )}
          <span className="hint" role="status">
            {status}
          </span>
        </div>
      </form>
    </section>
  );
}
