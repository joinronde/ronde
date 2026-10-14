"use client";

import * as Popover from "@radix-ui/react-popover";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Highlighted } from "./highlighted";
import { ProjectChip } from "./project-bits";

export interface PickableProject {
  id: string;
  name: string;
  color: number;
  theme?: string;
  logo?: string | null;
}

/** Above so many projects, a search field comes first */
const SEARCH_FROM = 6;

/**
 * A button opening the projects to pick from, in sections (followed ones, the rest of the portfolio), searchable
 * when they are many; what to do when none is left goes in the footer (create one in the portfolio).
 */
export function ProjectPicker({
  trigger,
  triggerClass = "btn",
  label,
  sections,
  onPick,
  empty,
  footer,
}: {
  trigger: React.ReactNode;
  triggerClass?: string;
  /** Accessible name of the list */
  label: string;
  sections: { title?: string; items: PickableProject[] }[];
  onPick: (p: PickableProject) => void;
  /** Said when there is nothing to pick */
  empty: string;
  footer?: React.ReactNode;
}) {
  const t = useTranslations("projectPicker");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const total = sections.reduce((n, s) => n + s.items.length, 0);
  const shown = sections
    .map((s) => ({
      ...s,
      items: s.items.filter((p) => !needle || p.name.toLowerCase().includes(needle) || (p.theme ?? "").toLowerCase().includes(needle)),
    }))
    .filter((s) => s.items.length);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ("");
      }}
    >
      <Popover.Trigger asChild>
        <button type="button" className={triggerClass}>
          {trigger}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="project-pick-pop" sideOffset={6} align="start" collisionPadding={12} aria-label={label}>
          {total > SEARCH_FROM && (
            <label className="search-input">
              <Search size={15} strokeWidth={2} aria-hidden="true" />
              <input
                type="search"
                autoFocus
                placeholder={t("search")}
                aria-label={t("search")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
          )}
          {!total ? (
            <p className="project-pick-empty">{empty}</p>
          ) : !shown.length ? (
            <p className="project-pick-empty">{t("noMatch")}</p>
          ) : (
            <div className="project-pick-list">
              {shown.map((s, i) => (
                <div key={i} role="group" aria-label={s.title}>
                  {s.title && <p className="project-pick-title">{s.title}</p>}
                  {s.items.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="project-pick-item"
                      onClick={() => {
                        onPick(p);
                        setOpen(false);
                        setQ("");
                      }}
                    >
                      <ProjectChip name={<Highlighted text={p.name} query={q} anywhere />} color={p.color} logo={p.logo} />
                      {p.theme && (
                        <span className="hint">
                          <Highlighted text={p.theme} query={q} anywhere />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
          {footer && <div className="project-pick-foot">{footer}</div>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
