// Meeting sounds, played with Web Audio: recorded sounds (free licences) and synthesised sounds.
// The browser only allows sound after a gesture on the page: `unlock` is called on the first click.

import { type MusicStyle, musicFile, type SoundKey } from "@ronde/core/sound";
import { withBasePath } from "@/lib/shared/base-path";

/**
 * Recorded sounds (CC0 or public domain, sources in the README), served by Ronde itself.
 * As long as a file is not loaded, or cannot be, the synthesised version replaces it.
 */
const SAMPLES: Partial<Record<SoundKey, string>> = {
  applause: "/sounds/applause.mp3",
  drumroll: "/sounds/drumroll.mp3",
  rimshot: "/sounds/ba-dum-tss.mp3",
  tada: "/sounds/tada.mp3",
};

/**
 * Gain of each sound, so they all come out at the same perceived volume: K-weighted loudness (ITU-R BS.1770)
 * of the active part, measured in the browser on the shared-screen output, brought to -16 dB.
 * Redo it when a sound changes.
 */
const LEVELS: Record<SoundKey | MusicStyle, number> = {
  start: 0.85,
  speaker: 1.7,
  timeUp: 1.01,
  applause: 1.24,
  drumroll: 1.04,
  rimshot: 0.76,
  tada: 0.92,
  birthday: 0.98,
  "soft-pads": 1.7,
  "bossa-lounge": 1.19,
  // Recorded tracks: already brought to -16 LUFS in the file
  satie: 1,
  "satie-guitar": 1,
  debussy: 1,
  "uno-mas": 1,
  traveling: 1,
  "ghost-surf": 1,
  "secret-agent": 1,
};

/** Frequency of a MIDI note (69 = A 440) */
const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

interface NoteOpts {
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  release?: number;
  /** Frequency glide until the end of the note (toms) */
  to?: number;
  detune?: number;
  dest?: AudioNode;
}

interface HitOpts {
  filter?: BiquadFilterType;
  freq?: number;
  q?: number;
  gain?: number;
  dest?: AudioNode;
}

/** Grille d'accords de la musique d'attente : basse, puis notes de l'accord (MIDI) */
const CHORDS: [number, number[]][] = [
  [48, [60, 64, 67, 71]], // C maj7
  [45, [57, 60, 64, 67]], // A m7
  [50, [57, 60, 62, 65]], // D m7
  [43, [55, 59, 62, 65]], // G 7
];

/**
 * Lounge music (bossa nova): ii-V-I-VI in C, one bar per chord.
 * Bass, electric piano voicing and notes allowed for the melody (MIDI).
 */
const LOUNGE: { bass: number; chord: number[]; scale: number[] }[] = [
  { bass: 38, chord: [53, 57, 60, 64], scale: [62, 64, 65, 67, 69, 72, 74, 76] }, // D m9
  { bass: 43, chord: [53, 57, 59, 64], scale: [62, 64, 65, 67, 69, 71, 74, 76] }, // G 13
  { bass: 36, chord: [52, 55, 59, 62], scale: [64, 67, 69, 71, 72, 74, 76, 79] }, // C maj9
  { bass: 45, chord: [55, 58, 61, 66], scale: [61, 64, 66, 67, 69, 70, 73, 76] }, // A 13(♭9)
];
/** Positions (in beats) of the piano chords, alternating from one bar to the next: the bossa swing */
const LOUNGE_COMP = [
  [0, 1.5, 3],
  [0.5, 2, 3.5],
];
/** Melody rhythms over two bars: [start, duration] in beats; every other phrase breathes more */
const LOUNGE_PHRASES: [number, number][][] = [
  [
    [0, 1],
    [1.5, 0.5],
    [2, 1.5],
    [4.5, 0.5],
    [5, 2.5],
  ],
  [
    [0.5, 0.5],
    [1, 1],
    [2.5, 1.5],
    [6, 1.5],
  ],
  [
    [0, 0.5],
    [0.5, 0.5],
    [1, 0.5],
    [1.5, 2],
    [4, 1],
    [5, 3],
  ],
  [
    [1, 1.5],
    [3, 1],
    [5.5, 2],
  ],
];

