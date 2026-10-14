// Finding a choice in a long list (time zones, countries, regions) by typing part of it. Pure, for the tests

/** Above so many choices, a list opens with a search field */
export const SEARCH_FROM = 15;

/** Lower case, without accents, "_" "/" and "-" read as spaces: "Europe/Paris", "paris" and "Pâris" meet */
export const foldText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[_/\-.,()]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Whether a choice answers what was typed: every word typed starts a word of its label, its group or its value */
export function choiceMatches(choice: { text: string; value: string; group?: string | null }, query: string): boolean {
  const words = foldText(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const hay = ` ${foldText(`${choice.text} ${choice.group ?? ""} ${choice.value}`)}`;
  return words.every((w) => hay.includes(` ${w}`));
}

/** The indexes of the choices to show for what was typed, the ones whose label starts with it first */
export function searchChoices(choices: readonly { text: string; value: string; group?: string | null }[], query: string): number[] {
  const q = foldText(query);
  const found = choices.map((_, i) => i).filter((i) => choiceMatches(choices[i]!, query));
  if (!q) return found;
  const starts = (i: number) => (foldText(choices[i]!.text).startsWith(q) ? 0 : 1);
  return found.sort((a, b) => starts(a) - starts(b) || a - b);
}

/** One character as the search reads it: lower case, no accent, a separator as a space */
const foldChar = (ch: string) => {
  const f = ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  return /^[_/\-.,()\s]+$/.test(f) ? " " : f;
};

/**
 * The parts of a label to highlight for what was typed: where each word typed starts a word of the label (or
 * appears anywhere in it, for the searches that match so), as [start, end) offsets in the label itself (accents
 * and "_" included), in order and without overlaps
 */
export function matchRanges(text: string, query: string, { anywhere = false } = {}): [number, number][] {
  const words = foldText(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  // The folded label, and for each of its characters the offset of the character it comes from
  let folded = "";
  const from: number[] = [];
  let offset = 0;
  for (const ch of text) {
    const f = foldChar(ch);
    for (const c of f) {
      folded += c;
      from.push(offset);
    }
    offset += ch.length;
  }
  from.push(offset);
  const ranges: [number, number][] = [];
  for (const w of words) {
    for (let i = folded.indexOf(w); i >= 0; i = folded.indexOf(w, i + 1)) {
      if (!anywhere && i > 0 && folded[i - 1] !== " ") continue;
      ranges.push([from[i]!, from[i + w.length]!]);
      break;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  // Overlapping words ("new" and "ne") make one highlight
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}
