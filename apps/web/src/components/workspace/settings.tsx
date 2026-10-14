"use client";

import { Modal } from "@ronde/ui/modal";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { deleteWorkspaceAction, leaveWorkspaceAction, updateWorkspaceAction } from "@/app/w/[ws]/actions";
import { Field, FormAlert } from "@/components/auth/fields";
import { Select } from "@/components/select";
import type { ConnectorView } from "@/lib/server/notify/connectors";
import { HolidayPicker } from "../holiday-picker";
import { AiSettings, type AiSettingsProps } from "./ai-settings";
import { CalendarAccountsSettings, type CalendarAccountsSettingsProps } from "./calendar-accounts-settings";
import { useConfirm } from "./confirm";
import { ConnectorsSection } from "./connectors";
import { LocaleSelect, TimeZoneSelect } from "./inputs";
import { LogoSettings, type LogoSettingsProps } from "./logo-settings";
import { SlackSettings, type SlackSettingsProps } from "./slack-settings";
import { TeamsSettings, type TeamsSettingsProps } from "./teams-settings";
import { TrackersSettings, type TrackersSettingsProps } from "./trackers-settings";
import { TranscriptionSettings, type TranscriptionSettingsProps } from "./transcription-settings";
import { VideoAccountsSettings, type VideoAccountsSettingsProps } from "./video-accounts-settings";
import { WikisSettings, type WikisSettingsProps } from "./wikis-settings";

interface Props {
  workspace: {
    slug: string;
    name: string;
    locale: string;
    timezone: string;
    meetingCreation: "members" | "admins";
    bufferMin: number;
    /** Public holidays its meetings skip ("" for none) */
    holidays: string;
  };
  /** Countries with a holiday calendar, and the regions of the one chosen */
  holidayCalendars: { countries: string[]; regions: Record<string, string> };
  urlPrefix: string;
  categories: { id: string; name: string }[];
  canManage: boolean;
  canDelete: boolean;
  /** Notification connectors, for the people managing them (null otherwise) */
  connectors: ConnectorView[] | null;
  /** SMS and WhatsApp connectors are in the plan */
  phoneOn: boolean;
  /** Secrets can be stored (SECRET_KEY) */
  canEncrypt: boolean;
  /** The workspace logo, for the people managing the workspace (null: not shown) */
  branding: LogoSettingsProps | null;
  /** The AI assistant, for the people managing the workspace (null: not shown) */
  ai: AiSettingsProps | null;
  /** Issue trackers, for the people managing connectors (null: not shown) */
  trackers: TrackersSettingsProps | null;
  teams: TeamsSettingsProps | null;
  wikis: WikisSettingsProps | null;
  /** Video accounts, for the people managing connectors (null: not shown) */
  videoAccounts: VideoAccountsSettingsProps | null;
  /** Calendar accounts, for the people managing connectors (null: not shown) */
  calendarAccounts: CalendarAccountsSettingsProps | null;
  /** Speech-to-text service of the workspace (null: not shown) */
  transcription: TranscriptionSettingsProps | null;
  /** The Slack app, for the people managing connectors (null: not shown) */
  slack: SlackSettingsProps | null;
}

