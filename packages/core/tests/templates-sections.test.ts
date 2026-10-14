import { describe, expect, it } from "vitest";
import { sectionsProblem } from "../src/templates";

// One rule for a meeting's sections, wherever they are set: the wizard created what the settings then refused

describe("a meeting's sections", () => {
  it("hold each role once, and name the sections of their own", () => {
    expect(
      sectionsProblem([
        { role: "achievement", label: "" },
        { role: "plan", label: "" },
      ]),
    ).toBeNull();
    expect(
      sectionsProblem([
        { role: "achievement", label: "" },
        { role: "achievement", label: "Done" },
      ]),
    ).toBe("sectionRoleTaken");
    expect(sectionsProblem([{ role: "custom", label: "  " }])).toBe("sectionLabelRequired");
    expect(
      sectionsProblem([
        { role: "custom", label: "Demo" },
        { role: "custom", label: "Risks" },
      ]),
    ).toBeNull();
  });
});
