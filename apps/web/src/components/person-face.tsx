"use client";

import { withBasePath } from "@/lib/shared/base-path";
import { initials } from "./shell/app-shell";

/** What a face needs: the person, their colour, and the version of their photo (null or missing: none) */
export interface FacePerson {
  id: string;
  name: string;
  color?: number;
  avatar?: number | null;
}

/** A person's face in the workspace's pages: their photo when they have one, their initials otherwise */
export function PersonFace({ slug, person, size = "sm", title }: { slug: string; person: FacePerson; size?: "xs" | "sm"; title?: string }) {
  return (
    <span
      className={`av ${size}${person.avatar ? " img" : ""}`}
      style={{ "--c": `var(--c${(person.color ?? 0) % 6})` } as React.CSSProperties}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      {person.avatar ? (
        <img src={withBasePath(`/api/w/${slug}/avatar/${person.id}?v=${person.avatar}`)} alt="" loading="lazy" draggable={false} />
      ) : (
        initials(person.name)
      )}
    </span>
  );
}
