"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { TemplateSummary } from "@/lib/server/templates";
import { Icon } from "../shell/icons";

/** Colour of each kind of template */
const HUE: Record<TemplateSummary["category"], number> = {
  team: 0,
  product: 1,
  leadership: 2,
  education: 3,
  nonprofit: 4,
  field: 5,
  health: 2,
  own: 1,
};

/** Every template, built in or saved by the workspace, by who it is for: one click starts a meeting from it */
export function TemplateGallery({ slug, templates, canCreate }: { slug: string; templates: TemplateSummary[]; canCreate: boolean }) {
  const t = useTranslations("gallery");
  const [category, setCategory] = useState<string>("all");
  const categories = [...new Set(templates.map((x) => x.category))];
  const shown = templates.filter((x) => category === "all" || x.category === category);
  return (
    <div className="page gallery-page">
      <header className="page-head">
        <h1>{t("title")}</h1>
        <p className="muted">{t("intro")}</p>
      </header>
      <div className="chips" role="group" aria-label={t("categories")}>
        {["all", ...categories].map((c) => (
          <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
            {t(`category.${c as "all"}`)}{" "}
            <span className="chip-count">{c === "all" ? templates.length : templates.filter((x) => x.category === c).length}</span>
          </button>
        ))}
      </div>
      <ul className="gl-grid">
        {shown.map((x, i) => (
          <li key={x.ref} className="gl-card" style={{ "--c": `var(--c${HUE[x.category]})`, "--i": i } as React.CSSProperties}>
            <div className="gl-top">
              <span className="gl-icon" aria-hidden="true">
                {x.icon}
              </span>
              <span className="gl-cat">{t(`category.${x.category}`)}</span>
            </div>
            <h2>{x.name}</h2>
            {x.description && <p className="gl-desc">{x.description}</p>}
            <ul className="gl-facts">
              <li>
                <Icon name="calendar" size={14} /> {x.schedule}
              </li>
              <li>
                <Icon name="clock" size={14} /> {t("minutes", { count: x.data.settings.targetMin })}
              </li>
            </ul>
            <ul className="tpl-chips" aria-label={t("sections")}>
              {x.sections.map((s) => (
                <li key={s} className="tpl-chip">
                  {s}
                </li>
              ))}
            </ul>
            {canCreate && (
              <Link href={`/w/${slug}/meetings/new?template=${encodeURIComponent(x.ref)}`} className="btn gl-use">
                {t("use")}
              </Link>
            )}
          </li>
        ))}
      </ul>
      <p className="hint">{t("saveHint")}</p>
    </div>
  );
}
