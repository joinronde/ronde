// Meeting sounds: settings driven from the control room, played on "My screen" or on the shared screen.
// Labels (music titles, groups, cues, board sounds) live in the "sounds" messages.

/**
 * Waiting music: recorded tracks (public domain or CC0, sources in the README, files in public/music)
 * or music generated in the browser.
 */
export const MUSIC_GROUPS = ["classical", "jazz", "electro", "rock", "generated"] as const;
export type MusicGroup = (typeof MUSIC_GROUPS)[number];

export const MUSIC_STYLES = [
  { key: "satie", group: "classical", file: "/music/satie-gymnopedie-1.mp3" },
  { key: "satie-guitar", group: "classical", file: "/music/satie-gymnopedie-1-guitar.mp3" },
  { key: "debussy", group: "classical", file: "/music/debussy-clair-de-lune.mp3" },
  { key: "uno-mas", group: "jazz", file: "/music/airmen-of-note-uno-mas.mp3" },
  { key: "traveling", group: "electro", file: "/music/loyalty-freak-music-traveling-in-your-mind.mp3" },
  { key: "ghost-surf", group: "rock", file: "/music/loyalty-freak-music-ghost-surf-rock.mp3" },
  { key: "secret-agent", group: "rock", file: "/music/john-bartmann-secret-agent-rock.mp3" },
  { key: "soft-pads", group: "generated" },
  { key: "bossa-lounge", group: "generated" },
] as const satisfies readonly { key: string; group: MusicGroup; file?: string }[];

export type MusicStyle = (typeof MUSIC_STYLES)[number]["key"];
export const MUSIC_STYLE_KEYS = MUSIC_STYLES.map((m) => m.key) as [MusicStyle, ...MusicStyle[]];

/** File of a recorded track, undefined for generated music */
export const musicFile = (style: MusicStyle): string | undefined => {
  const m = MUSIC_STYLES.find((x) => x.key === style);
  return m && "file" in m ? m.file : undefined;
};

/**
 * Where sounds play: on everyone's "My screen" (each person mutes them or sets their volume),
 * or on the shared screen (meeting in a room, or audio shared in the video call).
 */
export type SoundOutput = "participants" | "screen";

export interface SoundSettings {
  /** Sounds turned on */
  enabled: boolean;
  output: SoundOutput;
  /** 0 to 100 */
  volume: number;
  /** Music on the waiting screen, stopped when the meeting starts */
  music: boolean;
  musicStyle: MusicStyle;
  /** Cues played automatically during the meeting; `birthday`: Happy Birthday right after the chime, in a birthday week */
  cues: { start: boolean; birthday: boolean; speaker: boolean; timeUp: boolean; end: boolean };
}

export const SOUND_DEFAULTS: SoundSettings = {
  enabled: true,
  output: "participants",
  volume: 60,
  music: true,
  musicStyle: "satie",
  cues: { start: true, birthday: true, speaker: true, timeUp: true, end: true },
};

/** Meeting cues */
export const CUES: (keyof SoundSettings["cues"])[] = ["start", "birthday", "speaker", "timeUp", "end"];

/** Soundboard sounds, triggered on demand from the control room */
export const BOARD_SOUNDS = [
  { key: "applause", emoji: "👏" },
  { key: "drumroll", emoji: "🥁" },
  { key: "tada", emoji: "🎉" },
  { key: "rimshot", emoji: "🥁" },
  { key: "birthday", emoji: "🎂" },
] as const;

export type BoardSound = (typeof BOARD_SOUNDS)[number]["key"];
export const BOARD_SOUND_KEYS = BOARD_SOUNDS.map((b) => b.key) as [BoardSound, ...BoardSound[]];

/** Everything the shared screen can play */
export type SoundKey = BoardSound | "start" | "speaker" | "timeUp";

/** Settings read from the database (JSON), completed with the defaults */
export function parseSound(raw: unknown): SoundSettings {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
  const c = o.cues && typeof o.cues === "object" ? (o.cues as Record<string, unknown>) : {};
  const d = SOUND_DEFAULTS;
  return {
    enabled: bool(o.enabled, d.enabled),
    output: o.output === "screen" || o.output === "participants" ? o.output : d.output,
    volume: typeof o.volume === "number" && Number.isFinite(o.volume) ? Math.min(100, Math.max(0, Math.round(o.volume))) : d.volume,
    music: bool(o.music, d.music),
    musicStyle: MUSIC_STYLES.some((m) => m.key === o.musicStyle) ? (o.musicStyle as MusicStyle) : d.musicStyle,
    cues: {
      start: bool(c.start, d.cues.start),
      birthday: bool(c.birthday, d.cues.birthday),
      speaker: bool(c.speaker, d.cues.speaker),
      timeUp: bool(c.timeUp, d.cues.timeUp),
      end: bool(c.end, d.cues.end),
    },
  };
}

/** Changed settings: only the given fields change */
export function mergeSound(
  cur: SoundSettings,
  patch: Partial<Omit<SoundSettings, "cues">> & { cues?: Partial<SoundSettings["cues"]> },
): SoundSettings {
  return parseSound({ ...cur, ...patch, cues: { ...cur.cues, ...patch.cues } });
}
