import { describe, expect, it } from "vitest";
import { newRoom, type VideoConfig, videoLink } from "../src/video";

// Link to join the call, per video tool

const config = (o: Partial<VideoConfig>): VideoConfig => ({
  provider: "link",
  jitsiUrl: "",
  bbbAccount: "",
  bbbUrl: "",
  room: "abc",
  roomAccount: "",
  ...o,
});

describe("videoLink", () => {
  it("gives the free link, the Jitsi room or Ronde's BigBlueButton entry", () => {
    expect(videoLink(config({}), "https://meet.example.com/team", "/join")).toBe("https://meet.example.com/team");
    expect(videoLink(config({ provider: "jitsi" }), "", "/join")).toBe("https://meet.jit.si/Rondeabc");
    expect(videoLink(config({ provider: "jitsi", jitsiUrl: "https://jitsi.example.org/" }), "", "/join")).toBe(
      "https://jitsi.example.org/Rondeabc",
    );
    expect(videoLink(config({ provider: "bbb", bbbUrl: "https://bbb.example.org/bigbluebutton" }), "", "/join")).toBe("/join");
    // On a server of the workspace
    expect(videoLink(config({ provider: "bbb", bbbAccount: "server-1" }), "", "/join")).toBe("/join");
  });

  it("gives nothing for a BigBlueButton without its server", () => {
    expect(videoLink(config({ provider: "bbb" }), "https://ignored", "/join")).toBe("");
  });

  it("draws room names hard to guess", () => {
    const rooms = new Set(Array.from({ length: 50 }, newRoom));
    expect(rooms.size).toBe(50);
    for (const r of rooms) expect(r).toMatch(/^[A-Za-z2-9]{20}$/);
  });
});
