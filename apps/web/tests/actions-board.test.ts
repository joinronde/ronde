import { describe, expect, it } from "vitest";
import { type BoardAction, columnsOf, filterActions, isStuck, nextColumn } from "@/lib/shared/actions-board";

// The actions page as a list or a board: filtered by meeting and search, grouped by status, the oldest worries first

const action = (id: string, patch: Partial<BoardAction> = {}): BoardAction => ({
  id,
  text: `Action ${id}`,
  status: "open",
  meetingId: "m1",
  meeting: "Weekly",
  owner: { id: "p1", name: "Léa Martin" },
  originDate: "2026-10-01",
  doneAt: null,
  carried: 0,
  ...patch,
});

describe("filterActions", () => {
  const rows = [action("a"), action("b", { meetingId: "m2", meeting: "Retro" }), action("c", { text: "Book the room" })];
  it("keeps the actions of a meeting", () => {
    expect(filterActions(rows, "m2", "").map((a) => a.id)).toEqual(["b"]);
  });
  it("finds the search in the text, the meeting or the owner, accents aside", () => {
    expect(filterActions(rows, null, "room").map((a) => a.id)).toEqual(["c"]);
    expect(filterActions(rows, null, "retro").map((a) => a.id)).toEqual(["b"]);
    expect(filterActions(rows, null, "lea").map((a) => a.id)).toEqual(["a", "b", "c"]);
  });
});

describe("columnsOf", () => {
  it("puts what waits longest first, and the latest done first", () => {
    const cols = columnsOf([
      action("new", { originDate: "2026-10-10" }),
      action("old", { originDate: "2026-09-01" }),
      action("stuck", { carried: 3, originDate: "2026-10-05" }),
      action("d1", { status: "done", doneAt: "2026-10-02" }),
      action("d2", { status: "done", doneAt: "2026-10-09" }),
      action("go", { status: "doing" }),
    ]);
    expect(cols.map((c) => [c.status, c.items.map((a) => a.id)])).toEqual([
      ["open", ["stuck", "old", "new"]],
      ["doing", ["go"]],
      ["done", ["d2", "d1"]],
    ]);
  });
});

describe("isStuck and nextColumn", () => {
  it("flags what was carried over twice, never what is done", () => {
    expect(isStuck({ status: "open", carried: 2 })).toBe(true);
    expect(isStuck({ status: "done", carried: 5 })).toBe(false);
    expect(isStuck({ status: "doing", carried: 1 })).toBe(false);
  });
  it("moves one column at a time, and stops at the ends", () => {
    expect(nextColumn("open", 1)).toBe("doing");
    expect(nextColumn("doing", 1)).toBe("done");
    expect(nextColumn("done", 1)).toBe("done");
    expect(nextColumn("open", -1)).toBe("open");
  });
});
