import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LATEST_MIGRATION } from "../src/migrations";

// The app waits for its newest migration before it serves: the name it waits for is the newest one there is

describe("migrations", () => {
  it("name the newest one as the one the app waits for", () => {
    const dir = path.join(import.meta.dirname, "../prisma/migrations");
    const folders = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(LATEST_MIGRATION).toBe(folders.at(-1));
  });
});
