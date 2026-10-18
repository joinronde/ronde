import type { AgendaBlock } from "@ronde/core/agenda";
import type { ActionDTO, SlideItemDTO } from "@ronde/core/types";
import { describe, expect, it } from "vitest";
import { actionsToReview, decidedAt, itemsOf, postableSlides, slideOf } from "@/lib/shared/slides";

let n = 0;
const action = (patch: Partial<ActionDTO> = {}): ActionDTO => ({
  id: `a${++n}`,
  text: "Something to do",
  ownerId: "alice",
  status: "open",
  progress: null,
  progressAt: null,
  originDate: null,
  originText: null,
  originStep: null,
  projectId: null,
  createdAt: n,
  doneAt: null,
  ...patch,
});
const item = (patch: Partial<SlideItemDTO>): SlideItemDTO => ({
  id: `i${++n}`,
  blockId: "s1",
  text: "Builds are slow",
  authorId: "alice",
  mine: false,
  actionId: null,
  ...patch,
});

const agenda: AgendaBlock[] = [
  { id: "intro", type: "intro" },
  { id: "s1", type: "slide", kind: "irritants", title: "Irritants" },
  { id: "round", type: "round" },
  { id: "s2", type: "slide", kind: "actions", title: "Actions" },
];

describe("slides", () => {
  it("finds a slide by its id, and the ones that take what people post", () => {
    expect(slideOf(agenda, "s2")?.title).toBe("Actions");
    expect(slideOf(agenda, "round")).toBeNull();
    expect(slideOf(agenda, undefined)).toBeNull();
    expect(postableSlides(agenda).map((b) => b.id)).toEqual(["s1"]);
  });

  it("shows what is still to deal with before what already became an action", () => {
    const done = item({ text: "Tracked", actionId: "a1" });
    const open = item({ text: "Open" });
    const other = item({ blockId: "s9" });
    expect(itemsOf([done, other, open], "s1").map((i) => i.text)).toEqual(["Open", "Tracked"]);
  });

  it("reviews the open actions that waited longest first, never the done ones", () => {
    const list = [
      action({ text: "recent", originDate: "2026-10-12" }),
      action({ text: "done", originDate: "2026-09-01", status: "done" }),
      action({ text: "old, under way", originDate: "2026-09-07", status: "doing" }),
      action({ text: "old, not started", originDate: "2026-09-07" }),
      action({ text: "no date" }),
    ];
    expect(actionsToReview(list).map((a) => a.text)).toEqual(["old, not started", "old, under way", "recent", "no date"]);
  });

  it("lists the actions decided on a slide at this session only", () => {
    const list = [
      action({ text: "here", originStep: "s1", originDate: "2026-10-19" }),
      action({ text: "last time", originStep: "s1", originDate: "2026-10-12" }),
      action({ text: "a turn", originStep: "alice", originDate: "2026-10-19" }),
    ];
    expect(decidedAt(list, "s1", "2026-10-19").map((a) => a.text)).toEqual(["here"]);
  });
});
