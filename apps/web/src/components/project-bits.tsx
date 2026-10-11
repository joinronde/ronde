"use client";

import { PROJECT_HEALTHS, type ProjectHealth } from "@ronde/core/types";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Icon, type IconName } from "./shell/icons";

// Small pieces every project screen shares: the health of a project, how to pick it, its chip

const HEALTH_ICON: Record<ProjectHealth | "none", IconName> = { onTrack: "sun", atRisk: "cloudSun", offTrack: "storm", none: "dash" };

/** The health of a project, as a coloured pill with its weather */
export function HealthBadge({ health, compact }: { health: ProjectHealth | null; compact?: boolean }) {
  const t = useTranslations("projects");
  const key = health ?? "none";
  return (
    <span className={`health-pill h-${key}`} title={compact ? t(`health.${key}`) : undefined}>
      <Icon name={HEALTH_ICON[key]} size={15} />
      {compact ? <span className="sr-only">{t(`health.${key}`)}</span> : t(`health.${key}`)}
    </span>
  );
}

/** Picks the health of a project: three weathers, and none */
export function HealthPicker({
  value,
  onChange,
  disabled,
}: {
  value: ProjectHealth | null;
  onChange: (v: ProjectHealth | null) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("projects");
  const name = useId();
  return (
    <fieldset className="health-picker" disabled={disabled}>
      <legend className="lbl-s">{t("healthLabel")}</legend>
      {[...PROJECT_HEALTHS, null].map((h) => (
        <label key={h ?? "none"} className={`h-${h ?? "none"}`}>
          <input type="radio" name={name} checked={value === h} onChange={() => onChange(h)} />
          <Icon name={HEALTH_ICON[h ?? "none"]} size={16} />
          {t(`health.${h ?? "none"}`)}
        </label>
      ))}
    </fieldset>
  );
}

/** A project's name with its colour, and its logo when it has one (the colour square when it cannot be shown) */
export function ProjectChip({ name, color, logo }: { name: string; color: number; logo?: string | null }) {
  const [broken, setBroken] = useState<string | null>(null);
  const shown = logo && broken !== logo ? logo : null;
  return (
    <span className="project-chip" style={{ "--c": `var(--c${color % 6})` } as React.CSSProperties}>
      {shown && <img className="project-chip-logo" src={shown} alt="" loading="lazy" draggable={false} onError={() => setBroken(shown)} />}
      {name}
    </span>
  );
}
