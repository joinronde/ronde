import { describe, expect, it } from "vitest";
import { MIN_WHEEL_LABEL_FONT_SIZE, wheelLabelLayout } from "../src/wheel-label-layout";

describe("adaptive wheel label layout", () => {
  it("keeps a tangential orientation for a few short labels", () => {
    const layout = wheelLabelLayout(["Yes", "No", "Maybe"], 3);

    expect(layout.orientation).toBe("tangential");
    expect(layout.labels.every((label) => !label.truncated)).toBe(true);
  });

  it("switches the whole wheel to radial when a single label constrains the space", () => {
    const layout = wheelLabelLayout(["Short", "A label much longer than all the other ones", "Medium"], 12);

    expect(layout.orientation).toBe("radial");
    expect(layout.fontSize).toBeGreaterThanOrEqual(MIN_WHEEL_LABEL_FONT_SIZE);
    expect(new Set(layout.labels.map(() => layout.orientation))).toEqual(new Set(["radial"]));
  });

  it("adapts wheels with many sectors without an unreadable size", () => {
    const labels = Array.from({ length: 30 }, (_, index) => `Choice ${index + 1}`);
    const layout = wheelLabelLayout(labels, labels.length);

    expect(layout.orientation).toBe("radial");
    expect(layout.fontSize).toBeGreaterThanOrEqual(MIN_WHEEL_LABEL_FONT_SIZE);
    expect(layout.fontSize).toBeLessThanOrEqual(16);
  });

  it("keeps a label whole when it fits in the sector", () => {
    // Measured in characters, these labels were all cut around twelve signs while the radius holds
    // about twenty at this size: a short label lost two letters to an ellipsis.
    const labels = ["Big win today!", "stuck there fairly fast", "Oh yes, absolutely", "I love the cake!"];
    const layout = wheelLabelLayout(labels, 6, 200);

    expect(layout.orientation).toBe("radial");
    expect(layout.labels.map((label) => label.display)).toEqual(labels);
    expect(layout.labels.every((label) => !label.truncated)).toBe(true);
  });

  it("cuts at the previous word rather than mid-word when space really runs out", () => {
    const layout = wheelLabelLayout(["I quite like it in the end, it works and even much more"], 14, 200);
    const [label] = layout.labels;

    expect(label.truncated).toBe(true);
    expect(label.display.endsWith("…")).toBe(true);
    // The cut falls on a word boundary, never in the middle of a word.
    expect(label.full.startsWith(label.display.slice(0, -1))).toBe(true);
    expect(label.display.slice(0, -1).trimEnd()).toBe(label.display.slice(0, -1));
  });

  it("never splits a Unicode grapheme as a last resort", () => {
    const label = "👨‍👩‍👧‍👦".repeat(40);
    const result = wheelLabelLayout([label, "Short"], 18).labels[0];

    expect(result.truncated).toBe(true);
    expect(result.display.endsWith("…")).toBe(true);
    const visibleGraphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(result.display.slice(0, -1))].map(
      ({ segment }) => segment,
    );
    expect(visibleGraphemes.every((grapheme) => grapheme === "👨‍👩‍👧‍👦")).toBe(true);
  });

  it("keeps the full label next to its heavily truncated version", () => {
    const label = "An extremely long wording ".repeat(20).trim();
    const result = wheelLabelLayout([label], 24).labels[0];

    expect(result.full).toBe(label);
    expect(result.display.length).toBeLessThan(label.length);
    expect(result.truncated).toBe(true);
  });
});
