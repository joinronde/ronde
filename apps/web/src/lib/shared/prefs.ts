/** User preference: the suggestions of the paid plans are hidden (workspace administrators only see them) */
export const HIDE_UPGRADE_HINTS = "upgrade-hints:hidden";

/** User preference: the first steps of a workspace's home page are skipped (one key per workspace) */
export const firstStepsHidden = (workspaceId: string) => `first-steps:hidden:${workspaceId}`;
