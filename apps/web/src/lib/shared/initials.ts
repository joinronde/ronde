import { firstGrapheme } from "@ronde/core/util";

// Initials shown where there is no picture. Two ways, each with its reason: a person's or a project's face keeps the
// first and the last word ("Ana María López" gives "AL"), a meeting's mark keeps every word and is cut to the room
// it has. A third, for the live views, lives in @ronde/core/util (first two words, split at apostrophes and dashes)

/** The first letter of a word, whole even when it takes several code points (a rare Chinese character, a flag) */
const firstOf = (w: string | undefined) => (w ? firstGrapheme(w) : "");

/** A person's or a project's initials: first and last word, "?" when nothing is left */
export function initials(name: string): string {
  // Words starting with a letter or a digit: "Product team (demo)" gives "PT", not "P("
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((w) => /^[\p{L}\p{N}]/u.test(w));
  return (firstOf(parts[0]) + (parts.length > 1 ? firstOf(parts[parts.length - 1]) : "")).toUpperCase() || "?";
}

/** A meeting's initials: the first character of every word, emoji kept whole, `letters` of them at most */
export const meetingInitials = (name: string, letters = Number.POSITIVE_INFINITY) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, letters)
    .map((w) => firstGrapheme(w).toUpperCase())
    .join("");
