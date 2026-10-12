"use client";

import { THEMES, type Theme } from "@ronde/core/appearance";
import type { WorkspaceRole } from "@ronde/core/permissions";
import { initials } from "@ronde/core/util";
import { formatters, type Locale } from "@ronde/i18n";
import { Modal } from "@ronde/ui/modal";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { renderSVG } from "uqr";
import {
  deleteAccountAction,
  setThemeAction,
  setUpgradeHintsAction,
  setWeeklySummaryAction,
  updateProfileAction,
} from "@/app/account/actions";
import { Field, FormAlert, PasswordInput } from "@/components/auth/fields";
import { PasskeyIcon } from "@/components/auth/sign-in-form";
import { Icon } from "@/components/shell/icons";
import { authClient, failureKey, passkeyDismissed } from "@/lib/auth-client";
import { withBasePath } from "@/lib/shared/base-path";
import { squareImage } from "../avatar-picker";
import { CalendarLink } from "../upcoming-sessions";
import { LocaleSelect, TimeZoneSelect } from "./inputs";
import { deviceLabel, PushSettings, type PushSettingsProps } from "./push-settings";

interface Props {
  user: { name: string; email: string; locale: string; timezone: string };
  /** The person's photo, on their card in every workspace (null: no workspace yet, so no card to put it on) */
  photo: { url: string | null; color: number } | null;
}

export type AccountTab = "profile" | "security" | "notifications" | "workspaces";
const TABS: { id: AccountTab; href: string }[] = [
  { id: "profile", href: "/account" },
  { id: "security", href: "/account/security" },
  { id: "notifications", href: "/account/notifications" },
  { id: "workspaces", href: "/account/workspaces" },
];

/** Top of every account page: who is signed in, and the account's pages as tabs */
export function AccountHeader({ user, photo }: { user: { name: string; email: string }; photo: Props["photo"] }) {
  const t = useTranslations("account");
  const path = usePathname();
  return (
    <header className="page-head account-head">
      <span
        className={`av account-head-av${photo?.url ? " img" : ""}`}
        style={{ "--c": `var(--c${(photo?.color ?? 0) % 6})` } as React.CSSProperties}
        aria-hidden="true"
      >
        {photo?.url ? <img src={withBasePath(photo.url)} alt="" /> : initials(user.name || user.email)}
      </span>
      <div className="account-head-who">
        <h1>{user.name || t("title")}</h1>
        <p className="muted">{user.email}</p>
      </div>
      <nav className="tabs settings-tabs account-tabs" aria-label={t("tabs.label")}>
        {TABS.map((tab) => (
          <Link key={tab.id} href={tab.href} aria-current={path === tab.href ? "page" : undefined}>
            {t(`tabs.${tab.id}`)}
          </Link>
        ))}
      </nav>
    </header>
  );
}

/** Who the person is: photo, name, language, time zone; how Ronde looks for them */
export function AccountProfileView({
  user,
  photo,
  theme,
  upgradeHints,
}: Props & { theme: Theme /** Suggestions of the paid plans shown (null: not offered to this person) */; upgradeHints: boolean | null }) {
  return (
    <>
      <Profile user={user} photo={photo} />
      <ThemePicker initial={theme} />
      {upgradeHints !== null && <UpgradeHintsSwitch initial={upgradeHints} />}
      <YourData email={user.email} />
    </>
  );
}

/** The person's data: all of it as a file, and the account deleted for good */
function YourData({ email }: { email: string }) {
  const t = useTranslations("account");
  const [deleting, setDeleting] = useState(false);
  return (
    <section className="panel danger-zone" aria-labelledby="data-title">
      <h2 id="data-title">{t("data.title")}</h2>
      <div className="danger-row">
        <div>
          <strong>{t("data.export")}</strong>
          <p className="hint">{t("data.exportHint")}</p>
        </div>
        <a className="btn" href={withBasePath("/api/account/export")} download>
          {t("data.export")}
        </a>
      </div>
      <div className="danger-row">
        <div>
          <strong>{t("data.delete")}</strong>
          <p className="hint">{t("data.deleteHint")}</p>
        </div>
        <button type="button" className="btn danger" onClick={() => setDeleting(true)}>
          {t("data.delete")}
        </button>
      </div>
      {deleting && <DeleteAccount email={email} onClose={() => setDeleting(false)} />}
    </section>
  );
}

