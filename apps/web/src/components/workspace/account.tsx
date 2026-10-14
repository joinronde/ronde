"use client";

import { THEMES, type Theme } from "@ronde/core/appearance";
import type { WorkspaceRole } from "@ronde/core/permissions";
import { initials } from "@ronde/core/util";
import { formatters, type Locale } from "@ronde/i18n";
import { Modal } from "@ronde/ui/modal";
import {
  Bell,
  Building2,
  Cake,
  CalendarDays,
  Check,
  Database,
  Fingerprint,
  KeyRound,
  type LucideIcon,
  Mail,
  MonitorSmartphone,
  Palette,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { renderSVG } from "uqr";
import {
  deleteAccountAction,
  setBirthdayAction,
  setThemeAction,
  setUpgradeHintsAction,
  setWeeklySummaryAction,
  updateProfileAction,
} from "@/app/account/actions";
import { Field, FormAlert, PasswordInput } from "@/components/auth/fields";
import { PasskeyIcon } from "@/components/auth/sign-in-form";
import { Select } from "@/components/select";
import { Icon } from "@/components/shell/icons";
import { authClient, failureKey, passkeyDismissed } from "@/lib/auth-client";
import { withBasePath } from "@/lib/shared/base-path";
import { passwordStrength } from "@/lib/shared/password";
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
const TABS: { id: AccountTab; href: string; icon: LucideIcon }[] = [
  { id: "profile", href: "/account", icon: UserRound },
  { id: "security", href: "/account/security", icon: ShieldCheck },
  { id: "notifications", href: "/account/notifications", icon: Bell },
  { id: "workspaces", href: "/account/workspaces", icon: Building2 },
];

/**
 * The banner of the account: Ronde's round table drawn large, its seats round the ring and the arc of whoever has
 * the floor, smaller tables farther off, over the accent's gradient
 */
function AccountCover() {
  const seats = (cx: number, cy: number, r: number, n: number, dot: number, lit: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return <circle key={i} cx={cx + Math.cos(a) * r} cy={cy + Math.sin(a) * r} r={dot} className={i === lit ? "on" : undefined} />;
    });
  const arc = (cx: number, cy: number, r: number, from: number, to: number) => {
    const pt = (deg: number) => {
      const a = ((deg - 90) * Math.PI) / 180;
      return `${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`;
    };
    return `M${pt(from)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${pt(to)}`;
  };
  return (
    <svg className="account-cover" viewBox="0 0 800 72" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">
      <g className="ac-table big">
        <circle cx="692" cy="36" r="24" className="ac-ring" />
        <path d={arc(692, 36, 24, 0, 140)} className="ac-arc" />
        {seats(692, 36, 24, 8, 4.2, 3)}
      </g>
      <g className="ac-table">
        <circle cx="606" cy="48" r="14" className="ac-ring" />
        <path d={arc(606, 48, 14, 200, 320)} className="ac-arc" />
        {seats(606, 48, 14, 6, 2.8, 5)}
      </g>
      <g className="ac-table small">
        <circle cx="764" cy="17" r="9" className="ac-ring" />
        {seats(764, 17, 9, 5, 1.9, 1)}
      </g>
      <g className="ac-table small">
        <circle cx="540" cy="20" r="8" className="ac-ring" />
        {seats(540, 20, 8, 4, 1.7, 2)}
      </g>
      <g className="ac-sparks">
        <circle cx="650" cy="10" r="1.8" />
        <circle cx="572" cy="62" r="1.5" />
        <circle cx="742" cy="60" r="2" />
        <circle cx="500" cy="48" r="1.3" />
      </g>
    </svg>
  );
}

