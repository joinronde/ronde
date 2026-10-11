import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * The graphics card, when there is one: in software, a blurred overlay (the hand-over between two turns) paints
 * about 12 frames a second, and the clips stutter; with the card, about 60. Without one, Chrome falls back to software.
 */
export const GPU = ["--enable-gpu", "--ignore-gpu-blocklist", "--use-angle=gl-egl"];

// The pictures and clips of the README and of the site (media/*.spec.ts), on the demo workspace, from the
// production build (E2E_BUILD=1 in the "media" script)
export default defineConfig({
  ...base,
  testDir: "media",
  retries: 0,
  workers: 1,
  // A step that cannot be done fails fast, instead of waiting for the whole capture's time limit. No trace:
  // it films the page at 800 pixels, and a clip would share that small screencast instead of its own
  use: { ...base.use, actionTimeout: 15_000, trace: "off", launchOptions: { args: GPU } },
});
