"use client";

import { PROJECT_STATUSES, type ProjectHealth, type ProjectStatus } from "@ronde/core/types";
import type { PortfolioDTO } from "@ronde/editions/ee";
import { formatters, type Locale } from "@ronde/i18n";
import { MdEditor } from "@ronde/ui/md-editor";
import { Modal } from "@ronde/ui/modal";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { addThemeAction, createProjectAction, deleteThemeAction, renameThemeAction } from "@/app/w/[ws]/project-actions";
import { Field, FormAlert } from "@/components/auth/fields";
import { ExportCsv } from "@/components/export-csv";
import { type FacePerson, PersonFace } from "@/components/person-face";
import { ProjectMark, projectLogoSrc } from "@/components/project-mark";
import { Select } from "@/components/select";
import { ToolMark } from "@/components/tool-mark";
import type { Portfolio, PortfolioProject, ProjectLink } from "@/lib/server/projects";
import { isRepository, type SourceKind, type SourceWhat } from "@/lib/shared/project-sources";
import {
  depthIn,
  type HealthFilter,
  hasHealth,
  MAX_DEPTH,
  projectGroups,
  projectMatches,
  type StatusFilter,
} from "@/lib/shared/workspace-lists";
import { HealthBadge, HealthPicker } from "../project-bits";
import { Icon } from "../shell/icons";
import { useConfirm } from "./confirm";
import { ImportDialog, type ImportTracker } from "./project-import";

// The portfolio of the workspace: every project, grouped by theme or by status, with its health, its people,
// its due date and the last message presented; a dashboard over time with the Team plan.

