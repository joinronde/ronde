import type { BoardSound } from "@ronde/core/sound";

/** Real-time events sent to the browsers following a meeting */
export type BusEvent =
  | { kind: "state" }
  | { kind: "history" }
  | { kind: "reaction"; emoji: string; byId: string | null }
  | { kind: "kudo"; fromId: string; toId: string; text: string }
  /** Soundboard sound, played wherever sounds are turned on */
  | { kind: "sound"; sound: BoardSound }
  /** Screen sharing between two browser tabs (WebRTC signalling): to one tab, or "*" for announcements */
  | { kind: "signal"; to: string; from: string; type: SignalType; data: unknown };

export type SignalType = "share" | "stop" | "hello" | "offer" | "answer" | "ice";
