"use client";

import { ACCENTS, type Accent } from "@ronde/core/appearance";
import { reminderEmail } from "@ronde/core/notifications";
import { describeSchedule } from "@ronde/core/schedule";
import type { MemberDTO, SectionDef, SectionRole, SectionType, SettingsDTO } from "@ronde/core/types";
import { fmtMinutes, hostName, lines, mmssPlain, ROLE_KIND, reminderDate, SECTION_ROLES, SECTION_TYPES } from "@ronde/core/util";
import { formatters, type Locale, localeNames, locales } from "@ronde/i18n";
import {
  Bell,
  BookOpen,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  Clapperboard,
  CloudCheck,
  Eye,
  FolderKanban,
  Handshake,
  Info,
  LayoutTemplate,
  ListChecks,
  ListOrdered,
  LoaderCircle,
  Lock,
  type LucideIcon,
  MessageCircle,
  Palette,
  Plug,
  Puzzle,
  SlidersHorizontal,
  TriangleAlert,
  Users,
  Video,
  X,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { createVideoRoomAction } from "@/app/w/[ws]/actions";
import { DurationField } from "@/components/duration-field";
import { Select } from "@/components/select";
import { withBasePath } from "@/lib/shared/base-path";
import { forgeOrigins, videoOrigin } from "@/lib/shared/integration-origin";
import { moved } from "@/lib/shared/sortable";
import { AgendaPanel, PokerSettings, RetroSettings } from "./agenda-panel";
import { squareImage } from "./avatar-picker";
import { CalendarSyncPanel } from "./calendar-sync-panel";
import { useConnectionLabel } from "./forge-connections";
import { ForgeSources } from "./forge-sources";
import { GuestLinksPanel } from "./guest-links-panel";
import { type IntegrationItem, IntegrationsHub } from "./integrations-hub";
import { MeetingMark } from "./meeting-mark";
import { MeetingProjectsPanel } from "./meeting-projects-panel";
import { MeetingWikiPanel } from "./meeting-wiki-panel";
import { ModulesPanel } from "./modules-panel";
import { NotificationsPanel } from "./notifications-panel";
import { NotificationsPreview } from "./notifications-preview";
import { useRonde } from "./ronde-provider";
import { SchedulePanel } from "./schedule-panel";
import { NewTab } from "./shell/new-tab";
import { SortGrip, useSortable } from "./sortable";
import { Avatar } from "./stage";
import { ToolMark } from "./tool-mark";

export function SettingsView() {
  const t = useTranslations("settings");
  const { s, host } = useRonde();
  if (!s.viewer.isAdmin)
    return (
      <div className="emptybox">
        <h3>{t("hostOnlyTitle", { host })}</h3>
        <p>{t.rich("hostOnlyBody", { code: (chunks) => <code>{chunks}</code> })}</p>
      </div>
    );
  return <SettingsForm initial={s.settings} />;
}

type SaveStatus = "idle" | "pending" | "saving" | "saved" | "invalid" | "failed";

const SETTINGS_CATEGORIES = [
  "general",
  "schedule",
  "people",
  "sections",
  "agenda",
  "projects",
  "modules",
  "appearance",
  "notifications",
  "integrations",
  "template",
  "danger",
] as const;
type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];
/** What each category is about, at a glance in the side navigation */
const CATEGORY_ICONS: Record<SettingsCategory, LucideIcon> = {
  general: SlidersHorizontal,
  schedule: CalendarClock,
  people: Users,
  sections: ListChecks,
  agenda: ListOrdered,
  projects: FolderKanban,
  modules: Puzzle,
  appearance: Palette,
  notifications: Bell,
  integrations: Plug,
  template: LayoutTemplate,
  danger: TriangleAlert,
};
const isCategory = (v: string): v is SettingsCategory => (SETTINGS_CATEGORIES as readonly string[]).includes(v);

/** Key of a new section, picked here so it stays the same from one save to the next */
const newSectionKey = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("");