export function WorkspaceSettingsView({
  workspace,
  urlPrefix,
  categories,
  canManage,
  canDelete,
  connectors,
  phoneOn,
  canEncrypt,
  branding,
  ai,
  trackers,
  wikis,
  videoAccounts,
  calendarAccounts,
  transcription,
  slack,
  teams,
  holidayCalendars,
}: Props) {
  const t = useTranslations("workspace.settings");
  const tHolidays = useTranslations("holidays");
  const router = useRouter();
  const [values, setValues] = useState(workspace);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmDialog, confirm] = useConfirm();
  const [deleting, setDeleting] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const set = (patch: Partial<typeof values>) => {
    setSaved(false);
    setValues((v) => ({ ...v, ...patch }));
  };

  const save = async (next: typeof values) => {
    if (!form.current?.checkValidity()) return;
    setBusy(true);
    setError(null);
    const res = await updateWorkspaceAction(workspace.slug, next);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(true);
    if (res.data.slug !== workspace.slug) router.replace(`/w/${res.data.slug}/settings`);
    else router.refresh();
  };
  // Saved by itself a moment after the last change; the address only when its field is left (or on Enter), so
  // the workspace does not move to every address typed on the way
  const kept = { ...values, slug: workspace.slug };
  const pending = JSON.stringify(kept) !== JSON.stringify(workspace);
  useEffect(() => {
    if (!canManage || !pending) return;
    const timer = setTimeout(() => void save(kept), 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(kept), pending]);
  const saveAddress = () => {
    if (values.slug !== workspace.slug) void save(values);
  };

  const leave = async () => {
    if (!(await confirm({ message: t("leaveConfirm", { workspace: workspace.name }), confirmLabel: t("leave"), danger: true }))) return;
    const res = await leaveWorkspaceAction(workspace.slug);
    if (!res.ok) return setError(res.error);
    router.replace("/");
    router.refresh();
  };

  return (
    <div className="page narrow">
      {!canManage && <p className="muted">{t("readOnly")}</p>}
      <FormAlert>{error}</FormAlert>

      <section className="panel" aria-labelledby="general-title">
        <h2 id="general-title">{t("general")}</h2>
        <form
          className="form"
          ref={form}
          onSubmit={(e) => {
            e.preventDefault();
            void save(values);
          }}
        >
          <fieldset disabled={!canManage} className="plain">
            <div className="form">
              <Field label={t("name")}>
                {(p) => (
                  <input {...p} type="text" required maxLength={80} value={values.name} onChange={(e) => set({ name: e.target.value })} />
                )}
              </Field>
              <Field label={t("slug")} hint={t("slugHint", { url: `${urlPrefix}${values.slug}` })}>
                {(p) => (
                  <input
                    {...p}
                    type="text"
                    required
                    maxLength={40}
                    pattern="[a-z0-9](?:[a-z0-9\-]{0,38}[a-z0-9])?"
                    value={values.slug}
                    onChange={(e) => set({ slug: e.target.value.toLowerCase() })}
                    onBlur={saveAddress}
                  />
                )}
              </Field>
              <div className="grid2">
                <Field label={t("language")}>
                  {(p) => <LocaleSelect {...p} value={values.locale} onChange={(locale) => set({ locale })} />}
                </Field>
                <Field label={t("timezone")}>
                  {(p) => <TimeZoneSelect {...p} value={values.timezone} onChange={(timezone) => set({ timezone })} />}
                </Field>
              </div>
              <Field label={t("meetingCreation")}>
                {(p) => (
                  <Select
                    {...p}
                    value={values.meetingCreation}
                    onChange={(e) => set({ meetingCreation: e.target.value as "members" | "admins" })}
                  >
                    <option value="members">{t("meetingCreationMembers")}</option>
                    <option value="admins">{t("meetingCreationAdmins")}</option>
                  </Select>
                )}
              </Field>
              <Field label={t("buffer")} hint={t("bufferHint")}>
                {(p) => (
                  <Select {...p} value={String(values.bufferMin)} onChange={(e) => set({ bufferMin: Number(e.target.value) })}>
                    {[0, 5, 10, 15, 30].map((m) => (
                      <option key={m} value={m}>
                        {m ? t("bufferMinutes", { count: m }) : t("bufferNone")}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                label={tHolidays("label")}
                hint={
                  <>
                    {tHolidays("hintWorkspace")} <span className="holiday-source">{tHolidays("source")}</span>
                  </>
                }
              >
                {(p) => (
                  <HolidayPicker
                    id={p.id}
                    value={values.holidays}
                    onChange={(holidays) => set({ holidays })}
                    countries={holidayCalendars.countries}
                    regions={holidayCalendars.regions}
                  />
                )}
              </Field>
            </div>
          </fieldset>
          {canManage && (
            <p className="hint save-status" role="status" aria-busy={busy}>
              {saved && !busy ? `✓ ${t("saved")}` : ""}
            </p>
          )}
        </form>
      </section>

      {branding && <LogoSettings {...branding} />}

      {ai && <AiSettings {...ai} />}

      {transcription && <TranscriptionSettings {...transcription} />}

      <JobCategories slug={workspace.slug} categories={categories} />

      {slack && <SlackSettings {...slack} confirm={confirm} />}

      {teams && <TeamsSettings {...teams} confirm={confirm} />}

      {connectors && (
        <ConnectorsSection slug={workspace.slug} connectors={connectors} canEncrypt={canEncrypt} phoneOn={phoneOn} confirm={confirm} />
      )}

      {trackers && <TrackersSettings {...trackers} confirm={confirm} />}

      {wikis && <WikisSettings {...wikis} confirm={confirm} />}

      {videoAccounts && <VideoAccountsSettings {...videoAccounts} confirm={confirm} />}

      {calendarAccounts && <CalendarAccountsSettings {...calendarAccounts} confirm={confirm} />}

      <section className="panel danger-zone" aria-labelledby="danger-title">
        <h2 id="danger-title">{t("danger")}</h2>
        <div className="danger-row">
          <div>
            <strong>{t("leave")}</strong>
            <p className="hint">{t("leaveHint")}</p>
          </div>
          <button type="button" className="btn danger" onClick={leave}>
            {t("leave")}
          </button>
        </div>
        {canDelete && (
          <div className="danger-row">
            <div>
              <strong>{t("deleteWorkspace")}</strong>
              <p className="hint">{t("deleteHint")}</p>
            </div>
            <button type="button" className="btn danger" onClick={() => setDeleting(true)}>
              {t("deleteWorkspace")}
            </button>
          </div>
        )}
      </section>
      {deleting && <DeleteWorkspace slug={workspace.slug} onClose={() => setDeleting(false)} />}
      {confirmDialog}
    </div>
  );
}

/** The directory's teams, managed on their own page (a tree of teams): here, how many and the way there */
function JobCategories({ slug, categories }: { slug: string; categories: { id: string; name: string }[] }) {
  const t = useTranslations("workspace.settings");
  return (
    <section className="panel" id="categories" aria-labelledby="categories-title">
      <h2 id="categories-title">{t("categories")}</h2>
      <p className="hint">{t("categoriesHint")}</p>
      {categories.length === 0 ? (
        <p className="empty-state">{t("noCategories")}</p>
      ) : (
        <p className="team-names">
          {categories.slice(0, 12).map((c) => (
            <span key={c.id} className="pill view">
              {c.name}
            </span>
          ))}
          {categories.length > 12 && <span className="hint">+{categories.length - 12}</span>}
        </p>
      )}
      <Link href={`/w/${slug}/teams`} className="btn">
        {t("manageTeams")} →
      </Link>
    </section>
  );
}

function DeleteWorkspace({ slug, onClose }: { slug: string; onClose: () => void }) {
  const t = useTranslations("workspace.settings");
  const router = useRouter();
  const titleId = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await deleteWorkspaceAction(slug, text);
    if (!res.ok) {
      setBusy(false);
      return setError(res.error);
    }
    router.replace("/");
    router.refresh();
  };
  return (
    <Modal onClose={onClose} labelledBy={titleId}>
      <form className="form dialog-form narrow" onSubmit={submit}>
        <h2 id={titleId}>{t("deleteWorkspace")}</h2>
        <p>{t("deleteHint")}</p>
        <FormAlert>{error}</FormAlert>
        <Field label={t.rich("deleteConfirm", { slug, strong: (c) => <strong className="confirm-name">{c}</strong> })}>
          {(p) => <input {...p} type="text" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />}
        </Field>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" className="btn danger-solid" disabled={busy || text !== slug} aria-busy={busy}>
            {t("deleteWorkspace")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
