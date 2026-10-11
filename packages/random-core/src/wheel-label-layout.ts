export type WheelLabelOrientation = "tangential" | "radial";

export interface WheelLabelRender {
  display: string;
  full: string;
  truncated: boolean;
}

export interface WheelLabelLayout {
  fontSize: number;
  labels: WheelLabelRender[];
  orientation: WheelLabelOrientation;
}

export const MIN_WHEEL_LABEL_FONT_SIZE = 12;
const MIN_TANGENTIAL_FONT_SIZE = 14;
const MAX_TANGENTIAL_FONT_SIZE = 24;
const MAX_RADIAL_FONT_SIZE = 16;
const ELLIPSIS = "…";

function graphemes(value: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)].map(({ segment }) => segment);
  }
  return Array.from(value);
}

/** Deterministic approximation, independent of the browser and the loaded font. */
function graphemeWidth(grapheme: string): number {
  if (/^\s$/u.test(grapheme)) return 0.35;
  if (/^[ilI1.,'’!:;|]$/u.test(grapheme)) return 0.32;
  if (/^[mwMW@#%&]$/u.test(grapheme)) return 0.92;
  if (/\p{Extended_Pictographic}|\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(grapheme)) return 1;
  return 0.62;
}

function textUnits(value: string): number {
  return graphemes(value).reduce((total, grapheme) => total + graphemeWidth(grapheme), 0);
}

/**
 * Truncates by width, never by number of characters.
 *
 * Counting graphemes treated every letter as a full em wide, whereas `graphemeWidth` measures it at
 * 0.62: the cut came nearly forty percent too early, and a label that fitted in its sector lost two
 * letters to an ellipsis. The cut stays at a word as long as a whole word fits, and only goes through
 * the graphemes otherwise, without ever splitting one.
 */
function truncateToUnits(value: string, maximumUnits: number): WheelLabelRender {
  if (textUnits(value) <= maximumUnits) return { display: value, full: value, truncated: false };

  const available = Math.max(0, maximumUnits - graphemeWidth(ELLIPSIS));
  const words = value.trim().split(/\s+/u);
  let wordResult = "";
  for (const word of words) {
    const candidate = wordResult ? `${wordResult} ${word}` : word;
    if (textUnits(candidate) > available) break;
    wordResult = candidate;
  }

  let display = wordResult;
  if (!display) {
    let used = 0;
    const kept: string[] = [];
    for (const grapheme of graphemes(value)) {
      const width = graphemeWidth(grapheme);
      if (used + width > available) break;
      kept.push(grapheme);
      used += width;
    }
    display = kept.join("").trimEnd();
  }

  return { display: `${display}${ELLIPSIS}`, full: value, truncated: true };
}

/**
 * Picks a single orientation and a single size for the whole wheel.
 *
 * The chord available in the sector first decides whether labels can stay tangential. If the most
 * constrained one does not fit at a readable size, they all go radial. Truncation only happens after
 * shrinking to the shared minimum size.
 */
export function wheelLabelLayout(labels: string[], sectorCount: number, radius = 200): WheelLabelLayout {
  if (labels.length === 0 || sectorCount <= 0) {
    return { fontSize: MAX_TANGENTIAL_FONT_SIZE, labels: [], orientation: "tangential" };
  }

  // A single measure for both orientations: the text width relative to the font size. Radial used to
  // count characters, a unit nothing converted into the available space.
  const maximumUnits = Math.max(...labels.map(textUnits), 1);
  const labelRadius = radius - 50;
  const tangentialSpace = sectorCount === 1 ? labelRadius * 2 - 20 : Math.max(24, 2 * labelRadius * Math.sin(Math.PI / sectorCount) - 16);
  const tangentialFont = Math.min(MAX_TANGENTIAL_FONT_SIZE, Math.floor(tangentialSpace / maximumUnits));
  if (tangentialFont >= MIN_TANGENTIAL_FONT_SIZE) {
    return {
      fontSize: tangentialFont,
      labels: labels.map((label) => ({ display: label, full: label, truncated: false })),
      orientation: "tangential",
    };
  }

  const radialSpace = radius - 45;
  const radialFont = Math.min(MAX_RADIAL_FONT_SIZE, Math.floor(radialSpace / maximumUnits));
  const fontSize = Math.max(MIN_WHEEL_LABEL_FONT_SIZE, radialFont);
  const availableUnits = radialSpace / fontSize;
  return {
    fontSize,
    labels: labels.map((label) => truncateToUnits(label, availableUnits)),
    orientation: "radial",
  };
}
