"use client";

import { markdownToHtml } from "@ronde/core/markdown";
import { taskOf } from "@ronde/core/util";
import { formatters, type Locale } from "@ronde/i18n";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import {
  archiveProjectAction,
  deleteProjectAction,
  followProjectAction,
  syncProjectAction,
  unlinkSourceAction,
  updateProjectAction,
} from "@/app/w/[ws]/project-actions";
import { type MarkProject, ProjectMark, projectLogoSrc } from "@/components/project-mark";
import { Select } from "@/components/select";
import { ShowMore, useShowMore } from "@/components/show-more";
import { squareImage } from "@/components/square-image";
import { ToolMark } from "@/components/tool-mark";
import type { ProjectPage } from "@/lib/server/projects";
import { withBasePath } from "@/lib/shared/base-path";
import { ago, firstLine } from "@/lib/shared/helpers";
import { byMonth, limitGroups } from "@/lib/shared/show-more";
import { HealthBadge } from "../project-bits";
import { Icon } from "../shell/icons";
import { NewTab } from "../shell/new-tab";
import { useConfirm } from "./confirm";
import { PeopleStack, ProjectDialog } from "./projects";

// One project of the portfolio: what it is, who works on it, the meetings that follow it, and what they said
// about it session after session

const ROLE_ORDER = ["achievement", "plan", "blocker", "note", "custom"] as const;

