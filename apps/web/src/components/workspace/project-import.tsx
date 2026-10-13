"use client";

import { formatters, type Locale } from "@ronde/i18n";
import { Modal } from "@ronde/ui/modal";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { importProjectsAction, previewImportAction } from "@/app/w/[ws]/project-actions";
import { Field, FormAlert } from "@/components/auth/fields";
import { Select } from "@/components/select";
import { NewTab } from "@/components/shell/new-tab";
import { ToolMark } from "@/components/tool-mark";
import type { ImportCandidate } from "@/lib/server/project-import";
import type { Portfolio } from "@/lib/server/projects";
import { trackerTarget, whatsOf } from "@/lib/shared/links";
import { isRepository, SOURCE_KINDS, type SourceKind, type SourceWhat } from "@/lib/shared/project-sources";

// Importing projects: from a saved issue tracker (Team, kept in sync) or from a tool and a token typed here
// (used for this import only); for GitHub and GitLab, what becomes a project (each repository, or each
// milestone of one); then the ones to bring into the portfolio.

const FINISHED: (string | null)[] = ["done", "cancelled"];
/** Beyond this many going on, none is picked to begin with */
const PICKED_AT_MOST = 10;
/** Beyond this many, the list gets a filter */
const FILTER_FROM = 15;

/** Where people create the tokens each tool asks for */
const TOKEN_PAGES: Partial<Record<SourceKind, string>> = {
  github: "https://github.com/settings/personal-access-tokens/new",
  jira: "https://id.atlassian.com/manage-profile/security/api-tokens",
};

export interface ImportTracker {
  id: string;
  kind: SourceKind;
  name: string;
  /** Its repository, project or team, to tell two trackers apart */
  where: string;
}

type Choice = { trackerId: string } | { kind: SourceKind };
type Found = {
  kind: SourceKind;
  what: SourceWhat;
  where: string;
  items: ImportCandidate[];
  more: boolean;
  sync: boolean;
  partial: "tracker" | "public" | null;
};

