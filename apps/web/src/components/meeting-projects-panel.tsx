"use client";

import { PROJECTS_BY, type ProjectsBy } from "@ronde/core/types";
import { FolderKanban, FolderPlus, Plus, ShieldCheck, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ProjectChip } from "./project-bits";
import { ProjectPicker } from "./project-picker";
import { useRonde } from "./ronde-provider";
import { SortGrip, useSortable } from "./sortable";

const BY_ICONS: Record<ProjectsBy, typeof Users> = { hosts: ShieldCheck, participants: Users };

/** Projects the meeting follows, in the order of its project round; picked among the workspace's portfolio */
export function MeetingProjectsPanel() {
  const t = useTranslations("projects.followed");
  const { s, rpc, projectLogo } = useRonde();
  const ids = s.projects.map((p) => p.id);
  const save = (projectIds: string[], ok?: string) => rpc({ op: "meeting.projects", projectIds }, ok);
  const sort = useSortable({ items: s.projects, keyOf: (p) => p.id, onMove: (_from, _to, order) => save(order) });
  const choices = (s.projectChoices ?? []).filter((p) => !ids.includes(p.id) && !["done", "cancelled"].includes(p.status));
  const portfolio = `/w/${s.context.workspace.slug}/projects`;
  const round = s.settings.agenda.some((b) => b.type === "projects");
  const by = s.settings.projectsBy;
  const picker = (primary: boolean) => (
    <ProjectPicker
      trigger={
        <>
          <Plus size={16} strokeWidth={2.2} aria-hidden="true" /> {t("add")}
        </>
      }
      triggerClass={primary ? "btn primary" : "btn"}
      label={t("add")}
      sections={[{ items: choices.map((p) => ({ id: p.id, name: p.name, color: p.color, theme: p.theme })) }]}
      onPick={(p) => void save([...ids, p.id], t("added", { name: p.name }))}
      empty={s.projectChoices?.length ? t("allFollowed") : t("emptyPortfolio")}
      footer={
        <Link href={`${portfolio}?new=1`} className="project-pick-new">
          <FolderPlus size={16} strokeWidth={2} aria-hidden="true" /> {t("createInPortfolio")}
        </Link>
      }
    />
  );
  return (
    <div className="panel form meeting-projects">
      <div className="meeting-projects-head">
        <h3>{t("title")}</h3>
        {s.projects.length > 0 && picker(false)}
      </div>
      <p className="hint" style={{ margin: 0 }}>
        {t("intro")}{" "}
        <Link href={portfolio} className="link">
          {t("portfolio")}
        </Link>
      </p>
      {!round && s.projects.length > 0 && <div className="note-box">{t("noRound")}</div>}
      {s.projects.length ? (
        <ol className="agenda-blocks">
          {sort.list.map((p, i) => (
            <li key={p.id} {...sort.row(i)}>
              <SortGrip {...sort.grip(i, t("reorder", { name: p.name }))} />
              <span className="agenda-label">
                <ProjectChip name={p.name} color={p.color} logo={projectLogo(p)} />
                {p.theme && <span className="hint"> · {p.theme.name}</span>}
                {p.status !== "active" && <span className="hint"> · {t("notActive")}</span>}
              </span>
              <span className="controls">
                <button
                  type="button"
                  className="icon-btn danger"
                  aria-label={t("remove", { name: p.name })}
                  onClick={() =>
                    void save(
                      ids.filter((id) => id !== p.id),
                      t("removed", { name: p.name }),
                    )
                  }
                >
                  <Trash2 size={14} strokeWidth={2.2} aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="emptybox meeting-projects-empty">
          <span className="meeting-projects-empty-icon" aria-hidden="true">
            <FolderKanban size={22} strokeWidth={2} />
          </span>
          <p>
            <strong>{t("none")}</strong>
            <br />
            <span className="hint">{t("noneHint")}</span>
          </p>
          {picker(true)}
        </div>
      )}
      <fieldset className="plain meeting-projects-by">
        <legend className="lbl-s">{t("whoAdds")}</legend>
        <p className="hint">{t("whoAddsHint")}</p>
        <div className="choice-cards">
          {PROJECTS_BY.map((x) => {
            const ByIcon = BY_ICONS[x];
            return (
              <label key={x} className={`choice-card${by === x ? " on" : ""}`}>
                <input
                  type="radio"
                  name="projectsBy"
                  className="sr-only"
                  checked={by === x}
                  onChange={() =>
                    void rpc({ op: "meeting.projectsBy", by: x }, t("bySaved"), {
                      // The card is picked as it is clicked
                      optimistic: (snap) => ({ ...snap, settings: { ...snap.settings, projectsBy: x } }),
                    })
                  }
                />
                <ByIcon size={18} strokeWidth={2} aria-hidden="true" />
                <span>
                  <strong>{t(`by.${x}`)}</strong>
                  <span className="hint">{t(`by.${x}Hint`)}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
