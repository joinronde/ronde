// The shapes a page takes while it loads, and which page takes which: a list of rows, a grid of cards, a table...

export const SKELETON_KINDS = [
  "list",
  "people",
  "cards",
  "table",
  "dashboard",
  "form",
  "detail",
  "calendar",
  "stats",
  "control",
  "doc",
] as const;
export type SkeletonKind = (typeof SKELETON_KINDS)[number];

/** Each page's shape, by its route under the workspace ("" is the dashboard; "m/" the pages of a meeting) */
export const PAGE_SKELETONS: Record<string, SkeletonKind> = {
  "": "dashboard",
  actions: "list",
  calendar: "calendar",
  decisions: "list",
  insights: "stats",
  kudos: "cards",
  meetings: "list",
  "meetings/new": "form",
  people: "people",
  "people/[id]": "detail",
  projects: "table",
  "projects/[slug]": "detail",
  settings: "form",
  teams: "cards",
  templates: "cards",
  "m/control": "control",
  "m/decisions": "list",
  "m/history": "doc",
  "m/me": "form",
  "m/settings": "form",
  "m/stats": "stats",
};
