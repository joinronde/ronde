import type { ForgeConnectionView, ForgeSettings } from "@ronde/core/types";
import { describe, expect, it } from "vitest";
import { forgeOrigins, videoOrigin } from "@/lib/shared/integration-origin";

// Where a meeting's access to a tool comes from, as its integration cards say

const connection = (id: string, scope: ForgeConnectionView["scope"]): ForgeConnectionView => ({
  id,
  kind: "gitlab",
  name: id,
  url: "https://gitlab.test",
  account: "",
  scope,
  oauth: false,
});
const forges = (picked: boolean, used: string[]): ForgeSettings => ({
  connections: [
    connection("ws", "workspace"),
    connection("ws2", "workspace"),
    connection("own", "meeting"),
    connection("instance", "instance"),
  ],
  servers: { gitlab: "https://gitlab.test", github: "https://api.github.com" },
  gitlab: { picked, sources: used.map((id) => ({ connection: id, groups: "", projects: "" })) },
  github: { picked: false, sources: [] },
});

describe("the origin of a meeting's GitLab and GitHub", () => {
  it("is inherited from the workspace until its hosts pick", () => {
    expect(forgeOrigins(forges(false, ["ws", "ws2"]), "gitlab")).toEqual(["inherited"]);
    // Picked, the same connections are the workspace's
    expect(forgeOrigins(forges(true, ["ws"]), "gitlab")).toEqual(["workspace"]);
  });

  it("is the server's while the workspace has none", () => {
    expect(forgeOrigins(forges(false, ["instance"]), "gitlab")).toEqual(["instance"]);
  });

  it("names each origin once, its own connections included", () => {
    expect(forgeOrigins(forges(true, ["ws", "own", "ws2"]), "gitlab")).toEqual(["workspace", "meeting"]);
  });

  it("is nothing when no connection is used, or one left the list", () => {
    expect(forgeOrigins(forges(true, []), "gitlab")).toEqual([]);
    expect(forgeOrigins(forges(true, ["gone"]), "gitlab")).toEqual([]);
  });
});

describe("the origin of a meeting's video call", () => {
  const video = { provider: "bbb" as const, link: "", jitsiUrl: "", bbbAccount: "campus", bbbUrl: "" };
  const accounts = [
    { id: "campus", name: "Campus", kind: "bbb" as const },
    { id: "zoom", name: "Zoom", kind: "zoom" as const },
  ];

  it("is the workspace's BigBlueButton server, named", () => {
    expect(videoOrigin(video, accounts)).toEqual({ origin: "workspace", server: "Campus" });
  });

  it("is the meeting's own otherwise: its link, its room, its server", () => {
    expect(videoOrigin({ ...video, bbbAccount: "", bbbUrl: "https://bbb.own.test" }, accounts)).toEqual({ origin: "meeting" });
    expect(videoOrigin({ ...video, provider: "link", bbbAccount: "campus" }, accounts)).toEqual({ origin: "meeting" });
    // A server removed meanwhile is not named
    expect(videoOrigin({ ...video, bbbAccount: "gone" }, accounts)).toEqual({ origin: "meeting" });
  });
});
