import type { ForgeConnectionView, ForgeSettings } from "@ronde/core/types";
import { describe, expect, it } from "vitest";
import { forgeOrigins } from "@/lib/server/forges";
import { videoOrigin } from "@/lib/server/video-accounts";

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
  it("is inherited from the workspace until its hosts pick, then the workspace's", () => {
    expect(forgeOrigins(forges(false, ["ws", "ws2"]), "gitlab")).toEqual(["inherited"]);
    expect(forgeOrigins(forges(true, ["ws"]), "gitlab")).toEqual(["workspace"]);
  });

  it("is the server's while the workspace has none", () => {
    expect(forgeOrigins(forges(false, ["instance"]), "gitlab")).toEqual(["instance"]);
  });

  it("names each origin once, the meeting's own connections included", () => {
    expect(forgeOrigins(forges(true, ["ws", "own", "ws2"]), "gitlab")).toEqual(["workspace", "meeting"]);
  });

  it("is nothing when no connection is used, or one left the list", () => {
    expect(forgeOrigins(forges(true, []), "gitlab")).toEqual([]);
    expect(forgeOrigins(forges(true, ["gone"]), "gitlab")).toEqual([]);
  });
});

describe("the origin of a meeting's video call", () => {
  const accounts = [
    { id: "campus", name: "Campus", kind: "bbb" },
    { id: "zoom", name: "Acme Zoom", kind: "zoom" },
  ];
  const config = { provider: "link", bbbAccount: "", roomAccount: "" };

  it("is the workspace's BigBlueButton server, or the workspace's account that made the room, named", () => {
    expect(videoOrigin({ ...config, provider: "bbb", bbbAccount: "campus" }, accounts)).toEqual({ origin: "workspace", name: "Campus" });
    expect(videoOrigin({ ...config, roomAccount: "zoom" }, accounts)).toEqual({ origin: "workspace", name: "Acme Zoom" });
  });

  it("is the meeting's own otherwise: its link, its room, its server, or an account removed", () => {
    expect(videoOrigin(config, accounts)).toEqual({ origin: "meeting", name: "" });
    expect(videoOrigin({ ...config, provider: "jitsi", roomAccount: "zoom" }, accounts)).toEqual({ origin: "meeting", name: "" });
    expect(videoOrigin({ ...config, provider: "bbb", bbbAccount: "gone" }, accounts)).toEqual({ origin: "meeting", name: "" });
    // A Zoom account is not a BigBlueButton server, nor the other way round
    expect(videoOrigin({ ...config, provider: "bbb", bbbAccount: "zoom" }, accounts)).toEqual({ origin: "meeting", name: "" });
    expect(videoOrigin({ ...config, roomAccount: "campus" }, accounts)).toEqual({ origin: "meeting", name: "" });
  });
});
