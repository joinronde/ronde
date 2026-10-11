"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Select } from "@/components/select";
import { ProjectChip } from "./project-bits";
import { useRonde } from "./ronde-provider";

/** Projects the meeting follows, in the order of its project round; picked among the workspace's portfolio */
export function MeetingProjectsPanel() {
  const t = useTranslations("projects.followed");
  const { s, rpc, projectLogo } = useRonde();
  const ids = s.projects.map((p) => p.id);
  const save = (projectIds: string[], ok?: string) => rpc({ op: "meeting.projects", projectIds }, ok);
  const move = (i: number, d: -1 | 1) => {
    const next = [...ids];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    void save(next);
  };
  const choices = (s.projectChoices ?? []).filter((p) => !ids.includes(p.id) && !["done", "cancelled"].includes(p.status));
  const portfolio = `/w/${s.context.workspace.slug}/projects`;
  const round = s.settings.agenda.some((b) => b.type === "projects");
  return (
    <div className="panel form">
      <h3 style={{ margin: 0 }}>{t("title")}</h3>
      <p className="hint" style={{ margin: 0 }}>
        {t("intro")}{" "}
        <Link href={portfolio} className="link">
          {t("portfolio")}
        </Link>
      </p>
      {!round && s.projects.length > 0 && <div className="note-box">{t("noRound")}</div>}
      {s.projects.length ? (
        <ol className="agenda-blocks">
          {s.projects.map((p, i) => (
            <li key={p.id}>
              <span className="agenda-label">
                <ProjectChip name={p.name} color={p.color} logo={projectLogo(p)} />
                {p.theme && <span className="hint"> · {p.theme.name}</span>}
                {p.status !== "active" && <span className="hint"> · {t("notActive")}</span>}
              </span>
              <span className="controls">
                <button
                  type="button"
                  className="icon-btn"
                  disabled={i === 0}
                  aria-label={t("up", { name: p.name })}
                  onClick={() => move(i, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  disabled={i === s.projects.length - 1}
                  aria-label={t("down", { name: p.name })}
                  onClick={() => move(i, 1)}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t("remove", { name: p.name })}
                  onClick={() =>
                    void save(
                      ids.filter((id) => id !== p.id),
                      t("removed", { name: p.name }),
                    )
                  }
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">{t("none")}</p>
      )}
      {choices.length > 0 ? (
        <Select
          aria-label={t("add")}
          value=""
          onChange={(e) => {
            const p = choices.find((x) => x.id === e.target.value);
            if (p) void save([...ids, p.id], t("added", { name: p.name }));
          }}
          style={{ width: "auto" }}
        >
          <option value="">+ {t("add")}</option>
          {choices.map((p) => (
            <option key={p.id} value={p.id}>
              {p.theme ? `${p.name} (${p.theme})` : p.name}
            </option>
          ))}
        </Select>
      ) : (
        !s.projectChoices?.length && (
          <p className="hint">
            {t("emptyPortfolio")}{" "}
            <Link href={`${portfolio}?new=1`} className="link">
              {t("create")}
            </Link>
          </p>
        )
      )}
    </div>
  );
}
