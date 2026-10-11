// The tools projects are imported from, and what of each becomes a project of the portfolio: shared by the
// server (lib/server/project-sources.ts) and the import dialog

export const SOURCE_KINDS = ["github", "gitlab", "jira", "linear"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** What becomes a project, per tool; the first is the one offered first */
export const SOURCE_WHATS = {
  github: ["repos", "milestones"],
  gitlab: ["projects", "milestones"],
  jira: ["epics"],
  linear: ["projects"],
} as const satisfies Record<SourceKind, readonly string[]>;
export type SourceWhat = "repos" | "milestones" | "epics" | "projects";

export const isWhatOf = (kind: SourceKind, what: unknown): what is SourceWhat =>
  (SOURCE_WHATS[kind] as readonly string[]).includes(what as string);

/** A repository or a GitLab project: the tool knows its name and whether it is archived, not its dates or progress */
export const isRepository = (kind: SourceKind, what: SourceWhat) => what === "repos" || (kind === "gitlab" && what === "projects");
