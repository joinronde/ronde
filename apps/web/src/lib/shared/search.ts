// Searching as people type: case and accents do not count, so "zoe" finds "Zoé" and "ECOLE" finds "école".
// One helper for the palettes and the lists, so they all agree on what matches

/** A text without case or accents (Latin combining marks), for comparing what was typed with what is shown */
export const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** The words typed, folded; none for a blank query */
export const searchWords = (q: string) => fold(q).split(/\s+/).filter(Boolean);

/** Every word typed appears somewhere in the text, in any order (a blank query matches everything) */
export const matchesWords = (text: string, q: string) => {
  const hay = fold(text);
  return searchWords(q).every((w) => hay.includes(w));
};
