// Look of a meeting: its accent colour (buttons, timer, shared screen). Light and dark variants live in the styles.

export const ACCENTS = ["ember", "ocean", "forest", "plum", "slate"] as const;
export type Accent = (typeof ACCENTS)[number];
export const isAccent = (v: unknown): v is Accent => typeof v === "string" && (ACCENTS as readonly string[]).includes(v);

export interface Appearance {
  accent: Accent;
}

export const appearanceOf = (v: unknown): Appearance => {
  const accent = v && typeof v === "object" ? (v as { accent?: unknown }).accent : undefined;
  return { accent: isAccent(accent) ? accent : "ember" };
};

/** Colour themes of the interface; "system" follows the device */
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
export const isTheme = (v: unknown): v is Theme => typeof v === "string" && (THEMES as readonly string[]).includes(v);