export function ImportDialog({
  slug,
  trackers,
  syncOn,
  canManageTrackers,
  themes,
  onClose,
  onDone,
}: {
  slug: string;
  trackers: ImportTracker[];
  /** The plan keeps imported projects in sync (Team) */
  syncOn: boolean;
  /** The person may add issue trackers (and import through them) */
  canManageTrackers: boolean;
  themes: Portfolio["themes"];
  onClose: () => void;
  /** The projects that came in, and how many of them are finished */
  onDone: (ids: string[], finished: number, failed: number) => void;
}) {
  const t = useTranslations("projectImport");
  const tp = useTranslations("projects");
  const fmt = formatters(useLocale() as Locale);
  const titleId = useId();
  const syncHintId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const allBox = useRef<HTMLInputElement>(null);
  const first = trackers[0];
  const [choice, setChoice] = useState<Choice | null>(first ? { trackerId: first.id } : null);
  const [what, setWhat] = useState<SourceWhat | null>(first ? (whatsOf(first.kind, first)[0] ?? null) : null);
  const [fields, setFields] = useState({ address: "", project: "", email: "", token: "" });
  const [found, setFound] = useState<Found | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [themeId, setThemeId] = useState<string | null>(null);
  const [keepSync, setKeepSync] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tracker = choice && "trackerId" in choice ? trackers.find((x) => x.id === choice.trackerId) : undefined;
  const kind: SourceKind | null = !choice ? null : "kind" in choice ? choice.kind : (tracker?.kind ?? null);
  const typed = choice && "kind" in choice ? choice.kind : null;
  const whats = kind ? whatsOf(kind, tracker) : [];
  const source = () =>
    !choice || !what ? null : "trackerId" in choice ? { trackerId: choice.trackerId, what } : { kind: choice.kind, what, ...fields };
  const set = (patch: Partial<typeof fields>) => setFields((f) => ({ ...f, ...patch }));
  const pick = (c: Choice, k: SourceKind, tr?: ImportTracker) => {
    // Another tool: what was typed for the previous one (its token above all) does not follow
    if (k !== kind || "trackerId" in c) setFields({ address: "", project: "", email: "", token: "" });
    setChoice(c);
    setWhat(whatsOf(k, tr)[0] ?? null);
    setError(null);
  };

  // Each step starts on its title: the person (and their screen reader) knows where they are
  const step = found ? "pick" : "source";
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current !== step) heading.current?.focus();
    shown.current = step;
  }, [step]);

  const close = () => {
    if (!busy) onClose();
  };

  const look = async (e: React.FormEvent) => {
    e.preventDefault();
    const src = source();
    if (!src) return;
    setBusy(true);
    setError(null);
    try {
      const res = await previewImportAction(slug, src);
      if (!res.ok) return setError(res.error);
      // What is still going on first, the finished ones below, those already in the portfolio last. What is
      // going on is picked to begin with, unless they are repositories (an organization holds many that are
      // not projects) or too many to mean them all
      const rank = (i: ImportCandidate) => (i.imported ? 2 : FINISHED.includes(i.status) ? 1 : 0);
      const items = [...res.data.items].sort((a, b) => rank(a) - rank(b));
      const going = items.filter((i) => rank(i) === 0);
      setFound({ ...res.data, items });
      setFilter("");
      setPicked(new Set(isRepository(res.data.kind, res.data.what) || going.length > PICKED_AT_MOST ? [] : going.map((i) => i.id)));
    } catch {
      setError(t("offline"));
    } finally {
      setBusy(false);
    }
  };

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    const src = source();
    if (!src || !picked.size) return;
    setBusy(true);
    setError(null);
    try {
      const res = await importProjectsAction(slug, src, { ids: [...picked], themeId, sync: !!found?.sync && keepSync });
      if (!res.ok) return setError(res.error);
      onDone(res.data.ids, res.data.finished, res.data.failed);
    } catch {
      setError(t("offline"));
    } finally {
      setBusy(false);
    }
  };

  const open = found?.items.filter((i) => !i.imported) ?? [];
  const all = open.length > 0 && open.every((i) => picked.has(i.id));
  const some = !all && open.some((i) => picked.has(i.id));
  useEffect(() => {
    if (allBox.current) allBox.current.indeterminate = some;
  }, [some]);

  if (found) {
    const tool = t(`tools.${found.kind}`);
    const needle = filter.trim().toLowerCase();
    const listed = needle ? found.items.filter((i) => `${i.name} ${i.key} ${i.summary}`.toLowerCase().includes(needle)) : found.items;
    const repository = isRepository(found.kind, found.what);
    return (
      <Modal onClose={close} labelledBy={titleId}>
        <form className="form dialog-form import-form" onSubmit={run}>
          <h2 id={titleId} ref={heading} tabIndex={-1}>
            <ToolMark kind={found.kind} size={20} /> {t(`pickTitle.${found.what}`)}
          </h2>
          {found.where && (
            <p className="muted import-where">
              {tool} · <bdi>{found.where}</bdi>
            </p>
          )}
          <FormAlert>{error}</FormAlert>
          {found.items.length === 0 ? (
            <p className="muted">{t(`nothing.${found.what}`)}</p>
          ) : open.length === 0 ? (
            <p className="muted">{t("allImported")}</p>
          ) : (
            <>
              {(found.partial || found.more) && (
                <p className="hint">
                  {found.partial && t(`partial.${found.partial}`)} {found.more && t("more")}
                </p>
              )}
              {found.items.length > FILTER_FROM && (
                <input
                  type="search"
                  className="import-filter"
                  aria-label={t("filter")}
                  placeholder={t("filter")}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  // Escape empties the filter, as in any search field; the dialog stays open
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && filter) {
                      e.stopPropagation();
                      e.nativeEvent.stopImmediatePropagation();
                      setFilter("");
                    }
                  }}
                />
              )}
              <label className="check import-all">
                <input
                  ref={allBox}
                  type="checkbox"
                  checked={all}
                  onChange={() => setPicked(all ? new Set() : new Set(open.map((i) => i.id)))}
                />
                {t("pickAll", { count: open.length })}
              </label>
              <ul className="import-list">
                {listed.length === 0 && <li className="muted">{tp("noMatch")}</li>}
                {listed.map((i) => (
                  <li key={i.id} className={i.imported ? "imported" : undefined}>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={picked.has(i.id)}
                        disabled={!!i.imported}
                        onChange={() =>
                          setPicked((p) => {
                            const next = new Set(p);
                            if (next.has(i.id)) next.delete(i.id);
                            else next.add(i.id);
                            return next;
                          })
                        }
                      />
                      <span className="import-name">
                        {/* The list already names the repository: a milestone goes by its own title */}
                        <strong>
                          <bdi>{found.what === "milestones" ? i.key : i.name}</bdi>
                        </strong>
                        {i.summary && (
                          <small className="muted" title={i.summary}>
                            {i.summary}
                          </small>
                        )}
                      </span>
                      <span className="import-meta">
                        {i.imported ? (
                          <span className="muted">{t("inPortfolio")}</span>
                        ) : (
                          <>
                            {i.status && i.status !== "active" && (
                              <span className={`status-chip s-${i.status}`}>
                                {repository && i.status === "done" ? tp("archived") : tp(`status.${i.status}`)}
                              </span>
                            )}
                            {i.targetDate && <span className="muted">{tp("due", { date: fmt.dateShort(i.targetDate) })}</span>}
                            {i.progress !== null && (
                              <span className="import-progress">
                                <progress className="meter" max={1} value={i.progress} aria-hidden="true" />
                                {t("progress", { percent: fmt.percent(i.progress) })}
                              </span>
                            )}
                          </>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {!picked.size && <p className="hint">{t("pickSome")}</p>}
              {themes.length > 0 && (
                <div className="grid2">
                  <Field label={tp("theme")} hint={t("themeHint")}>
                    {(p) => (
                      <Select {...p} value={themeId ?? ""} onChange={(e) => setThemeId(e.target.value || null)}>
                        <option value="">{tp("noTheme")}</option>
                        {themes.map((th) => (
                          <option key={th.id} value={th.id}>
                            {th.name}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                </div>
              )}
              {found.sync ? (
                <div className="import-sync">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={keepSync}
                      onChange={(e) => setKeepSync(e.target.checked)}
                      aria-describedby={syncHintId}
                    />
                    {t("keepSync", { tool })}
                  </label>
                  <p className="hint" id={syncHintId}>
                    {t(repository ? "keepSyncHintRepo" : "keepSyncHint")}
                  </p>
                </div>
              ) : (
                <p className="hint">{t("onceHint")}</p>
              )}
            </>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                setFound(null);
                setError(null);
              }}
            >
              {t("back")}
            </button>
            <button type="submit" className="btn primary" disabled={busy || !picked.size} aria-busy={busy}>
              {busy ? t("importing", { count: picked.size }) : t("import", { count: picked.size })}
            </button>
          </div>
        </form>
      </Modal>
    );
  }

  const tokenPage = typed ? TOKEN_PAGES[typed] : undefined;
  const tokenHint = typed && (
    <>
      {t.rich(`tokenHint.${typed}${typed === "gitlab" && what === "projects" ? "Group" : ""}` as `tokenHint.${SourceKind}`, {
        link: (chunks) =>
          tokenPage ? (
            <a href={tokenPage} target="_blank" rel="noopener noreferrer" className="link">
              {chunks}
              <NewTab />
            </a>
          ) : (
            chunks
          ),
      })}{" "}
      {t("tokenNotKept")}
    </>
  );
  return (
    <Modal onClose={close} labelledBy={titleId}>
      <form className="form dialog-form import-form" onSubmit={look}>
        <h2 id={titleId} ref={heading} tabIndex={-1}>
          {t("title")}
        </h2>
        <p className="muted">{t("intro")}</p>
        <FormAlert>{error}</FormAlert>
        {trackers.length > 0 && (
          <fieldset className="import-sources">
            <legend>{t("trackers")}</legend>
            {trackers.map((tr) => (
              <label key={tr.id} className="import-source">
                <input
                  type="radio"
                  name="source"
                  checked={tracker?.id === tr.id}
                  data-autofocus={tracker?.id === tr.id || undefined}
                  onChange={() => pick({ trackerId: tr.id }, tr.kind, tr)}
                />
                <ToolMark kind={tr.kind} />
                <span>
                  <strong>
                    <bdi>{tr.name}</bdi>
                  </strong>
                  <small className="muted">
                    {t(`tools.${tr.kind}`)}
                    {tr.where && (
                      <>
                        {" · "}
                        <bdi>{tr.where}</bdi>
                      </>
                    )}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <fieldset className="import-sources import-tools">
          <legend>{trackers.length ? t("another") : t("from")}</legend>
          {SOURCE_KINDS.map((k, n) => (
            <label key={k} className="import-source">
              <input
                type="radio"
                name="source"
                checked={typed === k}
                data-autofocus={(!trackers.length && n === 0) || undefined}
                onChange={() => pick({ kind: k }, k)}
              />
              <ToolMark kind={k} />
              <span>
                <strong>{t(`tools.${k}`)}</strong>
                <small className="muted">{t(`what.${k}`)}</small>
              </span>
            </label>
          ))}
        </fieldset>
        {kind && whats.length > 1 && (
          <fieldset className="import-whats">
            <legend>{t("whatLabel")}</legend>
            {whats.map((w) => (
              <label key={w} className="import-source">
                <input type="radio" name="what" checked={what === w} onChange={() => setWhat(w)} />
                <span>
                  <strong>
                    {t(`modes.${w === "milestones" ? "milestones" : "repos"}.${kind === "gitlab" ? "gitlab" : "github"}`)}
                    {tracker && (
                      <>
                        {" · "}
                        <bdi>{trackerTarget(tracker, w)}</bdi>
                      </>
                    )}
                  </strong>
                  <small className="muted">{t(`modeHints.${w === "milestones" ? "milestones" : "repos"}`)}</small>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {typed && what && (
          <div className="import-fields">
            {typed === "github" && (
              <Field label={t(what === "repos" ? "fields.owner" : "fields.repo")}>
                {(p) => (
                  <input
                    {...p}
                    required
                    maxLength={300}
                    autoComplete="off"
                    dir="ltr"
                    placeholder={what === "repos" ? "acme" : "acme/app"}
                    value={fields.address}
                    onChange={(e) => set({ address: e.target.value })}
                  />
                )}
              </Field>
            )}
            {typed === "gitlab" && (
              <Field label={t(what === "projects" ? "fields.group" : "fields.gitlab")}>
                {(p) => (
                  <input
                    {...p}
                    inputMode="url"
                    required
                    maxLength={300}
                    autoComplete="off"
                    dir="ltr"
                    placeholder={what === "projects" ? "gitlab.com/acme" : "gitlab.com/acme/app"}
                    value={fields.address}
                    onChange={(e) => set({ address: e.target.value })}
                  />
                )}
              </Field>
            )}
            {typed === "jira" && (
              <>
                <Field label={t("fields.site")}>
                  {(p) => (
                    <input
                      {...p}
                      inputMode="url"
                      required
                      maxLength={300}
                      autoComplete="off"
                      dir="ltr"
                      placeholder="acme.atlassian.net"
                      value={fields.address}
                      onChange={(e) => set({ address: e.target.value })}
                    />
                  )}
                </Field>
                <div className="grid2">
                  <Field label={t("fields.project")} hint={t("fields.projectHint")}>
                    {(p) => (
                      <input
                        {...p}
                        required
                        maxLength={20}
                        pattern="[A-Za-z][A-Za-z0-9_]*"
                        dir="ltr"
                        autoCapitalize="characters"
                        title={t("fields.projectHint")}
                        placeholder="OPS"
                        value={fields.project}
                        onChange={(e) => set({ project: e.target.value.toUpperCase() })}
                      />
                    )}
                  </Field>
                  <Field label={t("fields.email")}>
                    {(p) => (
                      <input
                        {...p}
                        type="email"
                        required
                        maxLength={200}
                        dir="ltr"
                        placeholder="you@acme.com"
                        value={fields.email}
                        onChange={(e) => set({ email: e.target.value })}
                      />
                    )}
                  </Field>
                </div>
              </>
            )}
            <Field label={typed === "github" || typed === "gitlab" ? t(`tokenOptional.${typed}`) : t("token")} hint={tokenHint}>
              {(p) => (
                <input
                  {...p}
                  type="password"
                  autoComplete="off"
                  dir="ltr"
                  required={typed === "jira" || typed === "linear"}
                  maxLength={500}
                  value={fields.token}
                  onChange={(e) => set({ token: e.target.value })}
                />
              )}
            </Field>
          </div>
        )}
        {!syncOn ? (
          <p className="hint">{t("teamHint")}</p>
        ) : (
          !trackers.length && (
            <p className="hint">
              {canManageTrackers
                ? t.rich("syncHowTo", {
                    link: (chunks) => (
                      <Link href={`/w/${slug}/settings#trackers`} className="link">
                        {chunks}
                      </Link>
                    ),
                  })
                : t("syncAskAdmin")}
            </p>
          )
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" disabled={busy} onClick={close}>
            {tp("cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={busy || !choice || !what} aria-busy={busy}>
            {busy ? t("looking") : t("look")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
