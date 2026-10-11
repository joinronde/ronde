"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { FormAlert } from "@/components/auth/fields";
import { withBasePath } from "@/lib/shared/base-path";
import { NewTab } from "../shell/new-tab";

export interface LogoSettingsProps {
  slug: string;
  /** The license has custom logos */
  available: boolean;
  /** Version of the current logo; null when none */
  logo: number | null;
  /** Where to compare the plans (null: suggestions turned off) */
  plansUrl: string | null;
}

/** Longest side of the stored logo: sharp on the shared screen, light in emails */
const MAX_SIDE = 512;

/** Resizes the image in the browser; PNG keeps transparency */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/png"));
}

/** The workspace's own logo, in place of Ronde's (Team) */
export function LogoSettings({ slug, available, logo, plansUrl }: LogoSettingsProps) {
  const t = useTranslations("branding");
  const tm = useTranslations("modules");
  const tf = useTranslations("features");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const api = withBasePath(`/api/w/${slug}/logo`);

  const send = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(api, { method: "PUT", body: await shrink(file) });
      if (!res.ok) setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? t("failed"));
      else router.refresh();
    } catch {
      setError(t("unreadable"));
    }
    setBusy(false);
  };
  const remove = async () => {
    setBusy(true);
    const res = await fetch(api, { method: "DELETE" });
    setBusy(false);
    if (res.ok) router.refresh();
  };

  return (
    <section className="panel logo-settings" aria-labelledby="logo-title">
      <h2 id="logo-title">{t("title")}</h2>
      {!available ? (
        <div className="logo-locked">
          <p className="muted">{tm("upgrade.comesWith", { feature: tf("branding.customLogo"), edition: tm("editions.team") })}</p>
          {plansUrl && (
            <a
              data-umami-event="upgrade_click"
              data-umami-event-from="logo-settings"
              className="link"
              href={plansUrl}
              target="_blank"
              rel="noopener"
            >
              {tm("upgrade.plans")}
              <NewTab />
            </a>
          )}
        </div>
      ) : (
        <>
          <p className="muted">{t("intro")}</p>
          <FormAlert>{error}</FormAlert>
          <div className="logo-row">
            <button
              type="button"
              className={`logo-drop${over ? " over" : ""}`}
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                void send(e.dataTransfer.files[0]);
              }}
              disabled={busy}
              aria-busy={busy}
            >
              {logo ? (
                <span className="logo-previews">
                  <span className="logo-preview light">
                    <img src={`${api}?v=${logo}`} alt={t("current")} />
                  </span>
                  <span className="logo-preview dark">
                    <img src={`${api}?v=${logo}`} alt="" />
                  </span>
                </span>
              ) : (
                <span className="logo-empty">
                  <strong>{t("drop")}</strong>
                  <span className="hint">{t("formats")}</span>
                </span>
              )}
            </button>
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                void send(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <div className="logo-actions">
              <button type="button" className="btn" onClick={() => input.current?.click()} disabled={busy}>
                {logo ? t("replace") : t("upload")}
              </button>
              {logo && (
                <button type="button" className="btn danger" onClick={() => void remove()} disabled={busy}>
                  {t("remove")}
                </button>
              )}
              <p className="hint">{t("where")}</p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
