import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyHero, ILLUSTRATIONS, Illustration } from "@/components/illustration";

// Empty pages said only a sentence in a dashed box, each in its own way: they now show a drawing of one family,
// what is missing and what to do

const css = readFileSync(path.resolve(import.meta.dirname, "../src/app/globals.css"), "utf8");

describe("empty pages' drawings", () => {
  it("draws each one, hidden from screen readers, in the theme's colours only", () => {
    for (const name of ILLUSTRATIONS) {
      const svg = renderToStaticMarkup(createElement(Illustration, { name }));
      expect(svg, name).toContain('aria-hidden="true"');
      // More than the disc behind every drawing
      expect(svg.match(/<(rect|circle|path|ellipse)/g)!.length, name).toBeGreaterThan(2);
      // No colour written in the drawing: the stylesheet gives them, light or dark
      expect(svg, name).not.toMatch(/fill="#|stroke="#/);
    }
    for (const cls of [
      "ill-bg",
      "ill-paper",
      "ill-box",
      "ill-line",
      "ill-acc",
      "ill-on-acc",
      "ill-spark",
      "ill-hand",
      "ill-trend",
      "ill-glass",
      "ill-handle",
    ])
      expect(css, cls).toContain(`.${cls}{`);
  });

  it("says what is missing as a heading, and an error to screen readers as it shows", () => {
    expect(renderToStaticMarkup(createElement(EmptyHero, { art: "kudos", title: "No kudos yet" }))).toContain("<h2>No kudos yet</h2>");
    const err = renderToStaticMarkup(createElement(EmptyHero, { art: "error", title: "Could not load", compact: true, alert: true }));
    expect(err).toContain('role="alert"');
    expect(err).toContain("<h3>Could not load</h3>");
  });

  it("leaves no page with the former icon-in-a-disc empty state", () => {
    const root = path.resolve(import.meta.dirname, "../src");
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    expect(walk(root).filter((f) => f.endsWith(".tsx") && readFileSync(f, "utf8").includes("empty-hero-art"))).toEqual([]);
  });
});
