import { mergeSound, parseSound, SOUND_DEFAULTS } from "@ronde/core/sound";
import { describe, expect, it } from "vitest";
import { BIRTHDAY_MELODY } from "@/components/synth";

describe("meeting sounds", () => {
  it("fills missing or invalid settings with the defaults", () => {
    expect(parseSound({})).toEqual(SOUND_DEFAULTS);
    expect(parseSound(null)).toEqual(SOUND_DEFAULTS);
    // Played on everyone's "My screen" by default
    expect(parseSound({}).output).toBe("participants");
    expect(parseSound({ output: "screen" }).output).toBe("screen");
    expect(parseSound({ output: "elsewhere" }).output).toBe("participants");
    expect(parseSound({ volume: 250, musicStyle: "techno", cues: { end: false }, enabled: "yes" })).toEqual({
      ...SOUND_DEFAULTS,
      volume: 100,
      cues: { ...SOUND_DEFAULTS.cues, end: false },
    });
  });

  it("only changes the given fields", () => {
    const cur = parseSound({ volume: 30, cues: { speaker: false } });
    expect(mergeSound(cur, { cues: { end: false } })).toEqual({ ...cur, cues: { ...cur.cues, end: false } });
    expect(mergeSound(cur, { music: false }).cues.speaker).toBe(false);
    // Settings saved before a cue was added: it takes its default value
    expect(parseSound({ cues: { start: false } }).cues).toEqual({ ...SOUND_DEFAULTS.cues, start: false });
  });

  it("plays Happy Birthday in eight bars of three beats, after a one-beat pickup", () => {
    expect(BIRTHDAY_MELODY.reduce((t, [, d]) => t + d, 0)).toBe(1 + 8 * 3);
  });
});