function DeleteAccount({ email, onClose }: { email: string; onClose: () => void }) {
  const t = useTranslations("account");
  const router = useRouter();
  const titleId = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await deleteAccountAction(text);
    if (!res.ok) {
      setBusy(false);
      return setError(res.error);
    }
    await authClient.signOut().catch(() => undefined);
    router.replace("/sign-in");
    router.refresh();
  };
  const same = text.trim().toLowerCase() === email.toLowerCase();
  return (
    <Modal onClose={onClose} labelledBy={titleId}>
      <form className="form dialog-form narrow" onSubmit={submit}>
        <h2 id={titleId}>{t("data.delete")}</h2>
        <p>{t("data.deleteHint")}</p>
        <FormAlert>{error}</FormAlert>
        <Field label={t.rich("data.deleteConfirm", { email, strong: (c) => <strong className="confirm-name">{c}</strong> })}>
          {(p) => <input {...p} type="email" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("data.cancel")}
          </button>
          <button type="submit" className="btn danger-solid" disabled={busy || !same} aria-busy={busy}>
            {t("data.deleteForGood")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** How the person signs in, and where they are signed in */
export function AccountSecurityView({
  hasPassword,
  twoFactorEnabled,
  passkeys,
}: {
  hasPassword: boolean;
  twoFactorEnabled: boolean;
  passkeys: PasskeyView[];
}) {
  const t = useTranslations("account");
  const router = useRouter();
  const signOutEverywhere = async () => {
    await authClient.revokeSessions();
    await authClient.signOut();
    router.replace("/sign-in");
    router.refresh();
  };
  return (
    <>
      <section className="stack" aria-labelledby="password-title">
        <h2 id="password-title">{t("password")}</h2>
        {hasPassword ? <ChangePassword /> : <p className="hint">{t("noPassword")}</p>}
      </section>
      <Passkeys initial={passkeys} />
      <TwoFactor enabled={twoFactorEnabled} hasPassword={hasPassword} />
      <section className="stack" aria-labelledby="sessions-title">
        <h2 id="sessions-title">{t("sessions")}</h2>
        <p className="hint">{t("sessionsHint")}</p>
        <div>
          <button type="button" className="btn danger" onClick={signOutEverywhere}>
            {t("signOutEverywhere")}
          </button>
        </div>
      </section>
    </>
  );
}

/** What reaches the person outside the app: on their devices, by email, in their calendar */
export function AccountNotificationsView({
  weekly,
  push,
  inWorkspace,
}: {
  weekly: boolean;
  push: PushSettingsProps;
  inWorkspace: boolean;
}) {
  const t = useTranslations("account");
  return (
    <>
      <PushSettings {...push} />
      {inWorkspace && <WeeklySwitch initial={weekly} />}
      <section className="stack" aria-labelledby="calendar-title">
        <h2 id="calendar-title">{t("calendar")}</h2>
        <p className="hint">{t("calendarHint")}</p>
        <div>
          <CalendarLink personal />
        </div>
      </section>
    </>
  );
}

/** The workspaces the person belongs to, with their role */
export function AccountWorkspacesView({ workspaces }: { workspaces: { slug: string; name: string; role: WorkspaceRole }[] }) {
  const t = useTranslations("account");
  const tw = useTranslations("workspace");
  return (
    <section className="stack" aria-labelledby="workspaces-title">
      <h2 id="workspaces-title">{t("workspaces")}</h2>
      {workspaces.length ? (
        <ul className="choice-list">
          {workspaces.map((w) => (
            <li key={w.slug}>
              <Link href={`/w/${w.slug}`}>{w.name}</Link>
              <span className="hint">{tw(`roles.${w.role}`)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">{t("noWorkspace")}</p>
      )}
      <div>
        <Link href="/onboarding" className="btn">
          <Icon name="plus" size={16} /> {t("createWorkspace")}
        </Link>
      </div>
    </section>
  );
}

/** A passkey of the person, as the account page lists it */
export interface PasskeyView {
  id: string;
  name: string;
  /** The password manager or the key holding it, when the authenticator says */
  provider: string | null;
  /** Synced across the person's devices (by their password manager), or kept on one device or key */
  synced: boolean;
  createdAt: string | null;
}

/** Passkeys: sign in with the device's lock (face, fingerprint, PIN) instead of a password */
function Passkeys({ initial }: { initial: PasskeyView[] }) {
  const t = useTranslations("account");
  const tAuth = useTranslations("auth");
  const fmt = formatters(useLocale() as Locale);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [supported, setSupported] = useState(true);
  useEffect(() => setSupported(typeof window !== "undefined" && !!window.PublicKeyCredential), []);
  const add = async () => {
    setBusy("add");
    setMessage(null);
    const res = await authClient.passkey.addPasskey({ name: deviceLabel() });
    setBusy(null);
    if (res?.error) {
      if (!passkeyDismissed(res.error)) setMessage({ tone: "error", text: tAuth(`failure.${failureKey(res.error)}`) });
      return;
    }
    setMessage({ tone: "ok", text: t("passkeyAdded") });
    router.refresh();
  };
  const remove = async (p: PasskeyView) => {
    setBusy(p.id);
    setMessage(null);
    const res = await authClient.passkey.deletePasskey({ id: p.id });
    setBusy(null);
    if (res?.error) return setMessage({ tone: "error", text: tAuth(`failure.${failureKey(res.error)}`) });
    setMessage({ tone: "ok", text: t("passkeyRemoved") });
    router.refresh();
  };
  return (
    <section className="stack" aria-labelledby="passkeys-title">
      <div className="row-between">
        <h2 id="passkeys-title">{t("passkeys")}</h2>
        {initial.length > 0 && <span className="st-pill st-done">{t("passkeyCount", { count: initial.length })}</span>}
      </div>
      <p className="hint">{t("passkeysHint")}</p>
      <FormAlert tone={message?.tone}>{message?.text}</FormAlert>
      {initial.length > 0 && (
        <ul className="passkey-list">
          {initial.map((p) => (
            <li key={p.id}>
              <span className="passkey-mark" aria-hidden="true">
                <PasskeyIcon />
              </span>
              <span className="passkey-text">
                <strong>{p.name || p.provider || t("passkeyUnnamed")}</strong>
                <span className="hint">
                  {[
                    p.name && p.provider,
                    p.synced ? t("passkeySynced") : t("passkeyDevice"),
                    p.createdAt && t("passkeySince", { date: fmt.dateShort(p.createdAt) }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <button type="button" className="btn sm danger" disabled={!!busy} aria-busy={busy === p.id} onClick={() => void remove(p)}>
                {t("passkeyRemove")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {supported ? (
        <div>
          <button type="button" className="btn" disabled={!!busy} aria-busy={busy === "add"} onClick={() => void add()}>
            <PasskeyIcon /> {t("passkeyAdd")}
          </button>
        </div>
      ) : (
        <p className="note-box">{t("passkeyUnsupported")}</p>
      )}
    </section>
  );
}

/** Monday's summary of the person's week, by email */
function WeeklySwitch({ initial }: { initial: boolean }) {
  const t = useTranslations("account");
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="stack" aria-labelledby="weekly-title">
      <h2 id="weekly-title">{t("weeklyTitle")}</h2>
      <FormAlert>{error}</FormAlert>
      <label className="check">
        <input
          type="checkbox"
          checked={on}
          onChange={async (e) => {
            setOn(e.target.checked);
            const res = await setWeeklySummaryAction(e.target.checked);
            setError(res.ok ? null : res.error);
          }}
        />{" "}
        {t("weeklyLabel")}
      </label>
      <p className="hint">{t("weeklyHint")}</p>
    </section>
  );
}

/** Suggestions of the paid plans, in the settings of the workspaces this person administers */
function UpgradeHintsSwitch({ initial }: { initial: boolean }) {
  const t = useTranslations("account");
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="stack" aria-labelledby="hints-title">
      <h2 id="hints-title">{t("upgradeHints")}</h2>
      <FormAlert>{error}</FormAlert>
      <label className="check">
        <input
          type="checkbox"
          checked={on}
          onChange={async (e) => {
            setOn(e.target.checked);
            const res = await setUpgradeHintsAction(e.target.checked);
            setError(res.ok ? null : res.error);
          }}
        />{" "}
        {t("upgradeHintsShow")}
      </label>
      <p className="hint">{t("upgradeHintsHint")}</p>
    </section>
  );
}

/** Light, dark or the device's theme, applied at once */
function ThemePicker({ initial }: { initial: Theme }) {
  const t = useTranslations("account");
  const [theme, setTheme] = useState<Theme>(initial);
  const [error, setError] = useState<string | null>(null);
  const choose = async (next: Theme) => {
    setTheme(next);
    if (next === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = next;
    const res = await setThemeAction(next);
    setError(res.ok ? null : res.error);
  };
  return (
    <section className="stack" id="appearance" aria-labelledby="appearance-title">
      <h2 id="appearance-title">{t("appearance")}</h2>
      <FormAlert>{error}</FormAlert>
      <div className="theme-pick" role="radiogroup" aria-label={t("theme")}>
        {THEMES.map((x) => (
          <label key={x} className="theme-option">
            <input type="radio" name="theme" value={x} checked={theme === x} onChange={() => void choose(x)} />
            <span className={`theme-preview th-${x}`} aria-hidden="true" />
            {t(`themes.${x}`)}
          </label>
        ))}
      </div>
    </section>
  );
}

function Profile({ user, photo }: { user: Props["user"]; photo: Props["photo"] }) {
  const t = useTranslations("account");
  const router = useRouter();
  const [values, setValues] = useState({ name: user.name, locale: user.locale, timezone: user.timezone });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<typeof values>) => {
    setSaved(false);
    setValues((v) => ({ ...v, ...patch }));
  };
  const form = useRef<HTMLFormElement>(null);
  const save = async () => {
    if (!form.current?.checkValidity()) return;
    setBusy(true);
    setError(null);
    const res = await updateProfileAction(values);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(true);
    router.refresh();
  };
  // Saved by itself a moment after the last change, like every setting
  const changed = values.name !== user.name || values.locale !== user.locale || values.timezone !== user.timezone;
  useEffect(() => {
    if (!changed) return;
    const timer = setTimeout(() => void save(), 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.name, values.locale, values.timezone, changed]);
  return (
    <section className="stack" aria-labelledby="profile-title">
      <h2 id="profile-title">{t("profile")}</h2>
      <AccountPhoto photo={photo} name={values.name || user.email} />
      <FormAlert>{error}</FormAlert>
      <form
        className="auth-form"
        ref={form}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label={t("name")}>
          {(p) => (
            <input {...p} type="text" required autoComplete="name" value={values.name} onChange={(e) => set({ name: e.target.value })} />
          )}
        </Field>
        <Field label={t("email")} hint={t("emailHint")}>
          {(p) => <input {...p} type="email" value={user.email} disabled />}
        </Field>
        <div className="grid2">
          <Field label={t("language")}>
            {(p) => <LocaleSelect {...p} value={values.locale} emptyLabel={t("languageAuto")} onChange={(locale) => set({ locale })} />}
          </Field>
          <Field label={t("timezone")}>
            {(p) => (
              <TimeZoneSelect {...p} value={values.timezone} emptyLabel={t("timezoneAuto")} onChange={(timezone) => set({ timezone })} />
            )}
          </Field>
        </div>
        <p className="hint save-status" role="status" aria-busy={busy}>
          {saved && !busy && !changed ? `✓ ${t("saved")}` : ""}
        </p>
      </form>
    </section>
  );
}

/** The person's photo: picked here, cropped to a square in the browser, put on their card in every workspace */
function AccountPhoto({ photo, name }: { photo: Props["photo"]; name: string }) {
  const t = useTranslations("account");
  const ta = useTranslations("avatar");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  // The new photo shows at once, before the page reloads it
  const [preview, setPreview] = useState<string | null>(null);
  const url = preview ?? (photo?.url ? withBasePath(photo.url) : null);
  const send = async (body: Blob | null) => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await fetch(withBasePath("/api/account/avatar"), {
        method: body ? "PUT" : "DELETE",
        body,
        headers: body ? { "Content-Type": body.type } : undefined,
      });
      if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? ta("notSaved"));
      setPreview(body ? URL.createObjectURL(body) : "");
      setStatus({ ok: true, text: body ? ta("saved") : ta("removed") });
      router.refresh();
    } catch (e) {
      setStatus({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="account-photo">
      <span
        className={`av account-av${url ? " img" : ""}`}
        style={{ "--c": `var(--c${(photo?.color ?? 0) % 6})` } as React.CSSProperties}
        aria-hidden="true"
      >
        {url ? <img src={url} alt="" /> : initials(name)}
      </span>
      <div className="account-photo-body">
        <strong>{t("photo")}</strong>
        {photo ? (
          <>
            <p className="hint">{t("photoHint")}</p>
            <div className="controls">
              <button type="button" className="btn sm" disabled={busy} aria-busy={busy} onClick={() => input.current?.click()}>
                {url ? ta("change") : ta("add")}
              </button>
              {url && (
                <button type="button" className="btn sm danger" disabled={busy} onClick={() => void send(null)}>
                  {ta("remove")}
                </button>
              )}
              <span className={status?.ok === false ? "hint failed" : "hint"} role="status">
                {status ? `${status.ok ? "✓ " : ""}${status.text}` : ""}
              </span>
            </div>
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                try {
                  await send(await squareImage(file));
                } catch {
                  setStatus({ ok: false, text: ta("unreadable") });
                }
              }}
            />
          </>
        ) : (
          <p className="hint">{t("photoNoWorkspace")}</p>
        )}
      </div>
    </div>
  );
}

function ChangePassword() {
  const t = useTranslations("account");
  const tAuth = useTranslations("auth");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 10) return setMessage({ tone: "error", text: tAuth("failure.weakPassword") });
    setBusy(true);
    setMessage(null);
    const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
    setBusy(false);
    if (error) return setMessage({ tone: "error", text: tAuth(`failure.${failureKey(error)}`) });
    setCurrent("");
    setNext("");
    setMessage({ tone: "ok", text: t("passwordChanged") });
  };
  return (
    <form className="auth-form" onSubmit={submit}>
      <FormAlert tone={message?.tone}>{message?.text}</FormAlert>
      <Field label={t("currentPassword")}>
        {(p) => (
          <PasswordInput {...p} autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        )}
      </Field>
      <Field label={t("newPassword")} hint={tAuth("passwordHint")}>
        {(p) => (
          <PasswordInput
            {...p}
            autoComplete="new-password"
            required
            minLength={10}
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        )}
      </Field>
      <div className="form-foot">
        <button type="submit" className="btn" disabled={busy} aria-busy={busy}>
          {t("changePassword")}
        </button>
      </div>
    </form>
  );
}

type TwoFactorStep =
  | { step: "idle" }
  | { step: "password"; action: "enable" | "disable" }
  | { step: "scan"; uri: string; codes: string[] }
  | { step: "codes"; codes: string[] };

function TwoFactor({ enabled: initial, hasPassword }: { enabled: boolean; hasPassword: boolean }) {
  const t = useTranslations("account");
  const tAuth = useTranslations("auth");
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial);
  const [state, setState] = useState<TwoFactorStep>({ step: "idle" });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fail = (e: { code?: string; status?: number; message?: string }) => setError(tAuth(`failure.${failureKey(e)}`));

  const confirmPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.step !== "password") return;
    setBusy(true);
    setError(null);
    if (state.action === "enable") {
      const { data, error } = await authClient.twoFactor.enable({ password });
      setBusy(false);
      if (error || !data || data.method !== "totp") return fail(error ?? {});
      setState({ step: "scan", uri: data.totpURI, codes: data.backupCodes });
    } else {
      const { error } = await authClient.twoFactor.disable({ password });
      setBusy(false);
      if (error) return fail(error);
      setEnabled(false);
      setState({ step: "idle" });
      router.refresh();
    }
    setPassword("");
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.step !== "scan") return;
    setBusy(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, "") });
    setBusy(false);
    if (error) return fail(error);
    setEnabled(true);
    setCode("");
    setState({ step: "codes", codes: state.codes });
  };

  const secret = state.step === "scan" ? (new URL(state.uri).searchParams.get("secret") ?? "") : "";
  return (
    <section className="stack" aria-labelledby="twofa-title">
      <div className="row-between">
        <h2 id="twofa-title">{t("twoFactor")}</h2>
        <span className={`st-pill ${enabled ? "st-done" : "st-open"}`}>{enabled ? t("twoFactorOn") : t("twoFactorOff")}</span>
      </div>
      <p className="hint">{hasPassword ? t("twoFactorHint") : t("twoFactorNeedsPassword")}</p>
      <FormAlert>{error}</FormAlert>
      {state.step === "idle" && hasPassword && (
        <button
          type="button"
          className={`btn ${enabled ? "danger" : ""}`}
          onClick={() => {
            setError(null);
            setState({ step: "password", action: enabled ? "disable" : "enable" });
          }}
        >
          {enabled ? t("disable") : t("enable")}
        </button>
      )}
      {state.step === "password" && (
        <form className="auth-form" onSubmit={confirmPassword}>
          <Field label={t("confirmPassword")}>
            {(p) => (
              <PasswordInput
                {...p}
                autoComplete="current-password"
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
          </Field>
          <div className="form-foot">
            <button type="button" className="btn" onClick={() => setState({ step: "idle" })}>
              {t("cancel")}
            </button>
            <button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>
              {t("continue")}
            </button>
          </div>
        </form>
      )}
      {state.step === "scan" && (
        <form className="auth-form" onSubmit={verify}>
          <p>{t("scan")}</p>
          {/* SVG generated locally from the TOTP URI: no external content */}
          <div className="qr" role="img" aria-label={t("scan")} dangerouslySetInnerHTML={{ __html: renderSVG(state.uri, { border: 2 }) }} />
          <p className="hint">
            {t("secret")} <code className="secret">{secret}</code>
          </p>
          <Field label={t("code")}>
            {(p) => (
              <input
                {...p}
                type="text"
                className="code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </Field>
          <div className="form-foot">
            <button type="button" className="btn" onClick={() => setState({ step: "idle" })}>
              {t("cancel")}
            </button>
            <button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>
              {t("confirm")}
            </button>
          </div>
        </form>
      )}
      {state.step === "codes" && (
        <div className="stack">
          <FormAlert tone="ok">{t("enabled")}</FormAlert>
          <h3>{t("backupCodes")}</h3>
          <p className="hint">{t("backupHint")}</p>
          <ul className="backup-codes">
            {state.codes.map((c) => (
              <li key={c}>
                <code>{c}</code>
              </li>
            ))}
          </ul>
          <div className="form-foot">
            <button
              type="button"
              className="btn"
              onClick={async () => {
                await navigator.clipboard.writeText(state.codes.join("\n"));
                setCopied(true);
              }}
            >
              {copied ? t("copied") : t("copyCodes")}
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setState({ step: "idle" });
                router.refresh();
              }}
            >
              {t("done")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
