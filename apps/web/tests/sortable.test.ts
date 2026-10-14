import { describe, expect, it } from "vitest";
import { dropIndex, moved, rowShift } from "@/lib/shared/sortable";

// Lists reordered by dragging a grip (they used to have up and down arrows on every row)

describe("sortable lists", () => {
  it("moves an item up or down, within the bounds", () => {
    expect(moved(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moved(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(moved(["a", "b"], 1, 9)).toEqual(["a", "b"]);
    expect(moved(["a", "b"], 5, 0)).toEqual(["a", "b"]);
  });

  it("lands in the place of the row whose middle it reaches", () => {
    // Rows 40px high: middles at 20, 60, 100, 140
    const mids = [20, 60, 100, 140];
    expect(dropIndex(mids, 0, 55)).toBe(0);
    expect(dropIndex(mids, 0, 65)).toBe(1);
    expect(dropIndex(mids, 0, 500)).toBe(3);
    expect(dropIndex(mids, 3, 95)).toBe(2);
    expect(dropIndex(mids, 3, -50)).toBe(0);
    // Dropped on the middle of a row: in its place
    expect(dropIndex(mids, 0, 100)).toBe(2);
    expect(dropIndex(mids, 3, 60)).toBe(1);
  });

  it("makes the rows in between give way", () => {
    // Dragged down from 0 to 2: rows 1 and 2 go up
    expect([0, 1, 2, 3].map((i) => rowShift(i, 0, 2))).toEqual([0, -1, -1, 0]);
    // Dragged up from 3 to 1: rows 1 and 2 go down
    expect([0, 1, 2, 3].map((i) => rowShift(i, 3, 1))).toEqual([0, 1, 1, 0]);
    expect([0, 1, 2].map((i) => rowShift(i, 1, 1))).toEqual([0, 0, 0]);
  });
});
