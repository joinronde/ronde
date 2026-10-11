"use client";

import { formatters, type Locale } from "@ronde/i18n";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { removePushDeviceAction, savePushDeviceAction, setPushKindAction, testPushAction } from "@/app/account/actions";
import { FormAlert } from "@/components/auth/fields";
import { INSTALLABLE_EVENT } from "@/components/service-worker";

export interface PushSettingsProps {
  /** The instance has its push keys */
  available: boolean;
  publicKey: string;
  devices: { id: string; endpoint: string; label: string; createdAt: string }[];
  kinds: { turn: boolean; reminder: boolean; inbox: boolean };
}

const KINDS = ["turn", "reminder", "inbox"] as const;

/** The VAPID public key, as the browser wants it */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const raw = atob((base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** "Chrome · Android": enough to tell one's devices apart in the list */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /SamsungBrowser/.test(ua)
      ? "Samsung Internet"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "";
  const os = /Android/.test(ua)
    ? "Android"
    : /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Windows/.test(ua)
        ? "Windows"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return [browser, os].filter(Boolean).join(" · ");
}

type Support = "checking" | "ok" | "ios" | "unsupported";

/** Push notifications on this device, what they bring, the devices that get them, and installing the app */
export function PushSettings({ available, publicKey, devices, kinds: initial }: PushSettingsProps) {
  const t = useTranslations("push.ui");
  const fmt = formatters(useLocale() as Locale);
  const router = useRouter();
  const [support, setSupport] = useState<Support>("checking");
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [kinds, setKinds] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [installable, setInstallable] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    setInstallable(!!window.rondeInstall);
    const offer = () => setInstallable(!!window.rondeInstall);
    window.addEventListener(INSTALLABLE_EVENT, offer);
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      // On iPhone, push notifications come once Ronde is on the home screen
      setSupport(ios && !standalone ? "ios" : "unsupported");
    } else {
      setSupport("ok");
      setPermission(Notification.permission);
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => setEndpoint(sub?.endpoint ?? null))
        .catch(() => undefined);
    }
    return () => window.removeEventListener(INSTALLABLE_EVENT, offer);
  }, []);

  const mine = devices.find((d) => d.endpoint === endpoint);
  const on = !!endpoint && !!mine;

  const turnOn = async () => {
    setBusy(true);
    setError(null);
    try {
      const answer = await Notification.requestPermission();
      setPermission(answer);
      if (answer !== "granted") return;
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const res = await savePushDeviceAction({ endpoint: json.endpoint, keys: json.keys }, deviceLabel());
      if (!res.ok) return setError(res.error);
      setEndpoint(json.endpoint);
      router.refresh();
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      await (await reg.pushManager.getSubscription())?.unsubscribe();
      if (mine) await removePushDeviceAction(mine.id);
      setEndpoint(null);
      router.refresh();
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  };

  const install = async () => {
    const offer = window.rondeInstall;
    if (!offer) return;
    await offer.prompt();
    const { outcome } = await offer.userChoice;
    window.rondeInstall = null;
    setInstallable(false);
    if (outcome === "accepted") setInstalled(true);
  };

  return (
    <section className="stack push-settings" aria-labelledby="push-title">
      <h2 id="push-title">{t("title")}</h2>
      <p className="hint">{t("intro")}</p>
      <FormAlert>{error}</FormAlert>
      {!available ? (
        <p className="hint">{t("notConfigured")}</p>
      ) : support === "ios" ? (
        <p className="note-box">{t("ios")}</p>
      ) : support === "unsupported" ? (
        <p className="hint">{t("unsupported")}</p>
      ) : support === "ok" ? (
        <>
          <div className="push-device">
            {on ? (
              <>
                <span className="st-pill st-done">{t("on")}</span>
                <button type="button" className="btn" onClick={turnOff} disabled={busy} aria-busy={busy}>
                  {t("turnOff")}
                </button>
              </>
            ) : (
              <button type="button" className="btn primary" onClick={turnOn} disabled={busy} aria-busy={busy}>
                {t("turnOn")}
              </button>
            )}
          </div>
          {permission === "denied" && <p className="note-box">{t("blocked")}</p>}
        </>
      ) : null}
      {available && devices.length > 0 && (
        <>
          <fieldset className="plain push-kinds">
            <legend className="eyebrow">{t("kinds")}</legend>
            {KINDS.map((k) => (
              <label key={k} className="check">
                <input
                  type="checkbox"
                  checked={kinds[k]}
                  onChange={async (e) => {
                    const value = e.target.checked;
                    setKinds((x) => ({ ...x, [k]: value }));
                    const res = await setPushKindAction(k, value);
                    setError(res.ok ? null : res.error);
                  }}
                />{" "}
                <span>
                  {t(k)}
                  <span className="hint">{t(`${k}Hint`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div>
            <h3 className="eyebrow">{t("devices")}</h3>
            <ul className="push-list">
              {devices.map((d) => (
                <li key={d.id}>
                  <span>
                    <strong>{d.label || "—"}</strong>
                    {d.endpoint === endpoint && <span className="hint"> · {t("thisDevice")}</span>}
                    <span className="hint"> · {t("since", { date: fmt.dateShort(d.createdAt.slice(0, 10)) })}</span>
                  </span>
                  <button
                    type="button"
                    className="btn sm danger"
                    onClick={async () => {
                      if (d.endpoint === endpoint) return turnOff();
                      await removePushDeviceAction(d.id);
                      router.refresh();
                    }}
                  >
                    {t("remove")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="push-test">
            <button
              type="button"
              className="btn"
              onClick={async () => {
                const res = await testPushAction();
                setNotice(res.ok ? t("testSent", { count: res.data }) : null);
                setError(res.ok ? null : res.error);
              }}
            >
              {t("test")}
            </button>
            {notice && (
              <span className="hint" role="status">
                {notice}
              </span>
            )}
          </div>
        </>
      )}
      {installed ? (
        <p className="hint">✓ {t("installed")}</p>
      ) : (
        installable && (
          <div className="push-install">
            <button type="button" className="btn" onClick={install}>
              {t("install")}
            </button>
            <span className="hint">{t("installHint")}</span>
          </div>
        )
      )}
    </section>
  );
}