/** Top of every account page: who is signed in, and the account's pages as tabs */
export function AccountHeader({ user, photo }: { user: { name: string; email: string }; photo: Props["photo"] }) {
  const t = useTranslations("account");
  const path = usePathname();
  return (
    <header className="page-head account-head">
      <AccountCover />
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
            <tab.icon size={16} strokeWidth={2} aria-hidden="true" />
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
  birthday,
}: Props & {
  theme: Theme;
  /** Suggestions of the paid plans shown (null: not offered to this person) */
  upgradeHints: boolean | null;
  /** "MM-DD" or null; undefined: none of the person's meetings celebrates birthdays, the field is not offered */
  birthday?: string | null;
}) {
  return (
    <>
      <Profile user={user} photo={photo} />
      {birthday !== undefined && <Birthday initial={birthday} />}
      <ThemePicker initial={theme} />
      {upgradeHints !== null && <UpgradeHintsSwitch initial={upgradeHints} />}
      <YourData email={user.email} />
    </>
  );
}

/** The person's birthday, day and month only: on their card in every workspace, for the meetings that celebrate it */
function Birthday({ initial }: { initial: string | null }) {
  const t = useTranslations("account");
  const tPeople = useTranslations("people");
  const locale = useLocale();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [month, day] = (value ?? "-").split("-");
  const months = Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1).padStart(2, "0"),
    label: new Date(2024, i, 1).toLocaleDateString(locale, { month: "long" }),
  }));
  const days = Array.from({ length: daysIn(month ?? "") }, (_, i) => String(i + 1).padStart(2, "0"));
  const save = async (m: string, d: string) => {
    const next = m && d ? `${m}-${d}` : null;
    setValue(next);
    setSaved(false);
    const res = await setBirthdayAction(next);
    setError(res.ok ? null : res.error);
    setSaved(res.ok);
  };
  return (
    <section className="stack acct-card" aria-labelledby="birthday-title">
      <h2 id="birthday-title" className="acct-title">
        <span className="acct-ico" aria-hidden="true">
          <Cake size={18} strokeWidth={2} />
        </span>
        {t("birthday")}
      </h2>
      <p className="hint">{t("birthdayHint")}</p>
      <FormAlert>{error}</FormAlert>
      <div className="birthday-pick">
        <Select
          aria-label={tPeople("month")}
          value={month ?? ""}
          onChange={(e) => void save(e.target.value, e.target.value ? (day && Number(day) <= daysIn(e.target.value) ? day : "01") : "")}
        >
          <option value="">—</option>
          {months.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
        <Select aria-label={tPeople("day")} value={day ?? ""} disabled={!month} onChange={(e) => void save(month ?? "", e.target.value)}>
          <option value="">—</option>
          {days.map((d) => (
            <option key={d} value={d}>
              {Number(d)}
            </option>
          ))}
        </Select>
        {saved && (
          <span className="save-ok" role="status">
            <Check size={14} strokeWidth={2.6} aria-hidden="true" /> {t("saved")}
          </span>
        )}
      </div>
    </section>
  );
}

/** Days in a month of a leap year ("02" has 29: a birthday on the 29th of February is kept) */
const daysIn = (month: string) => (month === "02" ? 29 : ["04", "06", "09", "11"].includes(month) ? 30 : 31);