/** Happy Birthday (public-domain melody): [MIDI note, duration in beats], in 3/4 */
export const BIRTHDAY_MELODY: [number, number][] = [
  [67, 0.75],
  [67, 0.25],
  [69, 1],
  [67, 1],
  [72, 1],
  [71, 2],
  [67, 0.75],
  [67, 0.25],
  [69, 1],
  [67, 1],
  [74, 1],
  [72, 2],
  [67, 0.75],
  [67, 0.25],
  [79, 1],
  [76, 1],
  [72, 1],
  [71, 1],
  [69, 1],
  [77, 0.75],
  [77, 0.25],
  [76, 1],
  [72, 1],
  [74, 1],
  [72, 3],
];
/** Waltz accompaniment, one bar after the pickup: bass on the first beat, chord on the next two */
const BIRTHDAY_BARS: { bass: number; chord: number[]; third?: number[] }[] = [
  { bass: 48, chord: [55, 60, 64] }, // C
  { bass: 43, chord: [53, 59, 62] }, // G 7
  { bass: 43, chord: [53, 59, 62] },
  { bass: 48, chord: [55, 60, 64] },
  { bass: 48, chord: [55, 58, 64] }, // C 7
  { bass: 41, chord: [53, 57, 60] }, // F
  { bass: 48, chord: [55, 60, 64], third: [53, 59, 62] }, // C, then G 7 on the last beat
  { bass: 48, chord: [55, 60, 64] },
];

