// What the drawn time and duration fields read from what people type. Pure, so the server-free tests check them.

const pad = (n: number) => String(n).padStart(2, "0");

/** "9h30", "09:30", "930", "9", "9.30", "9:30 pm", "21 h" → "HH:MM", or null */
export function parseTime(raw: string): string | null {
  const text = raw.trim().toLowerCase().replace(/\s+/g, "");
  const m = /^(\d{1,2})(?:[:h.,]?(\d{2}))?(?:h)?(am|pm|a|p)?$/.exec(text);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const half = m[3];
  if (half) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (half.startsWith("p") ? 12 : 0);
  }
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

/**
 * A typed duration, in the field's unit, or null: two numbers are hours and minutes (minutes and seconds for a
 * speaking time); one number takes its unit from the letters after it, else the field's usual one
 */
export function parseDuration(text: string, unit: "seconds" | "minutes", max: number): number | null {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/(\d),(\d)/g, "$1.$2");
  const nums = s.match(/\d+(?:\.\d+)?/g)?.map(Number);
  if (!nums?.length) return null;
  const hours = /\d\s*(h|hr|hour|heure|std|ч|小时|時|घं|س)/.test(s);
  const seconds = /\d\s*(s\b|sec|сек|秒|से)/.test(s);
  const minutes = /\d\s*(m|мин|分|मि|د)/.test(s);
  const [a, b] = nums as [number, number | undefined];
  if (unit === "minutes") {
    if (b !== undefined) return Math.round(a * 60 + b);
    return Math.round(hours && !minutes ? a * 60 : a);
  }
  if (b !== undefined) return Math.round(a * 60 + b);
  if (seconds && !minutes) return Math.round(a);
  if (minutes) return Math.round(a * 60);
  // "2" is two minutes of speaking, "90" ninety seconds
  return Math.round(a * 60 <= max ? a * 60 : a);
}

/** − and + land on the step's multiples: 27 min goes to 25 or 30 */
export const nudged = (value: number, step: number, dir: 1 | -1) =>
  dir > 0 ? Math.floor(value / step) * step + step : Math.ceil(value / step) * step - step;

/**
 * Reactions sent in a row: the times still in the window, and when the next one is allowed (0: now). Past the
 * burst, a reaction is not sent and the countdown runs until the oldest leaves the window
 */
export function reactionAllowance(sent: readonly number[], now: number, burst: number, windowMs: number) {
  const recent = sent.filter((x) => now - x < windowMs);
  const waitUntil = recent.length >= burst ? recent[0]! + windowMs : 0;
  return { recent, waitUntil };
}