/** The person's data: all of it as a file, and the account deleted for good */
function YourData({ email }: { email: string }) {
  const t = useTranslations("account");
  const [deleting, setDeleting] = useState(false);
  return (
    <section className="stack acct-card danger-zone" aria-labelledby="data-title">
      <h2 id="data-title" className="acct-title">
        <span className="acct-ico" aria-hidden="true">
          <Database size={18} strokeWidth={2} />
        </span>
        {t("data.title")}
      </h2>
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
      <section className="stack acct-card" aria-labelledby="password-title">
        <h2 id="password-title" className="acct-title">
          <span className="acct-ico" aria-hidden="true">
            <KeyRound size={18} strokeWidth={2} />
          </span>
          {t("password")}
        </h2>
        {hasPassword ? <ChangePassword /> : <p className="hint">{t("noPassword")}</p>}
      </section>
      <Passkeys initial={passkeys} />
      <TwoFactor enabled={twoFactorEnabled} hasPassword={hasPassword} />
      <section className="stack acct-card" aria-labelledby="sessions-title">
        <h2 id="sessions-title" className="acct-title">
          <span className="acct-ico" aria-hidden="true">
            <MonitorSmartphone size={18} strokeWidth={2} />
          </span>
          {t("sessions")}
        </h2>
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
      <section className="stack acct-card" aria-labelledby="calendar-title">
        <h2 id="calendar-title" className="acct-title">
          <span className="acct-ico" aria-hidden="true">
            <CalendarDays size={18} strokeWidth={2} />
          </span>
          {t("calendar")}
        </h2>
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
    <section className="stack acct-card" aria-labelledby="workspaces-title">
      <h2 id="workspaces-title" className="acct-title">
        <span className="acct-ico" aria-hidden="true">
          <Building2 size={18} strokeWidth={2} />
        </span>
        {t("workspaces")}
      </h2>
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
    <section className="stack acct-card" aria-labelledby="passkeys-title">
      <div className="row-between">
        <h2 id="passkeys-title" className="acct-title">
          <span className="acct-ico" aria-hidden="true">
            <Fingerprint size={18} strokeWidth={2} />
          </span>
          {t("passkeys")}
        </h2>
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
    <section className="stack acct-card" aria-labelledby="weekly-title">
      <h2 id="weekly-title" className="acct-title">
        <span className="acct-ico" aria-hidden="true">
          <Mail size={18} strokeWidth={2} />
        </span>
        {t("weeklyTitle")}
      </h2>
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
    <section className="stack acct-card" aria-labelledby="hints-title">
      <h2 id="hints-title" className="acct-title">
        <span className="acct-ico" aria-hidden="true">
          <Sparkles size={18} strokeWidth={2} />
        </span>
        {t("upgradeHints")}
      </h2>
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
    <section className="stack acct-card" id="appearance" aria-labelledby="appearance-title">
      <h2 id="appearance-title" className="acct-title">
        <span className="acct-ico" aria-hidden="true">
          <Palette size={18} strokeWidth={2} />
        </span>
        {t("appearance")}
      </h2>
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
    <section className="stack acct-card" aria-labelledby="profile-title">
      <h2 id="profile-title" className="acct-title">
        <span className="acct-ico" aria-hidden="true">
          <UserRound size={18} strokeWidth={2} />
        </span>
        {t("profile")}
      </h2>
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
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const strength = passwordStrength(next);
  // Typed twice: a slip in a field that hides what is typed would lock the person out
  const mismatch = again.length > 0 && again !== next;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 10) return setMessage({ tone: "error", text: tAuth("failure.weakPassword") });
    if (next !== again) return setMessage({ tone: "error", text: t("passwordMismatch") });
    setBusy(true);
    setMessage(null);
    const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
    setBusy(false);
    if (error) return setMessage({ tone: "error", text: tAuth(`failure.${failureKey(error)}`) });
    setCurrent("");
    setNext("");
    setAgain("");
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
      <div className="grid2">
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
        <Field label={t("newPasswordAgain")} error={mismatch ? t("passwordMismatch") : null}>
          {(p) => <PasswordInput {...p} autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />}
        </Field>
      </div>
      {next && (
        <div className={`pw-meter s${strength}`} role="status">
          <span className="pw-bars" aria-hidden="true">
            {[1, 2, 3, 4].map((i) => (
              <i key={i} className={i <= strength ? "on" : undefined} />
            ))}
          </span>
          <span>{t(`passwordStrength.${strength}` as "passwordStrength.0")}</span>
          {again && !mismatch && (
            <span className="pw-match">
              <Check size={14} strokeWidth={2.6} aria-hidden="true" /> {t("passwordMatch")}
            </span>
          )}
        </div>
      )}
      <div className="form-foot">
        <button type="submit" className="btn primary" disabled={busy || mismatch || !again} aria-busy={busy}>
          <KeyRound size={16} strokeWidth={2} aria-hidden="true" /> {t("changePassword")}
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
    <section className="stack acct-card" aria-labelledby="twofa-title">
      <div className="row-between">
        <h2 id="twofa-title" className="acct-title">
          <span className="acct-ico" aria-hidden="true">
            <ShieldCheck size={18} strokeWidth={2} />
          </span>
          {t("twoFactor")}
        </h2>
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
