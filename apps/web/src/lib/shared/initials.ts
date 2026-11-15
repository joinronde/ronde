import { firstGrapheme, initials } from "@ronde/core/util";

// Initials shown where there is no picture. A person's or a project's face takes one function everywhere,
// @ronde/core/util's, so a person keeps the same letters from the sidebar to the control room; a meeting's mark
// keeps every word and is cut to the room it has

export { initials };

/** A meeting's initials: the first character of every word, emoji kept whole, `letters` of them at most */
export const meetingInitials = (name: string, letters = Number.POSITIVE_INFINITY) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, letters)
    .map((w) => firstGrapheme(w).toUpperCase())
    .join("");
