import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_SKELETONS, SKELETON_KINDS } from "@/lib/shared/skeleton";

// Every page loaded in the shape of a generic grid of cards, whatever it was: each page now has a skeleton of its
// own shape (rows, a table, a month, the control room...)

const shell = path.resolve(import.meta.dirname, "../src/app/w/[ws]/(shell)");
const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const files = walk(shell);
/** A page's route as PAGE_SKELETONS names it: "projects/[slug]", "m/history" */
const routeOf = (dir: string) => {
  const rel = path.relative(shell, dir).split(path.sep);
  const meeting = rel[0] === "m";
  const parts = rel.filter((p) => !/^\(.*\)$/.test(p) && p !== "m" && p !== "[meeting]");
  return (meeting ? "m/" : "") + parts.join("/");
};

describe("page skeletons", () => {
  it("gives each page of the workspace and of a meeting a loading screen of its own shape", () => {
    const loadings = new Map(
      files.filter((f) => f.endsWith("loading.tsx")).map((f) => [path.dirname(f), readFileSync(f, "utf8")] as const),
    );
    for (const route of Object.keys(PAGE_SKELETONS)) {
      const dir = [...loadings.keys()].find((d) => routeOf(d) === route && files.includes(path.join(d, "page.tsx")));
      expect(dir, route).toBeDefined();
      expect(loadings.get(dir!)).toContain(`PAGE_SKELETONS["${route}"]`);
    }
    expect(Object.values(PAGE_SKELETONS).every((k) => (SKELETON_KINDS as readonly string[]).includes(k))).toBe(true);
  });

  it("leaves no top-level page of the workspace or of a meeting without its shape", () => {
    const pages = files
      .filter((f) => f.endsWith("page.tsx"))
      .map((f) => routeOf(path.dirname(f)))
      // The settings' sub-pages take the settings' shape; their own come with their layout
      .filter((r) => !r.startsWith("settings/"))
      // A meeting's own address only sends on to its home page
      .filter((r) => r !== "m/");
    expect(pages.filter((r) => !(r in PAGE_SKELETONS))).toEqual([]);
  });
});