class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private music: { gain: GainNode; timer: ReturnType<typeof setInterval> | null; style: MusicStyle; el?: HTMLAudioElement } | null = null;
  private volume = 0.6;
  /** Sortie du son en cours de programmation (voir `play`) */
  private out: AudioNode | null = null;
  private samples = new Map<SoundKey, AudioBuffer>();
  private loading: Promise<void> | null = null;

  /** Sound allowed by the browser */
  get ready() {
    return this.ctx?.state === "running";
  }

  private init() {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = this.volume;
    // Output compressor: several overlapping sounds do not clip
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    // Light reverb (synthetic response: stereo noise fading out in 2 s), to give some space
    const ir = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length) ** 3;
    }
    const verb = ctx.createConvolver();
    verb.buffer = ir;
    const send = ctx.createGain();
    send.gain.value = 0.22;
    master.connect(send);
    send.connect(verb);
    verb.connect(comp);
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.ctx = ctx;
    this.master = master;
    this.noiseBuf = buf;
    return ctx;
  }

  /** To call on a user gesture (click, key); returns true when sound is allowed */
  async unlock(): Promise<boolean> {
    try {
      await this.init().resume();
    } catch {
      /* son indisponible */
    }
    if (this.ready) void this.loadSamples();
    return this.ready;
  }

  /** Load the recorded sounds, once sound is allowed (≈ 150 KB in all) */
  private loadSamples() {
    const ctx = this.ctx!;
    this.loading ??= Promise.all(
      Object.entries(SAMPLES).map(async ([key, path]) => {
        try {
          const res = await fetch(withBasePath(path));
          if (!res.ok) return;
          this.samples.set(key as SoundKey, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch {
          /* file unavailable: the synthesised version takes over */
        }
      }),
    ).then(() => undefined);
    return this.loading;
  }

  /** Play a recorded sound; false when it is not loaded (yet) */
  private sample(key: SoundKey, t: number, dest: AudioNode): boolean {
    const buf = this.samples.get(key);
    if (!buf) return false;
    const src = this.ctx!.createBufferSource();
    src.buffer = buf;
    src.connect(dest);
    src.start(t);
    return true;
  }

  /** Input of a sound, at its level (LEVELS) */
  private leveled(key: SoundKey | MusicStyle) {
    const g = this.ctx!.createGain();
    g.gain.value = LEVELS[key];
    g.connect(this.master!);
    return g;
  }

  /** 0 to 1; squared curve, closer to how the ear hears */
  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v)) ** 2;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  private note(freq: number, t: number, dur: number, o: NoteOpts = {}) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const attack = o.attack ?? 0.01;
    const release = o.release ?? Math.min(0.3, dur / 2);
    osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    if (o.detune) osc.detune.value = o.detune;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.gain ?? 0.2, t + attack);
    g.gain.setValueAtTime(o.gain ?? 0.2, t + Math.max(attack, dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(o.dest ?? this.out ?? this.master!);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /**
   * Electric piano (FM synthesis): the brightness of the attack fades quickly, then the sound holds,
   * like the tine of a Rhodes. `dur`: written duration of the note.
   */
  private epiano(freq: number, t: number, dur: number, gain: number, dest: AudioNode = this.out ?? this.master!) {
    const ctx = this.ctx!;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const amp = ctx.createGain();
    const len = Math.min(3, dur + 0.6);
    car.frequency.value = freq;
    mod.frequency.value = freq;
    modGain.gain.setValueAtTime(freq * 2.2, t);
    modGain.gain.exponentialRampToValueAtTime(freq * 0.25, t + 0.35);
    mod.connect(modGain);
    modGain.connect(car.frequency);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    amp.gain.exponentialRampToValueAtTime(gain * 0.45, t + 0.4);
    amp.gain.setTargetAtTime(0.0001, t + dur, 0.18);
    car.connect(amp);
    amp.connect(dest);
    // Tine ping, an octave and a fifth above, very short
    this.note(freq * 3, t, 0.25, { gain: gain * 0.12, attack: 0.002, release: 0.22, dest });
    for (const o of [car, mod]) {
      o.start(t);
      o.stop(t + len + 0.6);
    }
  }

  /** Filtered noise with a fast decay: hand clap, snare, cymbal */
  private hit(t: number, dur: number, o: HitOpts = {}) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = o.filter ?? "bandpass";
    f.frequency.value = o.freq ?? 2000;
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.gain ?? 0.3, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(o.dest ?? this.out ?? this.master!);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  play(key: SoundKey) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime + 0.03;
    const out = this.leveled(key);
    if (this.sample(key, t, out)) return;
    // Everything this sound schedules goes through its level
    this.out = out;
    try {
      this.synth(key, t);
    } finally {
      this.out = null;
    }
  }

  private synth(key: SoundKey, t: number) {
    switch (key) {
      case "start":
        [72, 76, 79, 84].forEach((m, i) => {
          this.note(mtof(m), t + i * 0.13, 1.4, { gain: 0.16, release: 1 });
          this.note(mtof(m + 12), t + i * 0.13, 0.8, { type: "triangle", gain: 0.04, release: 0.6 });
        });
        break;
      case "speaker":
        this.note(mtof(79), t, 0.5, { type: "triangle", gain: 0.13, release: 0.4 });
        this.note(mtof(84), t + 0.14, 0.7, { type: "triangle", gain: 0.13, release: 0.55 });
        break;
      case "timeUp":
        for (let i = 0; i < 3; i++) this.note(880, t + i * 0.3, 0.18, { gain: 0.18, release: 0.05 });
        break;
      // Synthesised fallbacks of the recorded sounds
      case "applause":
        // Dozens of random claps, denser at the start
        for (let i = 0; i < 110; i++) {
          const at = t + 2.8 * Math.random() ** 1.6;
          const fade = 1 - (at - t) / 3;
          this.hit(at, 0.03 + Math.random() * 0.04, {
            freq: 1200 + Math.random() * 1800,
            q: 0.8,
            gain: (0.3 + Math.random() * 0.4) * fade,
          });
        }
        break;
      case "drumroll": {
        let at = t;
        let gap = 0.065;
        while (at < t + 2) {
          this.hit(at, 0.06, { freq: 1800, q: 0.6, gain: 0.2 + ((at - t) / 2) * 0.45 });
          at += gap;
          gap = Math.max(0.035, gap * 0.985);
        }
        this.hit(t + 2.05, 1.8, { filter: "highpass", freq: 5000, gain: 0.35 });
        this.note(110, t + 2.05, 0.4, { to: 55, gain: 0.35 });
        break;
      }
      case "tada":
        [67, 71, 74].forEach((m) => this.note(mtof(m), t, 0.14, { type: "sawtooth", gain: 0.05, release: 0.05 }));
        [72, 76, 79, 84].forEach((m) => {
          this.note(mtof(m), t + 0.17, 1.4, { type: "sawtooth", gain: 0.05, release: 0.9 });
          this.note(mtof(m), t + 0.17, 1.4, { type: "sawtooth", gain: 0.03, detune: 8, release: 0.9 });
        });
        this.hit(t + 0.17, 1.2, { filter: "highpass", freq: 6000, gain: 0.12 });
        break;
      case "rimshot":
        this.note(220, t, 0.18, { to: 110, gain: 0.35 });
        this.note(165, t + 0.2, 0.22, { to: 80, gain: 0.35 });
        this.hit(t + 0.42, 0.12, { freq: 1800, gain: 0.3 });
        this.hit(t + 0.42, 1.1, { filter: "highpass", freq: 7000, gain: 0.3 });
        break;
      case "birthday": {
        const beatAt = birthdayBeatAt;
        let b = 0;
        for (const [m, d] of BIRTHDAY_MELODY) {
          this.epiano(mtof(m), t + beatAt(b), beatAt(b + d) - beatAt(b), 0.2);
          b += d;
        }
        BIRTHDAY_BARS.forEach((bar, i) => {
          const b0 = 1 + i * 3;
          const last = i === BIRTHDAY_BARS.length - 1;
          this.note(mtof(bar.bass), t + beatAt(b0), last ? 2.4 : beatAt(b0 + 1) - beatAt(b0) + 0.3, {
            gain: 0.16,
            attack: 0.01,
            release: last ? 1.6 : 0.25,
          });
          this.note(mtof(bar.bass + 12), t + beatAt(b0), 0.3, { type: "triangle", gain: 0.04, release: 0.25 });
          if (last) {
            // Final chord, arpeggiated and held
            [48, 55, 60, 64, 67, 72].forEach((m, k) => this.epiano(mtof(m), t + beatAt(b0) + k * 0.05, 2, 0.07));
            return;
          }
          [1, 2].forEach((k) => {
            const chord = k === 2 && bar.third ? bar.third : bar.chord;
            for (const m of chord) this.epiano(mtof(m), t + beatAt(b0 + k), 0.35, 0.045);
          });
        });
        break;
      }
    }
  }

  /**
   * Looping waiting music, restarted only when the style changes. `clock`: server time (ms).
   * Every screen plays it at the same position, like a radio running continuously: the position comes
   * from the server time, not from when each person turned sound on.
   */
  startMusic(style: MusicStyle, clock: () => number) {
    if (!this.ready) return;
    if (this.music?.style === style) return;
    this.stopMusic(0.3);
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 2);
    gain.connect(this.leveled(style));
    // Recorded track: streamed from the server (not fully decoded in memory), looping
    const file = musicFile(style);
    if (file) {
      const el = new Audio(withBasePath(file));
      el.loop = true;
      el.preload = "auto";
      const src = ctx.createMediaElementSource(el);
      src.connect(gain);
      // Shared position: server time modulo the track duration
      const target = () => (clock() / 1000) % el.duration;
      const sync = () => {
        if (el.paused || !Number.isFinite(el.duration) || el.duration <= 0) return;
        const drift = Math.abs(el.currentTime - target());
        // Drift above 0.15 s (outside the loop point): resync
        if (drift > 0.15 && drift < el.duration - 0.15) el.currentTime = target();
      };
      el.addEventListener(
        "loadedmetadata",
        () => {
          el.currentTime = target();
          void el.play().catch(() => undefined);
        },
        { once: true },
      );
      // Loading time before start makes it late: resync once playback started
      el.addEventListener("playing", () => setTimeout(sync, 300), { once: true });
      this.music = { gain, timer: setInterval(sync, 10_000), style, el };
      return;
    }
    // Generated music: blocks aligned on a shared grid (server time), scheduled a little ahead so page
    // stutters do not matter; each block's randomness is drawn from its number.
    const beat = style === "bossa-lounge" ? 60 / 128 : 60 / 76;
    // Soft pads: two bars per chord; bossa lounge: one bar per chord
    const blockLen = beat * 4 * (style === "bossa-lounge" ? 1 : 2);
    // Audio-context time matching a server time
    const ctxAt = (serverSec: number) => ctx.currentTime + serverSec - clock() / 1000;
    // First full block ahead: enter the music on a grid boundary
    let i = Math.ceil(clock() / 1000 / blockLen);
    const schedule = () => {
      for (let t = ctxAt(i * blockLen); t < ctx.currentTime + 1.5; t = ctxAt(++i * blockLen)) {
        if (t < ctx.currentTime) continue;
        const rnd = seeded(i);
        if (style === "bossa-lounge") this.loungeBar(t, beat, i, gain, rnd);
        else {
          const [bass, chord] = CHORDS[i % CHORDS.length]!;
          this.softBar(t, beat, bass, chord, gain, rnd);
        }
      }
    };
    schedule();
    this.music = { gain, timer: setInterval(schedule, 250), style };
  }

  /** Pads, soft arpeggio and round bass */
  private softBar(t: number, beat: number, bass: number, chord: number[], dest: AudioNode, rnd: () => number) {
    const len = beat * 8;
    const lp = this.ctx!.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1100;
    lp.connect(dest);
    for (const m of chord) {
      this.note(mtof(m), t, len, { gain: 0.025, attack: 1.2, release: 1.5, dest: lp });
      this.note(mtof(m), t, len, { type: "triangle", gain: 0.015, attack: 1.2, release: 1.5, detune: 7, dest: lp });
    }
    [0, 2, 4, 6].forEach((b) => this.note(mtof(bass), t + b * beat, beat * 1.8, { gain: 0.09, attack: 0.02, release: 0.6, dest }));
    // Eighth-note arpeggio, with rests to breathe
    for (let k = 0; k < 16; k++) {
      if (rnd() < 0.35) continue;
      const m = chord[Math.floor(rnd() * chord.length)]! + 12;
      this.note(mtof(m), t + k * beat * 0.5, beat * 0.9, { type: "triangle", gain: 0.035, attack: 0.005, release: 0.4, dest: lp });
    }
  }

  /** A bar of bossa lounge: bass, syncopated electric piano, brushes, clave and vibraphone */
  private loungeBar(t: number, beat: number, i: number, dest: AudioNode, rnd: () => number) {
    const bar = LOUNGE[i % LOUNGE.length]!;
    const at = (b: number) => t + b * beat;
    // Bass: root and fifth, the swinging bossa pattern
    const bass: [number, number, number][] = [
      [0, 0, 1.4],
      [1.5, 7, 0.45],
      [2, 7, 1.4],
      [3.5, 0, 0.45],
    ];
    for (const [b, iv, d] of bass) {
      this.note(mtof(bar.bass + iv), at(b), d * beat, { gain: 0.13, attack: 0.01, release: 0.15, dest });
      // Harmonic: the bass stays audible on small speakers
      this.note(mtof(bar.bass + iv + 12), at(b), d * beat * 0.7, { type: "triangle", gain: 0.035, attack: 0.01, release: 0.12, dest });
    }
    // Electric piano, short off-beat chords
    for (const b of LOUNGE_COMP[i % 2]!) for (const m of bar.chord) this.epiano(mtof(m), at(b), beat * 0.8, 0.028, dest);
    // Eighth-note brushes (accent on the beats) and rim click on the clave
    for (let k = 0; k < 8; k++) this.hit(at(k / 2), 0.09, { filter: "highpass", freq: 6500, gain: k % 2 ? 0.018 : 0.032, dest });
    for (const b of i % 2 ? [1, 2.5] : [0, 1.5, 3]) this.hit(at(b), 0.035, { freq: 2600, q: 4, gain: 0.07, dest });
    this.note(58, at(0), 0.25, { to: 42, gain: 0.12, dest });
    this.note(58, at(2), 0.25, { to: 42, gain: 0.08, dest });
    // Vibraphone: a phrase every two bars, moving in small intervals
    if (i % 2 === 0) {
      const phrase = LOUNGE_PHRASES[Math.floor(i / 2) % LOUNGE_PHRASES.length]!;
      // Each phrase starts from a note drawn from its number: a screen joining midway plays the same one
      let melody = LOUNGE[i % LOUNGE.length]!.scale[Math.floor(rnd() * 8)]!;
      for (const [b, d] of phrase) {
        const chordNow = LOUNGE[(i + (b >= 4 ? 1 : 0)) % LOUNGE.length]!;
        const near = chordNow.scale.filter((m) => Math.abs(m - melody) <= 4 && m !== melody);
        const pool = near.length ? near : chordNow.scale;
        melody = pool[Math.floor(rnd() * pool.length)]!;
        this.vibe(mtof(melody), at(b), d * beat, dest);
      }
    }
  }

  /** Vibraphone: bar attack, motor tremolo, long resonance */
  private vibe(freq: number, t: number, dur: number, dest: AudioNode) {
    const ctx = this.ctx!;
    const trem = ctx.createGain();
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    lfo.frequency.value = 5.5;
    depth.gain.value = 0.25;
    trem.gain.value = 0.75;
    lfo.connect(depth);
    depth.connect(trem.gain);
    trem.connect(dest);
    const len = dur + 1.2;
    this.note(freq, t, len, { gain: 0.085, attack: 0.004, release: len - 0.05, dest: trem });
    this.note(freq * 4, t, 0.35, { gain: 0.02, attack: 0.002, release: 0.3, dest: trem });
    lfo.start(t);
    lfo.stop(t + len + 0.1);
  }

  stopMusic(fade = 1.5) {
    const mu = this.music;
    if (!mu || !this.ctx) return;
    this.music = null;
    if (mu.timer) clearInterval(mu.timer);
    const now = this.ctx.currentTime;
    mu.gain.gain.cancelScheduledValues(now);
    mu.gain.gain.setValueAtTime(Math.max(0.0001, mu.gain.gain.value), now);
    mu.gain.gain.exponentialRampToValueAtTime(0.0001, now + fade);
    setTimeout(
      () => {
        // Recorded track: stopped and released once the fade is over
        if (mu.el) {
          mu.el.pause();
          mu.el.removeAttribute("src");
          mu.el.load();
        }
        mu.gain.disconnect();
      },
      (fade + 1.6) * 1000,
    );
  }
}

