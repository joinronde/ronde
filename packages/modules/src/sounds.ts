import { BOARD_SOUND_KEYS, MUSIC_STYLE_KEYS, mergeSound, parseSound, type SoundSettings } from "@ronde/core/sound";
import { defineModule, defineOp } from "@ronde/module-sdk";
import { z } from "zod";

// Waiting music, cues and the soundboard, played on "My screen" or on the shared screen
const schema = z.custom<SoundSettings>((v) => !!v && typeof v === "object");

export const sounds = defineModule({
  id: "sounds",
  category: "facilitation",
  feature: "modules.facilitation",
  defaultEnabled: false,
  icon: "🔊",
  config: { schema, defaults: parseSound({}) },
  ops: [
    defineOp({
      name: "sounds.settings",
      permission: "session.run",
      input: z.object({
        enabled: z.boolean().optional(),
        output: z.enum(["participants", "screen"]).optional(),
        volume: z.number().int().min(0).max(100).optional(),
        music: z.boolean().optional(),
        musicStyle: z.enum(MUSIC_STYLE_KEYS).optional(),
        cues: z
          .object({ start: z.boolean(), birthday: z.boolean(), speaker: z.boolean(), timeUp: z.boolean(), end: z.boolean() })
          .partial()
          .optional(),
      }),
      run: async ({ module }, patch) => {
        await module?.setConfig(mergeSound(parseSound(module.config), patch));
      },
    }),
    defineOp({
      name: "sounds.play",
      permission: "session.run",
      input: z.object({ sound: z.enum(BOARD_SOUND_KEYS) }),
      // Nothing to store: the shared screen plays the sound on reception
      run: async ({ emit, quiet }, o) => {
        quiet();
        emit({ kind: "sound", sound: o.sound });
      },
    }),
  ],
});
