import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Opening a meeting from the sidebar went through its own address, which sat outside the shell: the whole frame,
// sidebar included, went down and came back up on the way to the meeting's home page

const ws = path.resolve(import.meta.dirname, "../src/app/w/[ws]");

describe("the shell around the pages", () => {
  it("keeps a meeting's own address (where its links lead) inside the shell", () => {
    expect(existsSync(path.join(ws, "(shell)/m/[meeting]/page.tsx"))).toBe(true);
    expect(existsSync(path.join(ws, "m/[meeting]/page.tsx"))).toBe(false);
  });
});
