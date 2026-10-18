// The column sets of a retrospective, without anything of the server: the settings show each one drawn as a
// small board, in the browser

export const RETRO_PRESETS = {
  "well-improve-ideas": ["well", "improve", "ideas"],
  "start-stop-continue": ["start", "stop", "continue"],
  "4l": ["liked", "learned", "lacked", "longed"],
  "mad-sad-glad": ["mad", "sad", "glad"],
} as const;
export type RetroPreset = keyof typeof RETRO_PRESETS;