export function ProjectView({ slug, page }: { slug: string; page: ProjectPage }) {
  const t = useTranslations("projects");
  const locale = useLocale();
  const fmt = formatters(locale as Locale);
  // The timeline a month at a time, the first sessions then more on demand
  const more = useShowMore(10);
  const timelineMonths = byMonth(page.timeline, (e) => e.date);
  const shownMonths = limitGroups(timelineMonths, more.limit);
  const monthTotal = (key: string) => timelineMonths.find((m) => m.key === key)?.items.length ?? 0;
  const monthName = (key: string) => {
    const s = new Date(`${key}-01T12:00:00Z`).toLocaleDateString(locale, { month: "long", year: "numeric", timeZone: "UTC" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
  const router = useRouter();
  const { project: p } = page;
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const done = async (res: { ok: true } | { ok: false; error: string }) => {
    if (res.ok) {
      setError(null);
      router.refresh();
    } else setError(res.error);
  };
  return (
    <div className="page project-page" style={{ "--c": `var(--c${p.color % 6})` } as React.CSSProperties}>
      <nav className="crumbs-back">
        <Link href={`/w/${slug}/projects`} className="link">
          <span className="back-arrow" aria-hidden="true">
            ←
          </span>{" "}
          {t("title")}
        </Link>
      </nav>
      <header className="page-head row project-head">
        <div className="project-title">
          <LogoPicker slug={slug} project={p} canEdit={page.canManage} onError={setError} />
          <div>
            <h1>{p.name}</h1>
            {/* Imported, the description often starts with the summary: said once */}
            {p.summary && firstLine(p.description) !== p.summary.trim() && <p className="muted">{p.summary}</p>}
            {page.parent && (
              <p className="muted">
                {t.rich("partOfLink", {
                  name: page.parent.name,
                  link: (chunks) => (
                    <Link href={`/w/${slug}/projects/${page.parent!.slug}`} className="link">
                      {chunks}
                    </Link>
                  ),
                })}
              </p>
            )}
            <div className="project-card-meta">
              <HealthBadge health={p.health} />
              {p.private && (
                <span className="status-chip" title={t("visibilityMembers")}>
                  <Icon name="lock" size={13} /> {t("private")}
                </span>
              )}
              <span className={`status-chip s-${p.status}`}>{t(`status.${p.status}`)}</span>
              {p.archived && <span className="status-chip">{t("archived")}</span>}
              {p.theme && <span className="theme-tag">{p.theme.name}</span>}
              {p.startDate && <span className="muted">{t("started", { date: fmt.dateShort(p.startDate) })}</span>}
              {p.targetDate && <span className="muted">{t("due", { date: fmt.dateShort(p.targetDate) })}</span>}
            </div>
          </div>
        </div>
        {page.canManage && (
          <div className="actions">
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              {t("edit")}
            </button>
            {page.canGovern && (
              <button type="button" className="btn" onClick={async () => done(await archiveProjectAction(slug, p.id, !p.archived))}>
                {p.archived ? t("restore") : t("archive")}
              </button>
            )}
            {page.canDelete && (
              <button
                type="button"
                className="btn danger"
                onClick={async () => {
                  if (!(await confirm({ message: t("deleteConfirm", { name: p.name }), confirmLabel: t("delete"), danger: true }))) return;
                  const res = await deleteProjectAction(slug, p.id);
                  if (res.ok) router.push(`/w/${slug}/projects`);
                  else setError(res.error);
                }}
              >
                {t("delete")}
              </button>
            )}
          </div>
        )}
      </header>
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      <div className="project-layout">
        <div className="project-main">
          {p.description.trim() ? (
            <div className="panel md" dangerouslySetInnerHTML={{ __html: markdownToHtml(p.description) }} />
          ) : (
            <p className="muted">{t("noDescription")}</p>
          )}
          <section aria-labelledby="pj-timeline">
            <h2 id="pj-timeline">{t("timeline")}</h2>
            {page.timeline.length ? (
              <div className="project-months">
                {shownMonths.groups.map((mo) => (
                  <section key={mo.key} className="project-month" aria-label={monthName(mo.key)}>
                    <h3 className="project-month-title">
                      {monthName(mo.key)} <span className="act-n">{monthTotal(mo.key)}</span>
                    </h3>
                    <ol className="project-timeline">
                      {mo.items.map((e) => (
                        <li key={e.sessionId} className="panel">
                          <header>
                            <strong>{fmt.dateShort(e.date)}</strong>
                            <Link href={`/w/${slug}/m/${e.meeting.id}/history`} className="link">
                              {e.meeting.name}
                            </Link>
                            {e.health && <HealthBadge health={e.health} />}
                          </header>
                          {e.headline.trim() && (
                            <div className="md project-headline" dangerouslySetInnerHTML={{ __html: markdownToHtml(e.headline) }} />
                          )}
                          {ROLE_ORDER.map((role) => {
                            const items = e.items.filter((i) => i.role === role);
                            if (!items.length) return null;
                            return (
                              <div key={role} className="timeline-role">
                                <h3 className={`role-${role}`}>{t(`roles.${role}`)}</h3>
                                <ul>
                                  {items.map((i, n) => {
                                    const task = taskOf(i.text);
                                    return (
                                      <li key={n}>
                                        <span className="muted">{i.name} · </span>
                                        {task.done === true ? "☑ " : task.done === false ? "☐ " : ""}
                                        {task.text}
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            );
                          })}
                          {e.decisions.length > 0 && (
                            <div className="timeline-role">
                              <h3>{t("decisions")}</h3>
                              <ul>
                                {e.decisions.map((d, n) => (
                                  <li key={n}>{d}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </li>
                      ))}
                    </ol>
                  </section>
                ))}
                <ShowMore hidden={shownMonths.hidden} step={more.step} onMore={more.more} />
              </div>
            ) : (
              <p className="muted">{t("noTimeline")}</p>
            )}
          </section>
        </div>
        <aside className="project-side">
          {page.children.length > 0 && (
            <section className="panel" aria-labelledby="pj-children">
              <h2 id="pj-children">{t("subProjects")}</h2>
              {page.rolledHealth && (
                <p className="muted">
                  {t("rolledHealth")} <HealthBadge health={page.rolledHealth} />
                </p>
              )}
              <ul className="plain-list">
                {page.children.map((c) => (
                  <li key={c.slug} className="row-between">
                    <Link href={`/w/${slug}/projects/${c.slug}`} className="link">
                      {c.name}
                    </Link>
                    <HealthBadge health={c.health} compact />
                  </li>
                ))}
              </ul>
            </section>
          )}
          {p.source && <SourcePanel slug={slug} id={p.id} name={p.name} source={p.source} canManage={page.canManage} />}
          <section className="panel" aria-labelledby="pj-people">
            <h2 id="pj-people">{t("people")}</h2>
            {p.lead && <p>{t("leadBy", { name: p.lead.name })}</p>}
            {p.members.length ? (
              <>
                <PeopleStack slug={slug} people={p.members} max={8} />
                <ul className="plain-list">
                  {p.members.map((m) => (
                    <li key={m.id}>
                      <Link href={`/w/${slug}/people/${m.id}`} className="link">
                        {m.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="muted">{t("noMembers")}</p>
            )}
          </section>
          {p.links.length > 0 && (
            <section className="panel" aria-labelledby="pj-links">
              <h2 id="pj-links">{t("links")}</h2>
              <ul className="plain-list">
                {p.links.map((l, i) => (
                  <li key={i}>
                    <a href={l.url} target="_blank" rel="noopener noreferrer" className="link">
                      {l.label || t(`linkKinds.${l.kind}`)}
                      <NewTab />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="panel" aria-labelledby="pj-meetings">
            <h2 id="pj-meetings">{t("followedBy")}</h2>
            {page.meetings.length ? (
              <ul className="plain-list">
                {page.meetings.map((m) => (
                  <li key={m.id} className="row-between">
                    {m.readable ? (
                      <Link href={`/w/${slug}/m/${m.id}`} className="link">
                        {m.name}
                      </Link>
                    ) : (
                      <span>{m.name}</span>
                    )}
                    {m.canConfigure && (
                      <button
                        type="button"
                        className="linkbtn"
                        onClick={async () => done(await followProjectAction(slug, m.id, p.id, false))}
                      >
                        {t("unfollow")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">{t("notFollowed")}</p>
            )}
            {page.addable.length > 0 && (
              <Select
                aria-label={t("follow")}
                value=""
                onChange={async (e) => {
                  if (e.target.value) await done(await followProjectAction(slug, e.target.value, p.id, true));
                }}
              >
                <option value="">+ {t("follow")}</option>
                {page.addable.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            )}
          </section>
          <section className="panel" aria-labelledby="pj-actions">
            <h2 id="pj-actions">{t("openActions")}</h2>
            {page.actions.length ? (
              <ul className="plain-list">
                {page.actions.map((a) => (
                  <li key={a.id}>
                    {a.text} <span className="muted">· {a.owner}</span>
                    {a.progress && <span className="act-prog-line">{a.progress}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">{t("noActions")}</p>
            )}
          </section>
        </aside>
      </div>
      {editing && (
        <ProjectDialog
          slug={slug}
          initial={{
            name: p.name,
            summary: p.summary,
            description: p.description,
            themeId: p.themeId,
            status: p.status,
            health: p.health,
            leadId: p.lead?.id ?? null,
            startDate: p.startDate,
            targetDate: p.targetDate,
            links: p.links,
            memberIds: p.members.map((m) => m.id),
            parentId: page.parent?.id ?? null,
            visibility: p.private ? "members" : "workspace",
            membersEdit: page.membersEdit,
          }}
          themes={page.themes}
          people={page.people}
          canChangeLead={page.canHandOver}
          syncedWith={p.source?.state === "synced" ? { kind: p.source.kind, what: p.source.what } : undefined}
          governance={
            page.canGovern ? { programs: page.programs, permissions: page.permissions, programmeChoices: page.programmeChoices } : undefined
          }
          onClose={() => setEditing(false)}
          onSubmit={async (input) => {
            const res = await updateProjectAction(slug, p.id, input);
            if (res.ok) {
              setEditing(false);
              router.refresh();
            }
            return res;
          }}
        />
      )}
      {confirmDialog}
    </div>
  );
}

/** Where an imported project comes from: its page there, how far along it is, and whether it follows the tool */
function SourcePanel({
  slug,
  id,
  name,
  source: s,
  canManage,
}: {
  slug: string;
  id: string;
  name: string;
  source: NonNullable<ProjectPage["project"]["source"]>;
  canManage: boolean;
}) {
  const t = useTranslations("projects");
  const ti = useTranslations("projectImport");
  const locale = useLocale();
  const fmt = formatters(locale as Locale);
  const router = useRouter();
  const [confirmDialog, confirm] = useConfirm();
  const [busy, setBusy] = useState<"update" | "unlink" | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [error, setError] = useState<string | null>(null);
  const tool = ti(`tools.${s.kind}`);
  const act = async (which: "update" | "unlink", fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setBusy(which);
    setError(null);
    try {
      const res = await fn();
      // What went wrong with the tool shows in the panel, once the page is read again
      if (!res.ok) setError(res.error);
    } catch {
      setError(ti("offline"));
    } finally {
      setBusy(null);
      router.refresh();
    }
  };
  const following = s.state === "synced" || s.state === "gone";
  const percent = s.progress !== null ? fmt.percent(s.progress) : "";
  return (
    <section className="panel project-source" aria-labelledby="pj-source">
      <h2 id="pj-source" ref={title} tabIndex={-1}>
        <ToolMark kind={s.kind} size={16} /> {t("source.title", { tool })}
      </h2>
      {s.url && s.state !== "gone" && (
        <p>
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="link">
            <bdi>{ti(`item.${s.what}`, { key: s.key })}</bdi>
            <NewTab />
          </a>
        </p>
      )}
      {s.progress !== null &&
        (s.live ? (
          <div className="project-progress">
            <progress className="meter" max={1} value={s.progress} aria-hidden="true" />
            <span className="muted">
              {s.total !== null && s.done !== null ? t("source.issues", { done: s.done, total: s.total }) : t("progressDone", { percent })}
            </span>
          </div>
        ) : (
          // Read some time ago: said with its date, not as today's figure
          <p className="hint">{t("progressOn", { percent, date: fmt.dayMonth((s.syncedAt ?? s.importedAt).slice(0, 10)) })}</p>
        ))}
      {s.state === "synced" && (
        <p className="hint">
          {t("source.synced", { tool })}
          {s.syncedAt && (
            <span suppressHydrationWarning>{` · ${t("source.updated", { when: ago(s.syncedAt, locale, t("source.justNow")) })}`}</span>
          )}
        </p>
      )}
      {s.state === "synced" && s.problem && (
        <p className="hint warn" role="alert">
          {t(`source.${s.problem}`, { tool })}
        </p>
      )}
      {s.state === "gone" && (
        <p className="hint warn" role="alert">
          {t("source.gone", { tool })}
        </p>
      )}
      {s.state === "paused" && <p className="hint">{t("source.paused", { tool })}</p>}
      {s.state === "archived" && <p className="hint">{t("source.archived", { tool })}</p>}
      {(s.state === "trackerRemoved" || s.state === "moved") && <p className="hint">{t(`source.${s.state}`)}</p>}
      {(s.state === "once" || s.state === "unlinked") && (
        <p className="hint">{t(`source.${s.state}`, { date: fmt.dayMonth(s.importedAt.slice(0, 10)) })}</p>
      )}
      {error && (
        <p className="err" role="alert">
          {error}
        </p>
      )}
      {canManage && following && (
        <div className="row project-source-actions">
          <button
            type="button"
            className="btn"
            disabled={!!busy}
            aria-busy={busy === "update"}
            onClick={() => act("update", () => syncProjectAction(slug, id))}
          >
            {busy === "update" ? t("source.updating") : t("source.update")}
          </button>
          <button
            type="button"
            className="linkbtn"
            disabled={!!busy}
            onClick={async () => {
              if (!(await confirm({ message: t("source.unlinkConfirm", { name, tool }), confirmLabel: t("source.unlink") }))) return;
              await act("unlink", () => unlinkSourceAction(slug, id));
              // Its buttons go with the sync: focus stays in the panel
              title.current?.focus();
            }}
          >
            {t("source.unlink")}
          </button>
        </div>
      )}
      {confirmDialog}
    </section>
  );
}

/** The project's logo; those who edit the project click it to pick another one, or remove it */
function LogoPicker({
  slug,
  project,
  canEdit,
  onError,
}: {
  slug: string;
  project: MarkProject;
  canEdit: boolean;
  /** What went wrong, shown with the page's other errors */
  onError: (message: string | null) => void;
}) {
  const t = useTranslations("projects");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const mark = <ProjectMark project={project} src={projectLogoSrc(slug, project)} size="lg" />;
  if (!canEdit) return mark;
  const send = async (method: "PUT" | "DELETE", body?: Blob) => {
    setBusy(true);
    onError(null);
    try {
      const r = await fetch(withBasePath(`/api/w/${slug}/projects/${project.id}/logo`), {
        method,
        body,
        headers: body ? { "Content-Type": body.type } : undefined,
      });
      if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? t("logo.notSaved"));
      router.refresh();
      // The remove control goes with the logo: focus stays on the logo
      if (method === "DELETE") pick.current?.focus();
    } catch (e) {
      // The network's own words ("Failed to fetch") say nothing to the person
      onError(e instanceof TypeError ? t("logo.notSaved") : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="logo-picker">
      <button
        ref={pick}
        type="button"
        className="logo-pick"
        disabled={busy}
        aria-busy={busy}
        aria-label={project.logo ? t("logo.change") : t("logo.add")}
        title={project.logo ? t("logo.change") : t("logo.add")}
        onClick={() => input.current?.click()}
      >
        {mark}
        <span className="logo-pick-badge" aria-hidden="true">
          <Icon name="camera" size={14} />
        </span>
      </button>
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
            await send("PUT", await squareImage(file, "contain"));
          } catch {
            onError(t("logo.unreadable"));
          }
        }}
      />
      {project.logo && (
        <button
          type="button"
          className="logo-remove danger"
          disabled={busy}
          aria-label={t("logo.remove")}
          title={t("logo.remove")}
          onClick={() => send("DELETE")}
        >
          <Icon name="close" size={12} />
        </button>
      )}
    </div>
  );
}
