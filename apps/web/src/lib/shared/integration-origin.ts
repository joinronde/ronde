import type { ForgeSettings, SettingsDTO, Snapshot } from "@ronde/core/types";

// Where a meeting's access to a tool comes from, as its integration cards say: inherited from the workspace (its
// hosts picked nothing), the workspace's, the meeting's own, the server's. Pure, for the settings and their tests

export type Origin = "inherited" | "workspace" | "meeting" | "instance";

/** The origins of the GitLab or GitHub connections a meeting uses, each once, in their order */
export function forgeOrigins(forges: ForgeSettings, kind: "gitlab" | "github"): Origin[] {
  const scopes = [
    ...new Set(forges[kind].sources.map((u) => forges.connections.find((c) => c.id === u.connection)?.scope).filter((x) => !!x)),
  ];
  if (!forges[kind].picked && scopes.length && scopes.every((x) => x === "workspace")) return ["inherited"];
  return scopes;
}

/** The video call's origin: a BigBlueButton server of the workspace (named), or the meeting's own link, room or server */
export function videoOrigin(video: SettingsDTO["video"], accounts: Snapshot["videoAccounts"]): { origin: Origin; server?: string } {
  const server = video.provider === "bbb" ? accounts.find((a) => a.kind === "bbb" && a.id === video.bbbAccount) : undefined;
  return server ? { origin: "workspace", server: server.name } : { origin: "meeting" };
}
