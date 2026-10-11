"use client";

import { useState } from "react";
import { withBasePath } from "@/lib/shared/base-path";
import { initials } from "./shell/app-shell";

/** What a project's mark needs: its name and colour, and the version of its logo (null or missing: none) */
export interface MarkProject {
  id: string;
  name: string;
  color: number;
  logo?: number | null;
}

/** Where a project's logo is read in the workspace's pages */
export const projectLogoSrc = (slug: string, p: MarkProject) =>
  p.logo ? withBasePath(`/api/w/${slug}/projects/${p.id}/logo?v=${p.logo}`) : null;

/** A project's mark: its logo, or its initials on its colour; a rounded square, where a person's face is round */
export function ProjectMark({
  project,
  src,
  size = "sm",
  className,
}: {
  project: MarkProject;
  src: string | null;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}) {
  // A logo that cannot be shown (gone, or not for this viewer): the initials stand in
  const [broken, setBroken] = useState<string | null>(null);
  const shown = src && broken !== src ? src : null;
  return (
    <span
      className={`pm ${size}${shown ? " img" : ""}${className ? ` ${className}` : ""}`}
      style={{ "--c": `var(--c${project.color % 6})` } as React.CSSProperties}
      aria-hidden="true"
    >
      {shown ? <img src={shown} alt="" loading="lazy" draggable={false} onError={() => setBroken(shown)} /> : initials(project.name)}
    </span>
  );
}
