import { execFileSync } from "node:child_process";
import path from "node:path";

// The pictures and clips of the README, in one go, from the production build (pnpm build):
//   MEDIA_DATABASE_URL=postgres://…/ronde_media pnpm --filter @ronde/web media
// The demo workspace is recreated before each capture (pnpm db:seed --force), so the database must be one
// kept for this: never the one you work with.
//   1. the stills (media.spec.ts) → docs/media
//   2. the clips (clips.spec.ts) → the README's loop, and their frames in media/.work
// With SITE_MEDIA_DIR, the website's copies of the stills and clips are written there too (the team's site
// repository sets it, then renders its promo video from the frames).

const url = process.env.MEDIA_DATABASE_URL;
if (!url) {
  console.error("Set MEDIA_DATABASE_URL to a database kept for the captures: the demo workspace is recreated in it.");
  process.exit(1);
}
const app = path.resolve(import.meta.dirname, "..");
const env = { ...process.env, DATABASE_URL: url, E2E_BUILD: "1" };
// On Windows, pnpm is a script (pnpm.cmd) that only a shell finds
const run = (cmd: string, args: string[]) =>
  execFileSync(cmd, args, { cwd: app, env, stdio: "inherit", shell: process.platform === "win32" });

for (const spec of ["media.spec.ts", "clips.spec.ts"]) {
  run("pnpm", ["--silent", "db:seed", "--force"]);
  run("pnpm", ["exec", "playwright", "test", "-c", "media.config.ts", spec]);
}