const tint = (color: number) => ({ "--c": `var(--c${color % 6})` }) as React.CSSProperties;
/** First line of a Markdown text, without its marks */
const plain = (md: string) =>
  md
    .split("\n")
    .find((l) => l.trim())
    ?.replace(/[*_`#>[\]]/g, "")
    .trim() ?? "";

export function PeopleStack({ slug, people, max = 5 }: { slug: string; people: FacePerson[]; max?: number }) {
  return (
    <span className="people-stack">
      {people.slice(0, max).map((p) => (
        <PersonFace key={p.id} slug={slug} person={p} size="xs" title={p.name} />
      ))}
      {people.length > max && <span className="av xs more">+{people.length - max}</span>}
    </span>
  );
}

function ProjectCard({ slug, p, programme }: { slug: string; p: PortfolioProject; programme?: string }) {
  const t = useTranslations("projects");
  const fmt = formatters(useLocale() as Locale);
  const today = new Date().toISOString().slice(0, 10);
  const late = !!p.targetDate && p.targetDate < today && !["done", "cancelled"].includes(p.status);
  return (
    <article className={`project-card${p.archived ? " archived" : ""}`} style={tint(p.color)}>
      <header>
        <h3>
          <ProjectMark project={p} src={projectLogoSrc(slug, p)} />
          <Link href={`/w/${slug}/projects/${p.slug}`}>{p.name}</Link>
        </h3>
        <HealthBadge health={p.health} />
      </header>
      {p.summary && <p className="project-card-summary">{p.summary}</p>}
      <div className="project-card-meta">
        {programme && <span className="status-chip">{t("partOf", { name: programme })}</span>}
        {p.private && (
          <span className="status-chip" title={t("visibilityMembers")}>
            <Icon name="lock" size={13} /> {t("private")}
          </span>
        )}
        {p.status !== "active" && <span className={`status-chip s-${p.status}`}>{t(`status.${p.status}`)}</span>}
        {p.archived && <span className="status-chip">{t("archived")}</span>}
        {p.targetDate && (
          <span className={late ? "late" : "muted"}>{t(late ? "overdue" : "due", { date: fmt.dateShort(p.targetDate) })}</span>
        )}
      </div>
      {p.progress !== null && (
        <div className="project-progress">
          <progress className="meter" max={1} value={p.progress} aria-hidden="true" />
          <span className="muted">{t("progressDone", { percent: fmt.percent(p.progress) })}</span>
        </div>
      )}
      {p.last && (
        <p className="project-card-last">
          <HealthBadge health={p.last.health} compact />
          <span>
            <span className="muted">{fmt.dateShort(p.last.date)} · </span>
            {plain(p.last.headline) || t("noHeadline")}
          </span>
        </p>
      )}
      <footer>
        {p.lead && <span className="muted">{t("leadBy", { name: p.lead.name })}</span>}
        <PeopleStack slug={slug} people={p.members} />
      </footer>
    </article>
  );
}

export function PortfolioView({
  slug,
  portfolio,
  view,
  dashboard,
  weeks,
  periods,
  locked,
  dashboardOn,
  openNew,
  trackers,
  syncOn,
  canManageTrackers,
}: {
  slug: string;
  portfolio: Portfolio;
  view: "board" | "dashboard";
  dashboard: PortfolioDTO | null;
  weeks: number;
  periods: number[];
  /** What the Team plan brings, when the workspace does not have it */
  locked: React.ReactNode;
  dashboardOn: boolean;
  openNew: boolean;
  /** Where projects can be imported from, besides any tool and a token */
  trackers: ImportTracker[];
  syncOn: boolean;
  /** May add issue trackers, and import through them */
  canManageTrackers: boolean;
}) {
  const t = useTranslations("projects");
  const tm = useTranslations("modules");
  const router = useRouter();
  const path = usePathname();
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("open");
  const [health, setHealth] = useState<HealthFilter>("");
  const hasProgrammes = portfolio.projects.some((p) => p.parentId);
  const [group, setGroup] = useState<"theme" | "status" | "programme">("theme");
  const [dialog, setDialog] = useState<"new" | "themes" | "import" | null>(openNew && portfolio.canCreate ? "new" : null);
  /** The projects the last import brought, until dismissed */
  const [imported, setImported] = useState<{ ids: string[]; failed: number } | null>(null);
  const importedText = useRef<HTMLSpanElement>(null);
  const importButton = useRef<HTMLButtonElement>(null);
  // Once an import is done, focus goes to what it says (the button that opened it may be gone)
  useEffect(() => {
    if (imported) importedText.current?.focus();
  }, [imported]);
  const needle = q.trim().toLowerCase();
  const byId = new Map(portfolio.projects.map((p) => [p.id, p]));
  const matches = (p: PortfolioProject) => projectMatches(p, { status, mine, needle });
  /** The projects of the other filters: what the health chips count */
  const counted = portfolio.projects.filter(matches);
  const shown = counted.filter((p) => hasHealth(p, health));
  /** Imported projects the current filters hide */
  // (only those the portfolio already holds: the list is reloaded just after the import)
  const hiddenImports = imported ? imported.ids.filter((id) => byId.has(id) && !shown.some((p) => p.id === id)).length : 0;
  const groups = projectGroups(group, portfolio, shown, t);
  const setView = (v: "board" | "dashboard", w = weeks) =>
    router.replace(v === "board" ? path : `${path}?view=dashboard&weeks=${w}`, { scroll: false });
  return (
    <div className="page portfolio-page">
      <header className="portfolio-head">
        <h1>{t("title")}</h1>
        <div className="actions">
          {portfolio.canManage && (
            <button type="button" className="btn" onClick={() => setDialog("themes")}>
              {t("themes")}
            </button>
          )}
          {portfolio.canCreate && (
            <button type="button" className="btn" ref={importButton} onClick={() => setDialog("import")}>
              {t("import")}
            </button>
          )}
          {portfolio.canCreate && (
            <button type="button" className="btn primary" onClick={() => setDialog("new")}>
              {t("new")}
            </button>
          )}
        </div>
        <p className="muted">{t("intro")}</p>
        {/* Always there, so that what it says once an import is done is read out */}
        <div role="status" className="import-done">
          {imported !== null && (
            <p className="banner">
              <span className="grow" ref={importedText} tabIndex={-1}>
                {t("imported", { count: imported.ids.length })}
                {hiddenImports > 0 && ` ${t("importedHidden", { count: hiddenImports })}`}
                {imported.failed > 0 && ` ${t("importedFailed", { count: imported.failed })}`}
              </span>
              {hiddenImports > 0 && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    // Every filter that hides them goes; focus stays on the message, not on a button gone
                    setQ("");
                    setMine(false);
                    setHealth("");
                    setStatus("all");
                    importedText.current?.focus();
                  }}
                >
                  {t("showFinished")}
                </button>
              )}
              <button
                type="button"
                className="icon-btn"
                aria-label={t("dismiss")}
                onClick={() => {
                  setImported(null);
                  importButton.current?.focus();
                }}
              >
                ✕
              </button>
            </p>
          )}
        </div>
      </header>
      <div className="subtabs">
        <div className="subtabs-list" role="tablist" aria-label={t("views")}>
          <button type="button" role="tab" aria-selected={view === "board"} onClick={() => setView("board")}>
            {t("board")}
          </button>
          {/* Without the plan, the tab presents what the dashboard brings */}
          <button type="button" role="tab" aria-selected={view === "dashboard"} onClick={() => setView("dashboard")}>
            {t("dashboard.title")}
            {!dashboardOn && <span className="plan-badge">{tm("editions.team")}</span>}
          </button>
        </div>
      </div>
      {view === "dashboard" ? (
        dashboard ? (
          <PortfolioDashboard slug={slug} data={dashboard} weeks={weeks} periods={periods} onWeeks={(w) => setView("dashboard", w)} />
        ) : (
          locked
        )
      ) : (
        <>
          <div className="toolbar portfolio-filters">
            <input type="search" placeholder={t("search")} aria-label={t("search")} value={q} onChange={(e) => setQ(e.target.value)} />
            <Select
              aria-label={t("statusFilter")}
              style={{ width: "auto" }}
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="open">{t("statusOpen")}</option>
              {PROJECT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
              <option value="all">{t("statusAll")}</option>
            </Select>
            <Select
              aria-label={t("groupBy")}
              style={{ width: "auto" }}
              value={group}
              onChange={(e) => setGroup(e.target.value as typeof group)}
            >
              <option value="theme">{t("byTheme")}</option>
              <option value="status">{t("byStatus")}</option>
              {(portfolio.programs || hasProgrammes) && <option value="programme">{t("byProgramme")}</option>}
            </Select>
            <button type="button" className="chip" aria-pressed={mine} onClick={() => setMine(!mine)}>
              {t("mine")}
            </button>
          </div>
          {/* The portfolio at a glance: how many projects in each health, each one a filter */}
          {portfolio.projects.length > 0 && (
            <div className="health-summary" role="group" aria-label={t("healthFilter")}>
              <button type="button" className="chip" aria-pressed={!health} onClick={() => setHealth("")}>
                {t("healthAll")} <span className="cnt">{counted.length}</span>
              </button>
              {(["offTrack", "atRisk", "onTrack", "none"] as const).map((h) => {
                const n = counted.filter((p) => hasHealth(p, h)).length;
                if (!n && health !== h) return null;
                return (
                  <button
                    key={h}
                    type="button"
                    className={`chip h-${h}`}
                    aria-pressed={health === h}
                    onClick={() => setHealth(health === h ? "" : h)}
                  >
                    <HealthBadge health={h === "none" ? null : h} /> <span className="cnt">{n}</span>
                  </button>
                );
              })}
            </div>
          )}
          {!portfolio.projects.length ? (
            <div className="emptybox">
              <p>{t("empty")}</p>
              {portfolio.canCreate && (
                <div className="row">
                  <button type="button" className="btn primary" onClick={() => setDialog("new")}>
                    {t("new")}
                  </button>
                  {/* The first time is when bringing them from the tools helps most */}
                  <button type="button" className="btn" onClick={() => setDialog("import")}>
                    {t("importFromTools")}
                  </button>
                </div>
              )}
            </div>
          ) : !shown.length ? (
            <p className="empty-state">{t("noMatch")}</p>
          ) : (
            groups
              .filter((g) => g.items.length)
              .map((g) => (
                <section key={g.key} className="portfolio-group" aria-labelledby={`pg-${g.key}`}>
                  <h2 id={`pg-${g.key}`}>
                    {g.color !== null && <span className="theme-dot" style={tint(g.color)} aria-hidden="true" />}
                    {g.title}
                    <span className="cnt">{g.items.length}</span>
                  </h2>
                  {g.sub && <p className="muted">{g.sub}</p>}
                  <div className="project-grid">
                    {g.items.map((p) => (
                      <ProjectCard
                        key={p.id}
                        slug={slug}
                        p={p}
                        programme={group !== "programme" && p.parentId ? byId.get(p.parentId)?.name : undefined}
                      />
                    ))}
                  </div>
                </section>
              ))
          )}
        </>
      )}
      {dialog === "new" && (
        <ProjectDialog
          slug={slug}
          themes={portfolio.themes}
          people={portfolio.people}
          canChangeLead
          governance={{
            programs: portfolio.programs,
            permissions: portfolio.permissions,
            // A new project can join any programme not already at the deepest level
            programmeChoices: portfolio.projects.filter((p) => depthIn(byId, p.id) < MAX_DEPTH).map((p) => ({ id: p.id, name: p.name })),
          }}
          onClose={() => setDialog(null)}
          onSubmit={async (input) => {
            const res = await createProjectAction(slug, input);
            if (res.ok) router.push(`/w/${slug}/projects/${res.data.slug}`);
            return res;
          }}
        />
      )}
      {dialog === "themes" && <ThemesDialog slug={slug} themes={portfolio.themes} onClose={() => setDialog(null)} />}
      {dialog === "import" && (
        <ImportDialog
          slug={slug}
          trackers={trackers}
          syncOn={syncOn}
          canManageTrackers={canManageTrackers}
          themes={portfolio.themes}
          onClose={() => setDialog(null)}
          onDone={(ids, _finished, failed) => {
            setDialog(null);
            setImported({ ids, failed });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------- The form of a project ----------

export interface ProjectFormValues {
  name: string;
  summary: string;
  description: string;
  themeId: string | null;
  status: ProjectStatus;
  health: ProjectHealth | null;
  leadId: string | null;
  startDate: string | null;
  targetDate: string | null;
  links: ProjectLink[];
  memberIds: string[];
  parentId?: string | null;
  visibility?: "workspace" | "members";
  membersEdit?: boolean;
}

/** What the Enterprise plan lets a project decide, when the person may decide it */
export interface Governance {
  programs: boolean;
  permissions: boolean;
  programmeChoices: { id: string; name: string }[];
}

export function ProjectDialog({
  slug,
  initial,
  themes,
  people,
  canChangeLead,
  governance,
  syncedWith,
  onClose,
  onSubmit,
}: {
  slug: string;
  initial?: ProjectFormValues;
  /** The tool it follows: its name (and, but for a repository, its status and dates) is replaced at each update */
  syncedWith?: { kind: SourceKind; what: SourceWhat };
  themes: Portfolio["themes"];
  people: Portfolio["people"];
  canChangeLead: boolean;
  /** Enterprise settings, offered to the people who may decide them (absent: hidden) */
  governance?: Governance;
  onClose: () => void;
  onSubmit: (values: ProjectFormValues) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const t = useTranslations("projects");
  const ti = useTranslations("projectImport");
  const titleId = useId();
  const [v, setV] = useState<ProjectFormValues>(
    initial ?? {
      name: "",
      summary: "",
      description: "",
      themeId: null,
      status: "active",
      health: null,
      leadId: null,
      startDate: null,
      targetDate: null,
      links: [],
      memberIds: [],
    },
  );
  const [find, setFind] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<ProjectFormValues>) => setV((x) => ({ ...x, ...patch }));
  const candidates = useMemo(
    () => people.filter((p) => !find.trim() || p.name.toLowerCase().includes(find.trim().toLowerCase())),
    [people, find],
  );
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await onSubmit({ ...v, links: v.links.filter((l) => l.url.trim()) });
    setBusy(false);
    if (!res.ok) setError(res.error);
  };
  return (
    <Modal onClose={onClose} labelledBy={titleId}>
      <form className="form dialog-form project-form" onSubmit={submit}>
        <h2 id={titleId}>{initial ? t("editTitle", { name: initial.name }) : t("newTitle")}</h2>
        {syncedWith && (
          <p className="banner">
            <ToolMark kind={syncedWith.kind} />
            <span className="grow">
              {t(isRepository(syncedWith.kind, syncedWith.what) ? "source.editHintRepo" : "source.editHint", {
                tool: ti(`tools.${syncedWith.kind}`),
              })}
            </span>
          </p>
        )}
        <FormAlert>{error}</FormAlert>
        <Field label={t("name")}>
          {(p) => <input {...p} required maxLength={100} value={v.name} onChange={(e) => set({ name: e.target.value })} />}
        </Field>
        <Field label={t("summary")} hint={t("summaryHint")}>
          {(p) => <input {...p} maxLength={200} value={v.summary} onChange={(e) => set({ summary: e.target.value })} />}
        </Field>
        <div className="grid2">
          <Field label={t("theme")}>
            {(p) => (
              <Select {...p} value={v.themeId ?? ""} onChange={(e) => set({ themeId: e.target.value || null })}>
                <option value="">{t("noTheme")}</option>
                {themes.map((th) => (
                  <option key={th.id} value={th.id}>
                    {th.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t("statusLabel")}>
            {(p) => (
              <Select {...p} value={v.status} onChange={(e) => set({ status: e.target.value as ProjectStatus })}>
                {PROJECT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`status.${s}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <HealthPicker value={v.health} onChange={(health) => set({ health })} />
        {governance?.programs && (
          <Field label={t("programme")} hint={t("programmeHint")}>
            {(p) => (
              <Select {...p} value={v.parentId ?? ""} onChange={(e) => set({ parentId: e.target.value || null })}>
                <option value="">{t("noProgramme")}</option>
                {governance.programmeChoices.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {governance?.permissions && (
          <fieldset className="field visibility-picker">
            <legend>{t("visibility")}</legend>
            <label className="check">
              <input
                type="radio"
                name="visibility"
                checked={(v.visibility ?? "workspace") === "workspace"}
                onChange={() => set({ visibility: "workspace" })}
              />{" "}
              {t("visibilityWorkspace")}
            </label>
            <label className="check">
              <input type="radio" name="visibility" checked={v.visibility === "members"} onChange={() => set({ visibility: "members" })} />{" "}
              {t("visibilityMembers")}
            </label>
            <label className="check">
              <input type="checkbox" checked={!!v.membersEdit} onChange={(e) => set({ membersEdit: e.target.checked })} />{" "}
              {t("membersEdit")}
            </label>
          </fieldset>
        )}
        <div className="grid2">
          <Field label={t("start")}>
            {(p) => <input {...p} type="date" value={v.startDate ?? ""} onChange={(e) => set({ startDate: e.target.value || null })} />}
          </Field>
          <Field label={t("target")}>
            {(p) => <input {...p} type="date" value={v.targetDate ?? ""} onChange={(e) => set({ targetDate: e.target.value || null })} />}
          </Field>
        </div>
        <Field label={t("lead")} hint={canChangeLead ? undefined : t("leadLocked")}>
          {(p) => (
            <Select {...p} disabled={!canChangeLead} value={v.leadId ?? ""} onChange={(e) => set({ leadId: e.target.value || null })}>
              <option value="">{initial ? t("noLead") : t("leadMe")}</option>
              {people.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <fieldset className="field member-picker">
          <legend>{t("members", { count: v.memberIds.length })}</legend>
          <input
            type="search"
            placeholder={t("findPeople")}
            aria-label={t("findPeople")}
            value={find}
            onChange={(e) => setFind(e.target.value)}
          />
          <div className="member-list">
            {candidates.map((x) => (
              <label key={x.id} className="check">
                <input
                  type="checkbox"
                  checked={v.memberIds.includes(x.id) || v.leadId === x.id}
                  disabled={v.leadId === x.id}
                  onChange={(e) => set({ memberIds: e.target.checked ? [...v.memberIds, x.id] : v.memberIds.filter((id) => id !== x.id) })}
                />
                <PersonFace slug={slug} person={x} size="xs" />
                {x.name}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="field links-editor">
          <legend>{t("links")}</legend>
          {v.links.map((l, i) => (
            <div key={i} className="link-row">
              <Select
                aria-label={t("linkKind")}
                value={l.kind}
                onChange={(e) =>
                  set({ links: v.links.map((x, j) => (j === i ? { ...x, kind: e.target.value as ProjectLink["kind"] } : x)) })
                }
              >
                {(["gitlab", "github", "jira", "linear", "url"] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`linkKinds.${k}`)}
                  </option>
                ))}
              </Select>
              <input
                aria-label={t("linkLabel")}
                placeholder={t("linkLabel")}
                maxLength={80}
                value={l.label}
                onChange={(e) => set({ links: v.links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })}
              />
              <input
                type="url"
                aria-label={t("linkUrl")}
                placeholder="https://"
                maxLength={500}
                value={l.url}
                onChange={(e) => set({ links: v.links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={t("linkRemove")}
                onClick={() => set({ links: v.links.filter((_, j) => j !== i) })}
              >
                ✕
              </button>
            </div>
          ))}
          {v.links.length < 20 && (
            <button type="button" className="linkbtn" onClick={() => set({ links: [...v.links, { kind: "url", label: "", url: "" }] })}>
              + {t("linkAdd")}
            </button>
          )}
        </fieldset>
        <Field label={t("description")} hint={t("descriptionHint")}>
          {(p) => (
            <MdEditor
              id={p.id}
              label={t("description")}
              className="project-description"
              value={v.description}
              onChange={(description) => set({ description: description.slice(0, 20_000) })}
            />
          )}
        </Field>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            {t("cancel")}
          </button>
          <button type="submit" className="btn primary" disabled={busy} aria-busy={busy}>
            {initial ? t("save") : t("create")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Themes of the portfolio: added, renamed, deleted (their projects keep going, without a theme) */
function ThemesDialog({ slug, themes, onClose }: { slug: string; themes: Portfolio["themes"]; onClose: () => void }) {
  const t = useTranslations("projects");
  const router = useRouter();
  const titleId = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState(() => Object.fromEntries(themes.map((th) => [th.id, th.name])));
  const [confirmDialog, confirm] = useConfirm();
  const after = (res: { ok: true } | { ok: false; error: string }) => {
    if (res.ok) {
      setError(null);
      router.refresh();
    } else setError(res.error);
    return res.ok;
  };
  return (
    <Modal onClose={onClose} labelledBy={titleId}>
      <div className="form dialog-form">
        <h2 id={titleId}>{t("themes")}</h2>
        <p className="hint">{t("themesHint")}</p>
        <FormAlert>{error}</FormAlert>
        <ul className="theme-list">
          {themes.map((th) => (
            <li key={th.id}>
              <span className="theme-dot" style={tint(th.color)} aria-hidden="true" />
              <input
                aria-label={t("themeName")}
                value={names[th.id] ?? ""}
                maxLength={60}
                onChange={(e) => setNames((x) => ({ ...x, [th.id]: e.target.value }))}
                onBlur={async () => {
                  if ((names[th.id] ?? "").trim() && names[th.id] !== th.name) after(await renameThemeAction(slug, th.id, names[th.id]!));
                }}
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={t("themeDelete", { name: th.name })}
                onClick={async () => {
                  if (await confirm({ message: t("themeDeleteConfirm", { name: th.name }), confirmLabel: t("delete"), danger: true }))
                    after(await deleteThemeAction(slug, th.id));
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
        <form
          className="controls"
          onSubmit={async (e) => {
            e.preventDefault();
            if (name.trim() && after(await addThemeAction(slug, name))) setName("");
          }}
        >
          <input
            aria-label={t("themeName")}
            placeholder={t("themeNew")}
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="submit" className="btn">
            {t("themeAdd")}
          </button>
        </form>
        <div className="dialog-actions">
          <button type="button" className="btn primary" onClick={onClose}>
            {t("close")}
          </button>
        </div>
        {confirmDialog}
      </div>
    </Modal>
  );
}

// ---------- Dashboard (Team) ----------

function PortfolioDashboard({
  slug,
  data,
  weeks,
  periods,
  onWeeks,
}: {
  slug: string;
  data: PortfolioDTO;
  weeks: number;
  periods: number[];
  onWeeks: (weeks: number) => void;
}) {
  const t = useTranslations("projects");
  const fmt = formatters(useLocale() as Locale);
  const projects = data.projects.filter((p) => !["done", "cancelled"].includes(p.status) || p.healthByWeek.some(Boolean));
  const watch = projects.filter((p) => p.overdue || p.quiet || (p.health && p.health !== "onTrack"));
  const dated = projects.filter((p) => p.targetDate).sort((a, b) => a.targetDate!.localeCompare(b.targetDate!));
  const today = new Date().toISOString().slice(0, 10);
  // Due dates on one line: from today (or the earliest one) to the latest
  const first = dated.length ? (dated[0]!.targetDate! < today ? dated[0]!.targetDate! : today) : today;
  const last = dated.length ? dated[dated.length - 1]!.targetDate! : today;
  const span = Math.max(1, Date.parse(last) - Date.parse(first));
  const at = (d: string) => `${((Date.parse(d) - Date.parse(first)) / span) * 100}%`;
  return (
    <div className="portfolio-dashboard">
      <div className="toolbar">
        <Select
          aria-label={t("dashboard.period")}
          style={{ width: "auto" }}
          value={String(weeks)}
          onChange={(e) => onWeeks(Number(e.target.value))}
        >
          {periods.map((w) => (
            <option key={w} value={w}>
              {t("dashboard.weeks", { count: w })}
            </option>
          ))}
        </Select>
        <ExportCsv name={t("csv.fileName")} href={`/api/w/${slug}/projects/export?weeks=${weeks}`} />
      </div>
      <section className="panel" aria-labelledby="pd-watch">
        <h2 id="pd-watch">{t("dashboard.watch")}</h2>
        {watch.length ? (
          <ul className="watch-list">
            {watch.map((p) => (
              <li key={p.id}>
                <Link href={`/w/${slug}/projects/${p.slug}`}>{p.name}</Link>
                <HealthBadge health={p.health} />
                {p.overdue && <span className="status-chip late">{t("dashboard.overdue")}</span>}
                {p.quiet && <span className="status-chip">{t("dashboard.quiet")}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">{t("dashboard.allGood")}</p>
        )}
      </section>
      <section className="panel" aria-labelledby="pd-health">
        <h2 id="pd-health">{t("dashboard.healthOverTime")}</h2>
        <div className="table-wrap">
          <table className="health-grid">
            <thead>
              <tr>
                <th scope="col">{t("dashboard.project")}</th>
                {data.weeks.map((w) => (
                  <th key={w} scope="col" title={fmt.dateShort(w)}>
                    <span className="wk">{fmt.dateShort(w)}</span>
                  </th>
                ))}
                <th scope="col">{t("dashboard.done")}</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <th scope="row">
                    <Link href={`/w/${slug}/projects/${p.slug}`}>{p.name}</Link>
                    {p.theme && <span className="muted"> · {p.theme}</span>}
                  </th>
                  {p.healthByWeek.map((h, i) => (
                    <td key={data.weeks[i]} className={`hcell h-${h ?? "none"}`} title={h ? t(`health.${h}`) : t("health.none")}>
                      <span className="sr-only">{h ? t(`health.${h}`) : t("health.none")}</span>
                    </td>
                  ))}
                  <td className="num">{p.doneByWeek.reduce((a, b) => a + b, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {dated.length > 0 && (
        <section className="panel" aria-labelledby="pd-due">
          <h2 id="pd-due">{t("dashboard.dueDates")}</h2>
          <div className="due-line" role="list">
            <span className="due-today" style={{ insetInlineStart: at(today) }} aria-hidden="true" />
            {dated.map((p, i) => (
              <span
                key={p.id}
                role="listitem"
                className={`due-mark${p.overdue ? " late" : ""}`}
                style={{ insetInlineStart: at(p.targetDate!), top: `${(i % 3) * 2.2 + 0.4}em` }}
              >
                <Link href={`/w/${slug}/projects/${p.slug}`}>{p.name}</Link>
                <span className="muted"> · {fmt.dateShort(p.targetDate!)}</span>
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