/** Reproducible randomness (mulberry32): the same block number gives the same notes on every screen */
function seeded(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Happy Birthday: time of each beat, at 104 bpm, slowing down on the last phrase */
function birthdayBeatAt(b: number) {
  return b * 0.58 + Math.max(0, b - 19) ** 2 * 0.012;
}
/** Song duration: last bar (pickup + 7 bars of 3 beats), then the held final chord */
const BIRTHDAY_SECONDS = birthdayBeatAt(1 + 7 * 3) + 2.4;

const lengths = new Map<SoundKey, Promise<number>>();

/**
 * Duration of a soundboard sound, in seconds: read from the recorded file metadata (without downloading
 * it all), computed for a generated sound. Used to light the pad during playback.
 */
export function soundLength(key: SoundKey): Promise<number> {
  if (key === "birthday") return Promise.resolve(BIRTHDAY_SECONDS);
  const path = SAMPLES[key];
  if (!path) return Promise.resolve(2);
  let p = lengths.get(key);
  if (!p) {
    p = new Promise<number>((ok) => {
      const el = new Audio();
      el.preload = "metadata";
      el.onloadedmetadata = () => ok(Number.isFinite(el.duration) ? el.duration : 3);
      el.onerror = () => ok(3);
      el.src = withBasePath(path);
    });
    lengths.set(key, p);
  }
  return p;
}

let synth: Synth | null = null;
/** Moteur unique de la page */
export const getSynth = () => (synth ??= new Synth());