/** Settings by category, with a side navigation (a row of tabs on phones) and the save status */
function SettingsLayout({
  categories,
  status,
  onUndo,
}: {
  categories: { id: SettingsCategory; nodes: React.ReactNode[] }[];
  status: SaveStatus;
  onUndo?: () => void;
}) {
  const t = useTranslations("settings");
  const [current, setCurrent] = useState<SettingsCategory>("general");
  // The category is in the address: #sections opens it, and links can point at it
  useEffect(() => {
    const read = () => {
      const h = window.location.hash.slice(1);
      if (isCategory(h)) setCurrent(h);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  const open = (id: SettingsCategory) => {
    setCurrent(id);
    history.replaceState(null, "", `#${id}`);
  };
  const shown = categories.find((c) => c.id === current) ?? categories[0]!;
  return (
    <div className="cfg-layout">
      <nav className="cfg-nav" aria-label={t("nav.label")}>
        <ul>
          {categories.map((c) => (
            <li key={c.id} className={c.id === "danger" ? "cfg-danger" : undefined}>
              <button type="button" aria-current={c.id === shown.id ? "page" : undefined} onClick={() => open(c.id)}>
                {(() => {
                  const NavIcon = CATEGORY_ICONS[c.id];
                  return <NavIcon className="cfg-ico" size={17} strokeWidth={2} aria-hidden="true" />;
                })()}
                <span>{t(`nav.${c.id}`)}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="cfg-main">
        <header className="cfg-head">
          {(() => {
            const HeadIcon = CATEGORY_ICONS[shown.id];
            return (
              <span className={`cfg-head-ico${shown.id === "danger" ? " danger" : ""}`} aria-hidden="true">
                <HeadIcon size={22} strokeWidth={2} />
              </span>
            );
          })()}
          <div>
            <h2 className="cfg-title">{t(`nav.${shown.id}`)}</h2>
            <p className="hint">{t(`navHints.${shown.id}`)}</p>
          </div>
          {/* The save status at the end of the header's row: the header starts level with the side navigation */}
          <div className={`cfg-status is-${status}`} role="status" aria-live="polite">
            {status === "saving" || status === "pending" ? (
              <LoaderCircle className="cfg-spin" size={15} strokeWidth={2.2} aria-hidden="true" />
            ) : status === "saved" ? (
              <CircleCheck size={15} strokeWidth={2.2} aria-hidden="true" />
            ) : status === "invalid" || status === "failed" ? (
              <CircleAlert size={15} strokeWidth={2.2} aria-hidden="true" />
            ) : (
              <CloudCheck size={15} strokeWidth={2} aria-hidden="true" />
            )}
            {status === "saving" || status === "pending"
              ? t("status.saving")
              : status === "saved"
                ? t("status.saved")
                : status === "invalid"
                  ? t("status.invalid")
                  : status === "failed"
                    ? t("status.failed")
                    : t("status.auto")}
            {status === "saved" && onUndo && (
              <button type="button" className="linkbtn" onClick={onUndo}>
                {t("status.undo")}
              </button>
            )}
          </div>
        </header>
        <div className="cfg-panels">
          {shown.nodes.filter(Boolean).map((n, i) => (
            <Fragment key={`${shown.id}-${i}`}>{n}</Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Emojis offered for a meeting: the templates' own first, then a few for the usual kinds of teams */
const ICONS = [
  "🔁",
  "☀️",
  "🔍",
  "🤝",
  "🚀",
  "🎯",
  "📊",
  "🧭",
  "🛠️",
  "💡",
  "📣",
  "🎨",
  "🧪",
  "📚",
  "🌱",
  "🏗️",
  "🩺",
  "🎓",
  "💬",
  "⭐",
  "🔥",
  "🌍",
  "🏆",
  "🧩",
];

/** The meeting's mark in the menus and lists: an emoji, or its own image (a logo, a team photo); saved at once */
function IconPanel() {
  const t = useTranslations("settings");
  const { s, rpc, toast } = useRonde();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [other, setOther] = useState("");
  const mark = { id: s.context.meetingId, name: s.settings.teamName, icon: s.settings.icon, image: s.settings.image };
  const pick = (icon: string) => rpc({ op: "meeting.icon", icon }, t("icon.saved"));
  const send = async (method: "PUT" | "DELETE", body?: Blob) => {
    setBusy(true);
    try {
      const r = await fetch(`${s.context.api}/image`, { method, body, headers: body ? { "Content-Type": body.type } : undefined });
      if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? t("icon.notSaved"));
      toast(method === "PUT" ? t("icon.imageSaved") : t("icon.imageRemoved"), "ok");
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="panel form icon-panel">
      <h3 style={{ margin: 0 }}>{t("icon.title")}</h3>
      <p className="hint" style={{ margin: 0 }}>
        {t("icon.hint")}
      </p>
      <div className="icon-row">
        <MeetingMark slug={s.context.workspace.slug} meeting={mark} className="mt-mark icon-preview" letters={2} />
        <div className="icon-actions">
          <button type="button" className="btn" onClick={() => file.current?.click()} disabled={busy} aria-busy={busy}>
            {s.settings.image ? t("icon.changeImage") : t("icon.upload")}
          </button>
          {s.settings.image && (
            <button type="button" className="btn danger" onClick={() => send("DELETE")} disabled={busy}>
              {t("icon.removeImage")}
            </button>
          )}
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={async (e) => {
              const picked = e.target.files?.[0];
              e.target.value = "";
              if (!picked) return;
              try {
                await send("PUT", await squareImage(picked));
              } catch {
                toast(t("icon.notSaved"), "error");
              }
            }}
          />
        </div>
      </div>
      {s.settings.image && (
        <p className="hint" style={{ margin: 0 }}>
          {t("icon.imageFirst")}
        </p>
      )}
      <div className="emoji-pick" role="group" aria-label={t("icon.emoji")}>
        <button
          type="button"
          className="emoji-initials"
          aria-pressed={!s.settings.icon}
          onClick={() => pick("")}
          title={t("icon.initials")}
        >
          {t("icon.initialsShort")}
        </button>
        {ICONS.map((e) => (
          <button key={e} type="button" aria-pressed={s.settings.icon === e} onClick={() => pick(e)}>
            {e}
          </button>
        ))}
      </div>
      <form
        className="emoji-other"
        onSubmit={async (e) => {
          e.preventDefault();
          if (other.trim() && (await pick(other.trim()))) setOther("");
        }}
      >
        <input
          type="text"
          value={other}
          maxLength={16}
          onChange={(e) => setOther(e.target.value)}
          aria-label={t("icon.other")}
          placeholder={t("icon.otherPlaceholder")}
        />
        <button type="submit" className="btn" disabled={!other.trim()}>
          {t("icon.use")}
        </button>
      </form>
    </div>
  );
}

/** Accent colour of the meeting: its buttons, the timer and the shared screen */
function AppearancePanel({ accent, onAccent }: { accent: Accent; onAccent: (a: Accent) => void }) {
  const t = useTranslations("settings");
  return (
    <div className="panel form">
      <h3 style={{ margin: 0 }}>{t("appearance.accent")}</h3>
      <p className="hint" style={{ margin: 0 }}>
        {t("appearance.accentHint")}
      </p>
      {/* Each colour as it will look: the shared screen's bar, timer and button, in miniature */}
      <div className="accent-pick" role="radiogroup" aria-label={t("appearance.accent")}>
        {ACCENTS.map((a) => (
          <label key={a} className="accent-card" data-swatch={a}>
            <input type="radio" name="accent" value={a} checked={accent === a} onChange={() => onAccent(a)} />
            <span className="accent-preview" aria-hidden="true">
              <i className="ap-bar" />
              <i className="ap-ring" />
              <i className="ap-lines" />
              <i className="ap-btn" />
            </span>
            <span className="accent-name">
              <span className="dot" aria-hidden="true" />
              {t(`appearance.accents.${a}`)}
              {accent === a && <Check size={15} strokeWidth={2.6} aria-hidden="true" className="accent-check" />}
            </span>
          </label>
        ))}
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {t("appearance.themeHint")}{" "}
        <Link href="/account#appearance" className="link">
          {t("appearance.themeLink")}
        </Link>
      </p>
    </div>
  );
}

/** Video call: a free link, a Jitsi room, or a BigBlueButton room opened by Ronde */
function VideoPanel() {
  const t = useTranslations("settings");
  const { s, rpc, toast } = useRonde();
  const v = s.settings.video;
  const [creating, setCreating] = useState(false);
  const [provider, setProvider] = useState(v.provider);
  const [link, setLink] = useState(v.link);
  const [jitsiUrl, setJitsiUrl] = useState(v.jitsiUrl);
  const [bbbUrl, setBbbUrl] = useState(v.bbbUrl);
  const [bbbAccount, setBbbAccount] = useState(v.bbbAccount);
  const [secret, setSecret] = useState<string | null>(null);
  // The workspace's BigBlueButton servers; the others create rooms
  const bbbServers = s.videoAccounts.filter((a) => a.kind === "bbb");
  const roomMakers = s.videoAccounts.filter((a) => a.kind !== "bbb");
  // The server picked, as saved: one removed meanwhile (or by another host) is let go here too
  useEffect(() => setBbbAccount(v.bbbAccount), [v.bbbAccount]);
  const pickedServer = bbbServers.some((a) => a.id === bbbAccount) ? bbbAccount : "";
  // A server of the meeting's own is set by an administrator; the others keep the one set, or pick the workspace's
  const ownServer = s.integrations.ownVideoServer || !!v.bbbUrl;
  const [done, setDone] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  /** The call as set here; the BigBlueButton secret only on demand, never half typed */
  const persist = async (withSecret: boolean) => {
    if (!form.current?.checkValidity()) return;
    const ok = await rpc({
      op: "video.configure",
      provider,
      link: link.trim(),
      jitsiUrl: jitsiUrl.trim(),
      bbbAccount: pickedServer,
      // Kept while a server of the workspace is picked: going back to it needs no administrator
      bbbUrl: bbbUrl.trim(),
      ...(withSecret && secret !== null ? { secret: secret.trim() } : {}),
    });
    if (!ok) return;
    setDone(true);
    if (withSecret) setSecret(null);
  };
  // Saved by itself a moment after the last change, a room created from an account included
  const changed =
    provider !== v.provider ||
    link.trim() !== v.link ||
    jitsiUrl.trim() !== v.jitsiUrl ||
    pickedServer !== v.bbbAccount ||
    bbbUrl.trim() !== v.bbbUrl;
  useEffect(() => {
    if (!changed) return;
    setDone(false);
    const timer = setTimeout(() => void persist(false), 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, link, jitsiUrl, bbbUrl, pickedServer, changed]);
  const saved = provider === v.provider;
  return (
    <form
      className="panel form"
      ref={form}
      onSubmit={(e) => {
        e.preventDefault();
        void persist(true);
      }}
    >
      <h3 style={{ margin: 0 }}>{t("video.title")}</h3>
      <div className="field">
        <label htmlFor="vProvider">{t("video.provider")}</label>
        <Select
          id="vProvider"
          value={provider}
          onChange={(e) => {
            const next = e.target.value as typeof provider;
            setProvider(next);
            // BigBlueButton on the workspace's first server, unless the meeting has one of its own
            if (next === "bbb" && !bbbAccount && !v.bbbUrl && bbbServers[0]) setBbbAccount(bbbServers[0].id);
          }}
        >
          {(["link", "jitsi", "bbb"] as const).map((p) => (
            <option key={p} value={p}>
              {t(`video.providers.${p}`)}
            </option>
          ))}
        </Select>
      </div>
      {provider === "link" && roomMakers.length > 0 && (
        <div className="video-rooms">
          <span className="hint">{t("video.createWith")}</span>
          {roomMakers.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`btn sm video-room ${a.kind}`}
              disabled={creating}
              aria-busy={creating}
              onClick={async () => {
                setCreating(true);
                const res = await createVideoRoomAction(s.context.workspace.slug, s.context.meetingId, a.id);
                setCreating(false);
                if (!res.ok) return toast(res.error, "error");
                setLink(res.data);
                toast(t("video.roomCreated"), "ok");
              }}
            >
              {a.name === t(`video.kinds.${a.kind}`) ? a.name : `${t(`video.kinds.${a.kind}`)} · ${a.name}`}
            </button>
          ))}
        </div>
      )}
      {provider === "link" && (
        <div className="field">
          <label htmlFor="vLink">{t("video.link")}</label>
          <input
            id="vLink"
            type="url"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://meet.example.com/our-team"
          />
          <span className="hint">{t("video.linkHint")}</span>
        </div>
      )}
      {provider === "jitsi" && (
        <div className="field">
          <label htmlFor="vJitsi">{t("video.jitsiUrl")}</label>
          <input id="vJitsi" type="url" value={jitsiUrl} onChange={(e) => setJitsiUrl(e.target.value)} placeholder="https://meet.jit.si" />
          <span className="hint">{t("video.jitsiHint")}</span>
        </div>
      )}
      {provider === "bbb" && bbbServers.length > 0 && (
        <div className="field">
          <label htmlFor="vBbbServer">{t("video.server")}</label>
          <Select
            id="vBbbServer"
            // A server removed meanwhile is not shown as another one
            value={pickedServer}
            onChange={(e) => setBbbAccount(e.target.value)}
          >
            {bbbServers.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
            {ownServer && <option value="">{t("video.ownServer")}</option>}
          </Select>
          <span className="hint">{t("video.serverHint")}</span>
        </div>
      )}
      {provider === "bbb" && !pickedServer && !ownServer && <div className="note-box">{t("video.serverHint")}</div>}
      {provider === "bbb" && !pickedServer && ownServer && (
        <>
          <div className="field">
            <label htmlFor="vBbb">{t("video.bbbUrl")}</label>
            <input
              id="vBbb"
              type="url"
              required
              value={bbbUrl}
              // Kept as an administrator set it
              readOnly={!s.integrations.ownVideoServer}
              onChange={(e) => setBbbUrl(e.target.value)}
              placeholder="https://bbb.example.com/bigbluebutton"
            />
          </div>
          <TokenField
            id="vSecret"
            label={t("video.bbbSecret")}
            saved={s.settings.tokensSet.bbb}
            value={secret}
            onChange={setSecret}
            placeholder="…"
            locked={!s.integrations.secrets}
          />
          <span className="hint">{t("video.bbbHint")}</span>
        </>
      )}
      {saved && s.settings.videoUrl && (
        <p className="hint">
          {t("video.current")}{" "}
          <a href={s.settings.videoUrl} target="_blank" rel="noopener" className="link">
            {provider === "bbb" ? t("video.tryIt") : s.settings.videoUrl}
            <NewTab />
          </a>
        </p>
      )}
      <div className="form-foot">
        {secret !== null && (
          <button type="submit" className="btn primary">
            {t("video.save")}
          </button>
        )}
        <span className="hint save-status" role="status">
          {done && !changed && secret === null ? `✓ ${t("saved")}` : ""}
        </span>
      </div>
    </form>
  );
}

function IntegrationsHint() {
  const t = useTranslations("settings");
  return <div className="note-box">{t("sources.turnOn")}</div>;
}

/** Deleting the meeting: it leaves every list and page; the name is typed to confirm */
function DangerZone() {
  const t = useTranslations("settings");
  const { s, rpc } = useRonde();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!s.viewer.isAdmin) return null;
  return (
    <form
      className="panel form danger-zone"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        if (await rpc({ op: "meeting.remove", confirm: text })) window.location.assign(withBasePath(`/w/${s.context.workspace.slug}`));
        else setBusy(false);
      }}
    >
      <h3 style={{ margin: 0 }}>{t("danger.title")}</h3>
      <p className="hint" style={{ margin: 0 }}>
        {t("danger.hint")}
      </p>
      <div className="field">
        <label htmlFor="removeConfirm">
          {t.rich("danger.confirm", { name: s.settings.teamName, strong: (c) => <strong className="confirm-name">{c}</strong> })}
        </label>
        <input id="removeConfirm" type="text" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      <div>
        <button type="submit" className="btn danger-solid" disabled={busy || text.trim() !== s.settings.teamName.trim()} aria-busy={busy}>
          {t("danger.remove")}
        </button>
      </div>
    </form>
  );
}

function SettingsForm({ initial }: { initial: SettingsDTO }) {
  const t = useTranslations("settings");
  const tForges = useTranslations("forges");
  const connectionLabel = useConnectionLabel();
  const tSections = useTranslations("sections");
  const locale = useLocale();
  const { rpc, s } = useRonde();
  const isAdmin = s.viewer.isAdmin;
  const [f, setF] = useState({
    ...initial,
    meetingLocale: (initial.meetingLocale ?? "") as Locale | "",
    announcementsText: initial.announcements.join("\n"),
    icebreakersText: initial.icebreakers.join("\n"),
  });
  // Sections, in order; a new section has an empty key until it is saved
  const [secs, setSecs] = useState<SectionDef[]>(() => initial.sections.map((x) => ({ ...x })));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  // Everything but the GitLab access is saved by itself, a moment after the last change
  type Saved = { f: typeof f; secs: SectionDef[] };
  const snapshot = (): Saved => ({ f, secs });
  const [saved, setSaved] = useState<Saved>(() => ({ f, secs }));
  const [previous, setPrevious] = useState<Saved | null>(null);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const sig = (x: Saved) =>
    JSON.stringify([
      x.f.teamName,
      x.f.meetingLocale,
      x.f.hostLabel,
      x.f.speakSec,
      x.f.autoStart,
      x.f.targetMin,
      x.f.announcementsText,
      x.f.reminderEnabled,
      x.f.reminderWhen,
      x.f.reminderTime,
      x.f.icebreakersText,
      x.f.appearance,
      x.secs,
    ]);
  const saveCore = async (next: Saved, before: Saved) => {
    setStatus("saving");
    const ok = await rpc({
      op: "settings.save",
      teamName: next.f.teamName,
      locale: next.f.meetingLocale,
      hostLabel: next.f.hostLabel.trim(),
      speakSec: next.f.speakSec,
      autoStart: next.f.autoStart,
      targetMin: next.f.targetMin,
      announcements: lines(next.f.announcementsText),
      reminderEnabled: next.f.reminderEnabled,
      reminderWhen: next.f.reminderWhen,
      reminderTime: next.f.reminderTime,
      accent: next.f.appearance.accent,
      sections: next.secs.map((x) => ({
        key: x.key || undefined,
        label: x.label.trim(),
        role: x.role,
        input: x.input,
        carryPlans: !!x.carryPlans,
      })),
    });
    // Settings that belong to a module are saved by the module, when it is on
    const bank = lines(next.f.icebreakersText);
    const bankOk =
      !ok ||
      !s.modules.icebreaker ||
      bank.join("\n") === lines(before.f.icebreakersText).join("\n") ||
      (await rpc({ op: "icebreaker.configure", bank }));
    if (!ok || !bankOk) return setStatus("failed");
    setSaved(next);
    setPrevious(before);
    setStatus("saved");
  };
  const dirty = sig(snapshot()) !== sig(saved);
  // A pause in typing, valid fields: saved
  useEffect(() => {
    if (!dirty) return;
    setStatus("pending");
    const id = setTimeout(() => {
      const forms = [...document.querySelectorAll<HTMLFormElement>("form[data-cfg]")];
      if (forms.some((form) => !form.checkValidity()) || secs.some((x) => x.role === "custom" && !x.label.trim()))
        return setStatus("invalid");
      void saveCore(snapshot(), saved);
    }, 900);
    return () => clearTimeout(id);
  }, [sig(snapshot()), sig(saved)]);
  const undo = () => {
    if (!previous) return;
    setF(previous.f);
    setSecs(previous.secs);
    setPrevious(null);
  };
  // Enter in a field saves right away
  const submit = (e?: React.FormEvent) => {
    e?.preventDefault();
    for (const form of document.querySelectorAll<HTMLFormElement>("form[data-cfg]")) if (!form.reportValidity()) return;
    if (dirty) void saveCore(snapshot(), saved);
  };
  const meeting = (
    <form className="panel form" data-cfg onSubmit={submit}>
      <h3 style={{ margin: 0 }}>{t("meeting.title")}</h3>
      <div className="field">
        <label htmlFor="cTeam">{t("meeting.teamName")}</label>
        <input id="cTeam" type="text" required value={f.teamName} onChange={(e) => set("teamName", e.target.value)} />
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="cHost">{t("meeting.hostLabel")}</label>
          <input
            id="cHost"
            type="text"
            maxLength={50}
            value={f.hostLabel}
            onChange={(e) => set("hostLabel", e.target.value)}
            placeholder={hostName(null, locale)}
          />
          <span className="hint">{t("meeting.hostLabelHint", { host: hostName(f, locale) })}</span>
        </div>
        <div className="field">
          <label htmlFor="cLocale">{t("meeting.locale")}</label>
          <Select id="cLocale" value={f.meetingLocale} onChange={(e) => set("meetingLocale", e.target.value as Locale | "")}>
            <option value="">{t("meeting.localeWorkspace", { language: localeNames[f.meetingLocale ? f.locale : initial.locale] })}</option>
            {locales.map((l) => (
              <option key={l} value={l} lang={l}>
                {localeNames[l]}
              </option>
            ))}
          </Select>
          <span className="hint">{t("meeting.localeHint")}</span>
        </div>
      </div>
      <div className="grid3">
        <div className="field">
          <label htmlFor="cSpeak">{t("meeting.speakingTime")}</label>
          <DurationField
            id="cSpeak"
            value={f.speakSec}
            unit="seconds"
            presets={[30, 45, 60, 75, 90, 120, 150, 180, 240, 300, 420, 600, 900, 1200, 1800]}
            min={15}
            max={1800}
            format={(v) => t("meeting.perPerson", { time: mmssPlain(v * 1000) })}
            onChange={(v) => set("speakSec", v)}
            labels={{
              custom: t("meeting.otherDuration"),
              big: t("meeting.minutes"),
              small: t("meeting.seconds"),
              bigUnit: t("meeting.unitMin"),
              smallUnit: t("meeting.unitSec"),
              range: t("meeting.speakRange"),
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="cTarget">{t("meeting.target")}</label>
          <DurationField
            id="cTarget"
            value={f.targetMin}
            unit="minutes"
            presets={[10, 15, 20, 25, 30, 40, 45, 50, 60, 75, 90, 105, 120, 150, 180, 240, 300, 360, 480]}
            min={5}
            max={480}
            format={(v) => fmtMinutes(v, locale)}
            onChange={(v) => set("targetMin", v)}
            labels={{
              custom: t("meeting.otherDuration"),
              big: t("meeting.hours"),
              small: t("meeting.minutes"),
              bigUnit: t("meeting.unitH"),
              smallUnit: t("meeting.unitMin"),
              range: t("meeting.targetRange"),
            }}
          />
        </div>
        <div className="field field-check">
          <span className="lbl-s">{t("meeting.timer")}</span>
          <label className="check">
            <input type="checkbox" checked={f.autoStart} onChange={(e) => set("autoStart", e.target.checked)} /> {t("meeting.autoStart")}
          </label>
        </div>
      </div>
      <div className="field">
        <label htmlFor="cAnn">{t("meeting.announcements")}</label>
        <textarea
          id="cAnn"
          className="grow"
          value={f.announcementsText}
          onChange={(e) => set("announcementsText", e.target.value)}
          placeholder={t("onePerLine")}
        />
      </div>
    </form>
  );

  const typeSelect = (id: string, value: SectionType, onChange: (v: SectionType) => void, label: string) => (
    <Select
      id={id}
      aria-label={t("sections.inputOf", { label })}
      value={value}
      onChange={(e) => onChange(e.target.value as SectionType)}
      title={tSections(`types.${value}.hint`)}
    >
      {SECTION_TYPES.map((v) => (
        <option key={v} value={v}>
          {tSections(`types.${v}.label`)}
        </option>
      ))}
    </Select>
  );

  const defaultLabel = (role: SectionRole) =>
    role === "custom" ? t("sections.customPlaceholder") : tSections(`defaults.${ROLE_KIND[role]}`);
  const roleTaken = (role: SectionRole, i: number) => role !== "custom" && secs.some((x, j) => j !== i && x.role === role);
  const patchSec = (i: number, patch: Partial<SectionDef>) => setSecs(secs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const sortSecs = useSortable({ items: secs, keyOf: (x) => x.key, onMove: (from, to) => setSecs(moved(secs, from, to)) });
  // The plans that an achievement section can bring back: the section holding the "plan" role, if any
  const planSec = secs.find((x) => x.role === "plan");
  const sections = (
    <form className="panel form" data-cfg onSubmit={submit}>
      <ol className="sec-list">
        {sortSecs.list.map((x, i) => {
          const label = x.label.trim() || defaultLabel(x.role);
          const place = sortSecs.row(i);
          return (
            <li key={x.key || `new-${i}`} {...place} className={`sec-item ${place.className}`}>
              <div className="sec-row">
                <SortGrip {...sortSecs.grip(i, t("sections.reorder", { label }))} />
                <input
                  type="text"
                  aria-label={t("sections.nameOf", { n: i + 1 })}
                  maxLength={60}
                  required={x.role === "custom"}
                  value={x.label}
                  placeholder={defaultLabel(x.role)}
                  onChange={(e) => patchSec(i, { label: e.target.value })}
                />
                <Select
                  aria-label={t("sections.roleOf", { label })}
                  value={x.role}
                  onChange={(e) => {
                    const role = e.target.value as SectionRole;
                    patchSec(i, role === "achievement" ? { role } : { role, carryPlans: false });
                  }}
                >
                  {SECTION_ROLES.map((r) => (
                    <option key={r} value={r} disabled={roleTaken(r, i)}>
                      {t(`sections.roles.${r}.label`)}
                      {roleTaken(r, i) ? ` (${t("sections.taken")})` : ""}
                    </option>
                  ))}
                </Select>
                {typeSelect(
                  `sec_t${i}`,
                  x.input,
                  (v) => patchSec(i, v === "checklist" ? { input: v } : { input: v, carryPlans: false }),
                  label,
                )}
                <span className="sec-tools">
                  <button
                    type="button"
                    className="icon-btn danger"
                    aria-label={t("sections.removeOf", { label })}
                    disabled={secs.length === 1}
                    onClick={() => setSecs(secs.filter((_, j) => j !== i))}
                  >
                    <X size={14} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                </span>
              </div>
              <span className="hint">{t(`sections.roles.${x.role}.hint`)}</span>
              {x.role === "achievement" && planSec && (
                <label className={`sec-option${x.carryPlans ? " on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={!!x.carryPlans}
                    aria-describedby={`sec_carry${i}`}
                    onChange={(e) => patchSec(i, e.target.checked ? { carryPlans: true, input: "checklist" } : { carryPlans: false })}
                  />
                  <span>
                    <span className="sec-option-title">
                      {t("sections.carryPlans", { plan: planSec.label.trim() || defaultLabel("plan") })}
                    </span>
                    <span className="hint" id={`sec_carry${i}`}>
                      {t("sections.carryPlansHint")}
                      {x.input !== "checklist" && ` ${t("sections.carryPlansSwitch")}`}
                    </span>
                  </span>
                </label>
              )}
            </li>
          );
        })}
      </ol>
      {secs.length < 12 && (
        <div>
          <button
            type="button"
            className="btn"
            onClick={() =>
              setSecs([
                ...secs,
                {
                  key: newSectionKey(),
                  label: "",
                  role: SECTION_ROLES.find((r) => r !== "custom" && !secs.some((x) => x.role === r)) ?? "custom",
                  input: "list",
                },
              ])
            }
          >
            + {t("sections.add")}
          </button>
        </div>
      )}
      <ul className="hint type-help">
        {SECTION_TYPES.map((v) => (
          <li key={v}>
            <strong>{tSections(`types.${v}.label`)}</strong>: {tSections(`types.${v}.hint`)}.
          </li>
        ))}
      </ul>
      <span className="hint">{t("sections.hint")}</span>
    </form>
  );

  const reminder = (
    <form className="panel form" data-cfg onSubmit={submit}>
      <h3 style={{ margin: 0 }}>{t("reminder.title")}</h3>
      <div className="grid2">
        <div className="field">
          <label htmlFor="rDay">{t("reminder.when")}</label>
          <Select id="rDay" value={f.reminderWhen} onChange={(e) => set("reminderWhen", e.target.value as SettingsDTO["reminderWhen"])}>
            <option value="dayBefore">{t("reminder.dayBefore")}</option>
            <option value="sameDay">{t("reminder.sameDay")}</option>
          </Select>
        </div>
        <div className="field">
          <label htmlFor="rTime">{t("reminder.time")}</label>
          <input id="rTime" type="time" required value={f.reminderTime} onChange={(e) => set("reminderTime", e.target.value)} />
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={f.reminderEnabled} onChange={(e) => set("reminderEnabled", e.target.checked)} />{" "}
        {t("reminder.byEmail")}
      </label>
      <p className="hint" style={{ marginTop: -8 }}>
        {s.integrations.smtp ? t("reminder.emailHint") : t("reminder.noSmtp")}
      </p>
      <p className="hint" style={{ margin: 0 }}>
        {t("reminder.teamHint")}
      </p>
    </form>
  );

  const warmUp = s.modules.icebreaker && (
    <form className="panel form" data-cfg onSubmit={submit}>
      <h3 style={{ margin: 0 }}>{t("warmUp.icebreaker")}</h3>
      <div className="field">
        <label htmlFor="cIce">{t("warmUp.bank")}</label>
        <textarea
          id="cIce"
          className="grow"
          value={f.icebreakersText}
          onChange={(e) => set("icebreakersText", e.target.value)}
          placeholder={t("onePerLine")}
        />
        <span className="hint">{t("warmUp.bankHint")}</span>
      </div>
    </form>
  );

  const sources = isAdmin && s.modules.gitlab && <ForgeSources key="gitlab" kind="gitlab" />;
  const githubSources = isAdmin && s.modules.github && <ForgeSources key="github" kind="github" />;
  // Where each tool's access comes from: the workspace's, the meeting's own, the server's
  const forgeOrigin = (kind: "gitlab" | "github") =>
    forgeOrigins(s.settings.forges, kind)
      .map((o) => t(`hub.origin.${o}`))
      .join(" · ");
  const video = videoOrigin(s.settings.video, s.videoAccounts);
  const forgeState = (kind: "gitlab" | "github") => {
    const used = s.settings.forges[kind].sources;
    const names = used.map((u) => s.settings.forges.connections.find((c) => c.id === u.connection)).filter((c) => !!c);
    return names.length === 1 ? connectionLabel(names[0]) : tForges("hub.count", { count: names.length });
  };

  // Every tool the meeting works with, where it stands; GitLab, GitHub and the wiki are set up from their card
  const rulesOn = s.notifications?.rules.filter((r) => r.enabled).length ?? 0;
  const off = (goTo = "modules") => ({ state: "off" as const, stateText: t("hub.off"), goTo, goToLabel: t("hub.turnOn") });
  const integrations: IntegrationItem[] = [
    {
      id: "gitlab",
      name: "GitLab",
      mark: <ToolMark kind="gitlab" size={22} />,
      description: t("hub.gitlab"),
      ...(!s.modules.gitlab
        ? off()
        : {
            state: s.integrations.gitlab ? "on" : "todo",
            stateText: s.integrations.gitlab ? forgeState("gitlab") : t("hub.toConnect"),
            origin: s.integrations.gitlab ? forgeOrigin("gitlab") : undefined,
            panel: sources || <IntegrationsHint key="hint" />,
          }),
    },
    {
      id: "github",
      name: "GitHub",
      mark: <ToolMark kind="github" size={22} />,
      description: t("hub.github"),
      ...(!s.modules.github
        ? off()
        : {
            state: s.settings.forges.github.sources.length ? "on" : "todo",
            stateText: s.settings.forges.github.sources.length ? forgeState("github") : t("hub.toSetUp"),
            origin: s.settings.forges.github.sources.length ? forgeOrigin("github") : undefined,
            panel: githubSources || <IntegrationsHint key="hint" />,
          }),
    },
    {
      id: "wiki",
      name: t("hub.wikiName"),
      mark: <BookOpen size={22} strokeWidth={2} />,
      description: t("hub.wiki"),
      state: s.wikis?.current ? "on" : s.wikis?.list.length ? "todo" : "off",
      stateText: s.wikis?.current ? s.wikis.current.name : s.wikis?.list.length ? t("hub.toSetUp") : t("hub.noneInWorkspace"),
      origin: s.wikis?.current ? t("hub.origin.workspace") : undefined,
      panel: <MeetingWikiPanel key="wiki" />,
    },
    {
      id: "video",
      name: t("hub.videoName"),
      mark: <Video size={22} strokeWidth={2} />,
      description: t("hub.video"),
      ...(!s.modules.video
        ? off()
        : {
            state: s.settings.videoUrl ? "on" : "todo",
            stateText: !s.settings.videoUrl ? t("hub.toSetUp") : (video.server ?? t("hub.ready")),
            origin: s.settings.videoUrl ? t(`hub.origin.${video.origin}`) : undefined,
            goTo: "general",
            goToLabel: t("hub.goGeneral"),
          }),
    },
    {
      id: "calendar",
      name: t("hub.calendarName"),
      mark: <CalendarDays size={22} strokeWidth={2} />,
      description: t("hub.calendar"),
      state: s.calendars?.current ? "on" : "todo",
      stateText: s.calendars?.current ? t("hub.synced") : t("hub.toSetUp"),
      origin: s.calendars?.current
        ? t("hub.origin.workspaceNamed", { name: s.calendars.accounts.find((a) => a.id === s.calendars?.current)?.name ?? "" })
        : undefined,
      goTo: "schedule",
      goToLabel: t("hub.goSchedule"),
    },
    {
      id: "notifications",
      name: t("hub.notificationsName"),
      mark: <Bell size={22} strokeWidth={2} />,
      description: t("hub.notifications"),
      state: rulesOn ? "on" : "todo",
      stateText: rulesOn ? t("hub.rulesOn", { count: rulesOn }) : t("hub.toSetUp"),
      // Sent through the workspace's connectors
      origin: rulesOn ? t("hub.origin.workspace") : undefined,
      goTo: "notifications",
      goToLabel: t("hub.goNotifications"),
    },
  ];

  const categories: { id: SettingsCategory; nodes: React.ReactNode[] }[] = [
    { id: "general", nodes: [meeting, s.modules.video && <VideoPanel key="video" />, <TranscriptionPanel key="transcription" />, warmUp] },
    { id: "schedule", nodes: [<SchedulePanel key="schedule" />, <CalendarSyncPanel key="calendar" />, reminder] },
    { id: "people", nodes: [<ParticipantsPanel key="people" />, isAdmin && <GuestLinksPanel key="guests" />] },
    { id: "sections", nodes: [sections] },
    { id: "agenda", nodes: [<AgendaPanel key="agenda" />, <RetroSettings key="retro" />, <PokerSettings key="poker" />] },
    { id: "projects", nodes: [<MeetingProjectsPanel key="projects" />] },
    { id: "modules", nodes: [<ModulesPanel key="modules" />] },
    {
      id: "appearance",
      nodes: [
        <IconPanel key="icon" />,
        <AppearancePanel key="appearance" accent={f.appearance.accent} onAccent={(accent) => set("appearance", { accent })} />,
        s.brand.allowed && (
          <p key="logo" className="hint">
            {t("logoHint")}{" "}
            <Link href={`/w/${s.context.workspace.slug}/settings`} className="link">
              {t("logoLink")}
            </Link>
          </p>
        ),
      ],
    },
    {
      id: "notifications",
      nodes: [<NotificationsPanel key="notifications" />, <NotificationsPreview key="preview" reminder={<ReminderPreview />} />],
    },
    {
      id: "integrations",
      nodes: [<IntegrationsHub key="hub" items={integrations} />],
    },
    { id: "template", nodes: [<SaveTemplatePanel key="template" />] },
    { id: "danger", nodes: [<DangerZone key="danger" />] },
  ];
  return <SettingsLayout categories={categories} status={status} onUndo={previous ? undo : undefined} />;
}

/** Saves the meeting as a template of the workspace: sections, format, modules and schedule, without people or secrets */
function SaveTemplatePanel() {
  const t = useTranslations("settings");
  const locale = useLocale() as Locale;
  const { s, rpc } = useRonde();
  // What a template takes from this meeting, with this meeting's own values, and what stays here
  const sched = s.settings.schedule;
  const carries: { icon: LucideIcon; label: string; value: string }[] = [
    { icon: ListChecks, label: t("template.items.sections"), value: t("template.counts.sections", { count: s.settings.sections.length }) },
    { icon: ListOrdered, label: t("template.items.agenda"), value: t("template.counts.agenda", { count: s.settings.agenda.length }) },
    {
      icon: Puzzle,
      label: t("template.items.modules"),
      value: t("template.counts.modules", { count: Object.values(s.modules).filter(Boolean).length }),
    },
    {
      icon: CalendarClock,
      label: t("template.items.schedule"),
      value: describeSchedule(sched.rules, sched.meetingTimeZone ?? sched.timeZone, locale),
    },
  ];
  const stays = [
    t("template.items.people", { count: s.members.length + s.observers.length }),
    t("template.items.history"),
    t("template.items.tokens"),
  ];
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="panel form">
      <h3 style={{ margin: 0 }}>{t("template.title")}</h3>
      <p className="hint" style={{ margin: 0 }}>
        {t("template.intro")}
      </p>
      <div className="tpl-split">
        <section className="tpl-col" aria-labelledby="tplCarries">
          <h4 id="tplCarries">{t("template.carries")}</h4>
          <ul>
            {carries.map(({ icon: ItemIcon, label, value }) => (
              <li key={label}>
                <ItemIcon size={16} strokeWidth={2} aria-hidden="true" />
                <span>
                  <strong>{label}</strong>
                  <span className="hint">{value}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="tpl-col stays" aria-labelledby="tplStays">
          <h4 id="tplStays">{t("template.stays")}</h4>
          <ul>
            {stays.map((label) => (
              <li key={label}>
                <Lock size={15} strokeWidth={2} aria-hidden="true" />
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {open ? (
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            const ok = await rpc({ op: "template.save", name, description, icon: "" }, t("template.saved"));
            setBusy(false);
            if (ok) {
              setOpen(false);
              setName("");
              setDescription("");
            }
          }}
        >
          <div className="field">
            <label htmlFor="tplName">{t("template.name")}</label>
            <input
              id="tplName"
              type="text"
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={s.settings.teamName}
            />
          </div>
          <div className="field">
            <label htmlFor="tplDescription">{t("template.description")}</label>
            <input id="tplDescription" type="text" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="controls">
            <button type="submit" className="btn primary" disabled={busy || !name.trim()} aria-busy={busy}>
              {t("template.save")}
            </button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              {t("template.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div>
          <button type="button" className="btn primary" onClick={() => setOpen(true)}>
            <LayoutTemplate size={16} strokeWidth={2} aria-hidden="true" />
            {t("template.open")}
          </button>
        </div>
      )}
    </div>
  );
}

/** Access token: never shown again; enter a new one to replace it */
function TokenField(p: {
  id: string;
  label: string;
  saved: boolean;
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder: string;
  locked: boolean;
}) {
  const t = useTranslations("settings");
  const removing = p.value === "" && p.saved;
  return (
    <div className="field">
      <label htmlFor={p.id}>{p.label}</label>
      <div className="controls">
        <input
          id={p.id}
          type="password"
          autoComplete="off"
          disabled={p.locked}
          value={p.value ?? ""}
          onChange={(e) => p.onChange(e.target.value || null)}
          placeholder={removing ? t("token.removed") : p.saved ? t("token.saved") : p.placeholder}
          style={{ flex: 1 }}
        />
        {p.saved &&
          (removing ? (
            <button type="button" className="icon-btn" onClick={() => p.onChange(null)}>
              {t("token.keep")}
            </button>
          ) : (
            <button type="button" className="icon-btn danger" onClick={() => p.onChange("")}>
              {t("remove")}
            </button>
          ))}
      </div>
    </div>
  );
}

/** The reminder email as it will be sent, to the first person who gets it */
function ReminderPreview() {
  const t = useTranslations("settings");
  const locale = useLocale();
  const { s } = useRonde();
  // Links in the email are absolute, as in the one sent: the address of this app, known once in the browser
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const ex = s.members.find((m) => m.remind && m.active) ?? s.members[0];
  if (!ex) return null;
  const next = s.settings.schedule.upcoming.find((o) => !o.cancelled);
  const date = s.meeting?.date ?? next?.date ?? new Date().toISOString().slice(0, 10);
  const time = s.meeting?.time ?? next?.time ?? "10:00";
  // The preview shows the email in the team language, as it will be sent
  const mail = reminderEmail({
    settings: s.settings,
    locale: s.settings.locale,
    date,
    time,
    name: ex.name,
    checkInUrl: `${origin}${withBasePath(`${s.context.path}/me`)}`,
    planned: s.lastWeek[ex.id]?.next ?? [],
    actions: s.actions.filter((a) => a.ownerId === ex.id && a.status !== "done"),
    logoSrc: `${origin}${withBasePath("/icon.png")}`,
    brand: s.brand.logo ? { name: s.context.workspace.name, logo: `${origin}${withBasePath(s.brand.logo)}` } : null,
    reply: s.integrations.inbound,
  });
  return (
    <div className="mail">
      <div className="muted">
        {t("preview.to", {
          email: ex.email,
          date: formatters(locale).dateShort(reminderDate(date, s.settings.reminderWhen)),
          time: s.settings.reminderTime,
        })}
      </div>
      <div className="subj">{mail.subject}</div>
      <iframe
        title={t("preview.frameTitle", { name: ex.name })}
        className="mail-preview"
        sandbox="allow-same-origin"
        srcDoc={mail.html}
        onLoad={(e) => {
          const frame = e.currentTarget;
          if (frame.contentDocument) {
            frame.style.height = "480px";
            frame.style.height = `${frame.contentDocument.documentElement.scrollHeight}px`;
          }
        }}
      />
    </div>
  );
}

interface DirectoryPerson {
  id: string;
  name: string;
  email: string;
  jobCategory: string;
}

const ROLES = ["host", "cohost", "participant", "observer"] as const;
const ROLE_ICONS: Record<(typeof ROLES)[number], LucideIcon> = {
  host: Clapperboard,
  cohost: Handshake,
  participant: MessageCircle,
  observer: Eye,
};

/** What each role of a meeting may do, at a glance, before giving one */
function RolesGuide() {
  const t = useTranslations("settings");
  const tm = useTranslations("meetings");
  return (
    <details className="roles-guide">
      <summary>
        <Info size={15} strokeWidth={2.2} aria-hidden="true" /> {t("people.rolesGuide")}
        <ChevronDown size={16} strokeWidth={2.2} aria-hidden="true" className="roles-guide-chev" />
      </summary>
      <ul>
        {ROLES.map((r) => {
          const RoleIcon = ROLE_ICONS[r];
          return (
            <li key={r} className={`role-card role-${r}`}>
              <span className="role-card-ico" aria-hidden="true">
                <RoleIcon size={18} strokeWidth={2} />
              </span>
              <span>
                <strong>{tm(`roles.${r}`)}</strong>
                <span className="hint">{t(`people.roleHints.${r}`)}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** People of the meeting and their role; profiles are edited in the workspace directory */
function ParticipantsPanel() {
  const t = useTranslations("settings");
  const { s, rpc, api } = useRonde();
  const [people, setPeople] = useState<DirectoryPerson[] | null>(null);
  const [pick, setPick] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("participant");
  const everyone = [...s.members, ...s.observers];
  const load = useCallback(() => {
    fetch(api("/people"), { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<DirectoryPerson[]>) : []))
      .then(setPeople)
      .catch(() => setPeople([]));
  }, [api]);
  // Reloaded when someone joins or leaves the meeting
  useEffect(load, [load, everyone.length]);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const person = people?.find((p) => p.id === pick);
    if (!person) return;
    if (await rpc({ op: "participant.add", personId: person.id, role }, t("people.added", { name: person.name }))) setPick("");
  };
  return (
    <div className="panel">
      <h3>{t("people.title", { count: everyone.length })}</h3>
      <p className="hint" style={{ marginBottom: 6 }}>
        {t("people.intro")}
      </p>
      <RolesGuide />
      {/* A table: what each column is, said once above it rather than beside every box */}
      <div className={`ptable${s.modules.github ? " with-gh" : ""}`}>
        <div className="prow prow-head" aria-hidden="true">
          <span />
          <span>{t("people.colPerson")}</span>
          <span>{t("people.colRole")}</span>
          <span className="prow-center">{t("people.speaks")}</span>
          <span className="prow-center">{t("people.remind")}</span>
          <span>GitLab</span>
          {s.modules.github && <span>GitHub</span>}
          <span />
        </div>
        {everyone.map((m) => (
          <ParticipantRow key={m.id} m={m} />
        ))}
      </div>
      {people && people.length === 0 ? (
        <p className="hint" style={{ marginTop: 10 }}>
          {t("people.nobodyLeft")}
        </p>
      ) : (
        <form className="controls" style={{ marginTop: 10 }} onSubmit={add}>
          <label htmlFor="newPerson" className="sr-only">
            {t("people.pick")}
          </label>
          <Select id="newPerson" required value={pick} onChange={(e) => setPick(e.target.value)} style={{ flex: 1, minWidth: 180 }}>
            <option value="">{t("people.pickPlaceholder")}</option>
            {(people ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.email ? `${p.name} · ${p.email}` : p.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t("people.roleOf", { name: "" })}
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
            style={{ width: "auto" }}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`people.roles.${r}`)}
              </option>
            ))}
          </Select>
          <button className="btn" type="submit" disabled={!pick}>
            {t("people.add")}
          </button>
        </form>
      )}
      <p className="hint" style={{ marginTop: 10 }}>
        {t("people.categoriesHint")}{" "}
        <Link href={`/w/${s.context.workspace.slug}/people`} className="link">
          {t("people.directory")}
        </Link>
      </p>
    </div>
  );
}

function ParticipantRow({ m }: { m: MemberDTO }) {
  const t = useTranslations("settings");
  const { rpc, s } = useRonde();
  const [gl, setGl] = useState(m.gitlabUsername ?? "");
  const [gh, setGh] = useState(m.githubUsername ?? "");
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setGl(m.gitlabUsername ?? ""), [m.gitlabUsername]);
  useEffect(() => setGh(m.githubUsername ?? ""), [m.githubUsername]);
  // The "Remove" confirmation goes back to normal by itself after a few seconds
  useEffect(() => {
    if (!confirm) return;
    const timer = setTimeout(() => setConfirm(false), 6000);
    return () => clearTimeout(timer);
  }, [confirm]);
  const save = (patch: Omit<Extract<Parameters<typeof rpc>[0], { op: "participant.update" }>, "op" | "id">) =>
    rpc({ op: "participant.update", id: m.id, ...patch }, t("people.updated"));
  const observer = m.role === "observer";
  return (
    <div className="prow">
      <Avatar id={m.id} sm />
      <span className="prow-who">
        <strong>{m.name}</strong>
        <span className="hint">
          {m.email}
          {m.jobCategory ? ` · ${m.jobCategory}` : ""}
        </span>
      </span>
      <Select
        aria-label={t("people.roleOf", { name: m.name })}
        title={t(`people.roleHints.${m.role}`)}
        value={m.role}
        onChange={(e) => save({ role: e.target.value as MemberDTO["role"] })}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {t(`people.roles.${r}`)}
          </option>
        ))}
      </Select>
      {/* The column's heading names the box; on a phone, where the headings are gone, the word shows beside it */}
      <label className="check prow-check" title={t("people.speaksHint")}>
        <input
          type="checkbox"
          aria-label={t("people.speaksOf", { name: m.name })}
          disabled={observer}
          checked={m.active && !observer}
          onChange={(e) => save({ active: e.target.checked })}
        />
        <span className="prow-check-text" aria-hidden="true">
          {t("people.speaks")}
        </span>
      </label>
      <label className="check prow-check">
        <input
          type="checkbox"
          aria-label={t("people.remindOf", { name: m.name })}
          disabled={observer}
          checked={m.remind && !observer}
          onChange={(e) => save({ remind: e.target.checked })}
        />
        <span className="prow-check-text" aria-hidden="true">
          {t("people.remind")}
        </span>
      </label>
      <input
        type="text"
        aria-label={t("people.gitlab")}
        placeholder="GitLab"
        value={gl}
        onChange={(e) => setGl(e.target.value)}
        onBlur={() => gl !== (m.gitlabUsername ?? "") && save({ gitlabUsername: gl.trim() || null })}
      />
      {s.modules.github && (
        <input
          type="text"
          aria-label={t("people.github")}
          placeholder="GitHub"
          value={gh}
          pattern="[A-Za-z0-9\-]*"
          onChange={(e) => setGh(e.target.value)}
          onBlur={() => gh !== (m.githubUsername ?? "") && save({ githubUsername: gh.trim() || null })}
        />
      )}
      {confirm ? (
        <span className="controls">
          <button
            type="button"
            className="btn danger"
            onClick={() => rpc({ op: "participant.remove", id: m.id }, t("people.removed", { name: m.name }))}
          >
            {t("people.confirmRemove")}
          </button>
          <button type="button" className="icon-btn" onClick={() => setConfirm(false)}>
            {t("cancel")}
          </button>
        </span>
      ) : (
        <button type="button" className="icon-btn danger" onClick={() => setConfirm(true)}>
          {t("people.remove")}
        </button>
      )}
    </div>
  );
}

/** Recording the sessions for their transcript (Team): allowed per meeting, off by default */
function TranscriptionPanel() {
  const t = useTranslations("transcript");
  const tCommon = useTranslations("common");
  const { s, rpc } = useRonde();
  const tr = s.transcription;
  // Ticked at once; set back if the change is refused
  const [allowed, setAllowed] = useState(!!tr?.allowed);
  useEffect(() => setAllowed(!!tr?.allowed), [tr?.allowed]);
  if (!tr) return null;
  return (
    <section className="panel form" aria-labelledby="trTitle">
      <h3 id="trTitle" style={{ margin: 0 }}>
        {t("allowTitle")}
      </h3>
      <label className="check">
        <input
          type="checkbox"
          checked={allowed}
          onChange={async (e) => {
            const next = e.target.checked;
            setAllowed(next);
            if (!(await rpc({ op: "transcription.allow", allowed: next }))) setAllowed(!next);
          }}
        />{" "}
        <strong>{t("allow")}</strong>
      </label>
      <p className="hint">{t("allowHint")}</p>
      {allowed && !tr.ready && (
        <p className="note-box">
          {t("notReady")}{" "}
          <Link href={`/w/${s.context.workspace.slug}/settings`} className="link">
            {tCommon("noMeeting.openSettings")}
          </Link>
        </p>
      )}
    </section>
  );
}
