import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/shared/safe-next";

// After sign-in, only a path of the app is followed

describe("safeNext", () => {
  it("keeps the app's paths", () => {
    expect(safeNext("/w/demo?x=1#y")).toBe("/w/demo?x=1#y");
    expect(safeNext("/")).toBe("/");
  });

  it("refuses other sites, however they are written", () => {
    for (const next of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "\t//evil.example",
      "evil",
      "",
    ])
      expect(safeNext(next, "/home"), JSON.stringify(next)).toBe("/home");
    expect(safeNext(null)).toBe("/");
  });
});
