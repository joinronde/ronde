import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The design tokens: text colours must stay readable (WCAG AA, 4.5:1) on every background they sit on
const css = readFileSync(path.resolve(import.meta.dirname, "../../../packages/ui/src/styles/tokens.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** `color-mix(in srgb, a k, b)`: each channel weighted, as hex */
function mix(a: string, b: string, k: number): string {
  const ch = (h: string, i: number) => Number.parseInt(h.slice(i, i + 2), 16);
  return `#${[1, 3, 5].map((i) => Math.round(ch(a, i) * k + ch(b, i) * (1 - k)).toString(16).padStart(2, "0")).join("")}`;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const themes = { light: block("body.th-light"), dark: block(':root[data-theme="dark"]') };
const inks = ["ink", "ink-2", "ink-3", "accent", "sun", "live", "warn", "ok"];
const grounds = ["bg", "surface", "surface-2"];

describe("palette contrast", () => {
  for (const [theme, t] of Object.entries(themes)) {
    for (const ink of inks) {
      for (const ground of grounds) {
        it(`${theme}: ${ink} on ${ground} reaches 4.5:1`, () => {
          expect(t[ink], ink).toBeDefined();
          expect(contrast(t[ink] as string, t[ground] as string)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    it(`${theme}: accent-ink on accent reaches 4.5:1`, () => {
      expect(contrast(t["accent-ink"] as string, t.accent as string)).toBeGreaterThanOrEqual(4.5);
    });
    // Grounds the CSS mixes from a colour (color-mix in srgb): the initials of an avatar on its tinted disc
    // (.av), and a count on a pressed chip, lightened by its own text (.nm-cat-n)
    for (const c of ["c0", "c1", "c2", "c3", "c4", "c5"])
      it(`${theme}: an avatar's initials in ${c} reach 4.5:1 on their disc`, () => {
        expect(contrast(t[c] as string, mix(t[c] as string, t.surface as string, 0.15))).toBeGreaterThanOrEqual(4.5);
      });
    it(`${theme}: a count on a pressed chip reaches 4.5:1`, () => {
      const ink = t["accent-ink"] as string;
      expect(contrast(ink, mix(ink, t.accent as string, 0.14))).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("the system dark palette matches the forced one", () => {
    const media = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf(':root[data-theme="dark"]'));
    const system = Object.fromEntries([...media.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
    expect(system).toEqual(themes.dark);
  });
});
