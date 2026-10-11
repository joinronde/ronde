import { describe, expect, it } from "vitest";
import { matches, render } from "../src/workflows";

describe("workflows", () => {
  it("lets a message through only when every condition holds", () => {
    const facts = { openActions: 3, readyPercent: 40 };
    expect(matches([], facts)).toBe(true);
    expect(matches([{ field: "openActions", op: ">", value: 0 }], facts)).toBe(true);
    expect(
      matches(
        [
          { field: "openActions", op: ">", value: 0 },
          { field: "readyPercent", op: ">=", value: 50 },
        ],
        facts,
      ),
    ).toBe(false);
    // An unknown figure or comparison never sends by mistake
    expect(matches([{ field: "nothing", op: ">", value: 0 }], facts)).toBe(false);
    expect(matches([{ field: "openActions", op: "~", value: 0 }], facts)).toBe(false);
  });

  it("fills the variables it knows, and leaves the others as typed", () => {
    expect(render("{meeting}: {missing} missing, see {link} {unknown}", { meeting: "Weekly", missing: "2", link: "https://x" })).toBe(
      "Weekly: 2 missing, see https://x {unknown}",
    );
  });
});
