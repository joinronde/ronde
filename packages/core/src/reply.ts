// A check-in written in a reply to the reminder email: the lines of the reply, sorted into the meeting's
// sections. A line naming a section ("Done", "Blockers:", "## Next week", "**Other**") starts it; "Done: shipped
// the API" names it and gives an item at once; any other line is an item of the current section, its bullet
// or number removed. Lines before the first heading go to the first section.

import type { SectionType } from "./types";

export interface ReplySection {
  key: string;
  /** The label shown to the person (the email lists these) */
  label: string;
  input: SectionType;
}

/** Longest item kept, and the most items a section takes from one reply */
export const REPLY_ITEM_MAX = 2000;
export const REPLY_ITEMS_MAX = 50;

/** For comparing a line with a section name: no accents, case, punctuation or markup */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Bullets and numbering a mail client or a person puts before an item (checkboxes stay: they mean done or not) */
const BULLET = /^(?:[-*+•–—·▪◦>]|\d{1,2}[.)])\s+/;

/**
 * Whether a line names a section: its label or key, or a shortened label typed quickly ("Planned next week" for
 * "Planned for next week", "Done" for "Done this week"): every word of the line is in the label, and it starts
 * with the label's first word. A sentence with a label's word in it ("Write release notes") is not a heading.
 */
function names(line: string, label: string, key: string): boolean {
  const l = fold(line);
  if (!l) return false;
  const full = fold(label);
  if (l === full || l === fold(key)) return true;
  const words = l.split(" ");
  const labelWords = full.split(" ");
  return words[0] === labelWords[0] && words.every((w) => labelWords.includes(w));
}

export function parseReply(text: string, sections: ReplySection[]): Record<string, string[]> {
  const sectionOf = (line: string) => sections.find((s) => names(line, s.label, s.key))?.key;
  const out: Record<string, string[]> = {};
  let current = sections[0]?.key;
  const push = (key: string | undefined, item: string) => {
    const clean = item.replace(BULLET, "").trim();
    // The example of the reminder ("- …") left in the reply is not an item
    if (!key || /^[.…\s]*$/.test(clean) || (out[key]?.length ?? 0) >= REPLY_ITEMS_MAX) return;
    (out[key] ??= []).push(clean.slice(0, REPLY_ITEM_MAX));
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const heading = sectionOf(line);
    if (heading) {
      current = heading;
      continue;
    }
    // "Done: shipped the API": a section and its first item on one line
    const inline = /^(.{1,60}?)\s*[:：]\s*(.+)$/.exec(line.replace(BULLET, ""));
    const named = inline ? sectionOf(inline[1]!) : undefined;
    if (named) {
      current = named;
      push(named, inline![2]!);
      continue;
    }
    push(current, line);
  }
  // A free-text section keeps its lines as one paragraph
  for (const s of sections) if (s.input === "text" && out[s.key]) out[s.key] = [out[s.key]!.join("\n")];
  return out;
}
