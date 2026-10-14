import { describe, expect, it } from "vitest";
import { liveProgress, liveSeats, turnsBefore } from "@/lib/shared/live-progress";

// The home page showed a session going on like the next one (its check-ins, its planned length): it now says
// where the session stands

const blocks = [
  { id: "intro", type: "intro" },
  { id: "round", type: "round" },
  { id: "projects", type: "projects" },
  { id: "t1", type: "timebox", title: "Demo" },
  { id: "topics", type: "topics" },
];
const turns = ["ana", "ben", "cleo"];

describe("a session going on", () => {
  it("is at the introduction, nobody has spoken yet", () => {
    expect(liveProgress(blocks, turns, "intro")).toEqual({ step: "intro", title: "", speaking: null, spoke: [], turns });
  });

  it("is someone's turn: the ones before have spoken, questions after a turn count as that turn", () => {
    expect(liveProgress(blocks, turns, "ben")).toMatchObject({ step: "turn", speaking: "ben", spoke: ["ana"] });
    expect(liveProgress(blocks, turns, "qa:ben")).toMatchObject({ step: "turn", speaking: "ben", spoke: ["ana"] });
  });

  it("is past the round table on a project, a block, the open topics or the wrap-up", () => {
    expect(liveProgress(blocks, turns, "p:billing")).toMatchObject({ step: "projects", spoke: turns });
    expect(liveProgress(blocks, turns, "t1")).toMatchObject({ step: "block", title: "Demo", spoke: turns });
    expect(liveProgress(blocks, turns, "misc")).toMatchObject({ step: "topics", spoke: turns });
    expect(liveProgress(blocks, turns, "end")).toMatchObject({ step: "end", spoke: turns });
  });

  it("places a retrospective's phases by their block, before or after the round", () => {
    const retroFirst = [{ id: "r1", type: "retro" }, ...blocks];
    expect(liveProgress(retroFirst, turns, "r1:vote")).toMatchObject({ step: "block", spoke: [] });
  });

  it("tells each person how many turns come before theirs", () => {
    const at = liveProgress(blocks, turns, "ben");
    expect(turnsBefore(at, "ana")).toBeNull();
    expect(turnsBefore(at, "ben")).toBe(0);
    expect(turnsBefore(at, "cleo")).toBe(1);
    expect(turnsBefore(at, "zoe")).toBeNull();
    expect(turnsBefore(liveProgress(blocks, turns, "intro"), "cleo")).toBe(2);
  });

  it("seats the people in their order, done, speaking or waiting, the arc over the turns done", () => {
    const people = ["zoe", "cleo", "ben", "ana"].map((id) => ({ id }));
    const { seats, share } = liveSeats(people, liveProgress(blocks, turns, "ben"));
    expect(seats.map((x) => `${x.id}:${x.state}`)).toEqual(["ana:done", "ben:speaking", "cleo:waiting", "zoe:waiting"]);
    expect(share).toBe(1.5 / 4);
  });
});
