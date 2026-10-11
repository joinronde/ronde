import type { ModuleDef } from "@ronde/module-sdk";
import { ambience } from "./ambience";
import { asyncMode } from "./async";
import { birthdays } from "./birthdays";
import { decisions } from "./decisions";
import { github } from "./github";
import { gitlab } from "./gitlab";
import { hands } from "./hands";
import { icebreaker } from "./icebreaker";
import { kudos } from "./kudos";
import { mood } from "./mood";
import { parking } from "./parking";
import { poker } from "./poker";
import { polls } from "./polls";
import { random } from "./random";
import { rating } from "./rating";
import { reactions } from "./reactions";
import { retro, timebox } from "./retro";
import { rotation } from "./rotation";
import { sounds } from "./sounds";
import { spotlight } from "./spotlight";
import { video } from "./video";

export { pickIcebreaker } from "./icebreaker";
export { POKER_DECKS, type PokerConfig, pokerLive } from "./poker";
export { SCALE, validAnswer } from "./polls";
export { DRAW_KINDS, drawOutcome, readDraw } from "./random";
export { groupLoneCards, RETRO_PRESETS, type RetroConfig, retroColumns, retroState } from "./retro";
export { DEFAULT_JITSI, newRoom, type VideoConfig, videoLink } from "./video";
export {
  ambience,
  asyncMode,
  birthdays,
  decisions,
  github,
  gitlab,
  hands,
  icebreaker,
  kudos,
  mood,
  parking,
  poker,
  polls,
  random,
  rating,
  reactions,
  retro,
  rotation,
  sounds,
  spotlight,
  timebox,
  video,
};

/** Community Edition modules, in catalog order (explicit imports: no discovery on disk) */
export const MODULES = [
  icebreaker,
  mood,
  rating,
  reactions,
  hands,
  kudos,
  spotlight,
  random,
  birthdays,
  sounds,
  ambience,
  rotation,
  timebox,
  polls,
  parking,
  decisions,
  retro,
  poker,
  asyncMode,
  gitlab,
  github,
  video,
] as const;

export type ModuleId = (typeof MODULES)[number]["id"];

export const moduleById = (id: string): ModuleDef | undefined => (MODULES as readonly ModuleDef[]).find((m) => m.id === id);
