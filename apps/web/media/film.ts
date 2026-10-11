import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContextOptions, Page } from "@playwright/test";

// Shared by the capture specs: where pictures go, signing in, and filming a page frame by frame.

export const DOCS = path.resolve(import.meta.dirname, "../../../docs/media");
/**
 * The website's copies of the pictures and clips, when a site asks for them (SITE_MEDIA_DIR, set by the
 * team's site repository): without it, only the README's pictures are made
 */
export const SITE = process.env.SITE_MEDIA_DIR ? path.resolve(process.env.SITE_MEDIA_DIR) : undefined;
/** Working files, kept between runs (Playwright empties test-results): PNGs, and the frames of each clip, read again by the site's promo video */
export const RAW = path.resolve(import.meta.dirname, ".work");
export const FPS = 30;

export const HOST = { email: "host@example.com", password: "ronde-demo-password" };
export const HUGO = { name: "Hugo Moreau", email: "hugo.moreau@example.com", password: "hugo-demo-password" };

export function ffmpeg(...args: string[]) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);
}

export async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto("/sign-in");
  await page.getByText("With password").click();
  await page.getByLabel("Email", { exact: true }).fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/w\/demo/);
}

export async function signedIn(browser: Browser, options: BrowserContextOptions, who = HOST) {
  const context = await browser.newContext({ locale: "en-US", ...options });
  const page = await context.newPage();
  await signIn(page, who);
  return { context, page };
}

/** The demo meeting's address */
export async function meetingOf(page: Page) {
  await page.goto("/w/demo");
  const href = await page.locator("a[href*='/m/']").first().getAttribute("href");
  return new URL(href!.replace(/\/(control|me)$/, ""), page.url()).href;
}

/**
 * Films the page while `act` runs: every frame the browser paints, as a JPEG with its time, then rebuilt at a
 * steady 30 frames per second. Leaves the frames in RAW/<name>/ (for the promo video) and returns the folder.
 */
export async function film(page: Page, name: string, act: () => Promise<void>) {
  const dir = path.join(RAW, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, "in"), { recursive: true });
  const frames: { file: string; at: number }[] = [];
  const size = page.viewportSize()!;
  const scale = await page.evaluate(() => window.devicePixelRatio);
  await page.screencast.start({
    size: { width: Math.round(size.width * scale), height: Math.round(size.height * scale) },
    quality: 92,
    onFrame: ({ data, timestamp }) => {
      const file = path.join(dir, "in", `${String(frames.length).padStart(5, "0")}.jpg`);
      writeFileSync(file, data);
      frames.push({ file, at: timestamp });
    },
  });
  await act();
  await page.waitForTimeout(300);
  await page.screencast.stop();
  if (frames.length < 2) throw new Error(`No frames for ${name}`);
  // Each frame lasts until the next one; the concat demuxer turns that into a steady rate
  const start = frames[0]!.at;
  const lines = frames.flatMap((f, i) => {
    const next = frames[i + 1]?.at ?? f.at + 1000 / FPS;
    return [`file '${f.file}'`, `duration ${((next - f.at) / 1000).toFixed(4)}`];
  });
  lines.push(`file '${frames.at(-1)!.file}'`);
  writeFileSync(path.join(dir, "list.txt"), lines.join("\n"));
  mkdirSync(path.join(dir, "frames"));
  ffmpeg(
    ...["-f", "concat", "-safe", "0", "-i", path.join(dir, "list.txt")],
    ...["-vf", `fps=${FPS},scale=trunc(iw/2)*2:trunc(ih/2)*2`, "-q:v", "2"],
    path.join(dir, "frames", "%05d.jpg"),
  );
  rmSync(path.join(dir, "in"), { recursive: true });
  console.log(`${name}: ${((frames.at(-1)!.at - start) / 1000).toFixed(1)} s, ${frames.length} painted frames`);
  return dir;
}

/** A clip for the site: H.264 (plays everywhere), muted, from its frames, with a poster (when a site asked for clips) */
export function encodeClip(dir: string, name: string, { width, from = 0, to }: { width: number; from?: number; to?: number }) {
  if (!SITE) return;
  mkdirSync(SITE, { recursive: true });
  const out = path.join(SITE, name);
  const range = [...(from ? ["-start_number", String(Math.round(from * FPS) + 1)] : [])];
  const length = to ? ["-frames:v", String(Math.round((to - from) * FPS))] : [];
  ffmpeg(
    ...["-framerate", String(FPS), ...range, "-i", path.join(dir, "frames", "%05d.jpg"), ...length],
    ...["-vf", `scale=${width}:-2:flags=lanczos`, "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p"],
    ...["-movflags", "+faststart", "-an", `${out}.mp4`],
  );
  // The poster is the clip's first frame: what the page shows before it plays, and with reduced motion
  ffmpeg(
    ...["-framerate", String(FPS), ...range, "-i", path.join(dir, "frames", "%05d.jpg"), "-frames:v", "1"],
    ...["-vf", `scale=${width}:-2:flags=lanczos`, "-c:v", "libwebp", "-quality", "82", `${out}.webp`],
  );
}

/** An endless loop for the README (GitHub plays no video files there): animated WebP, 12 frames per second */
export function loopWebp(dir: string, out: string, { width, from = 0, to }: { width: number; from?: number; to?: number }) {
  ffmpeg(
    ...["-framerate", String(FPS), "-start_number", String(Math.round(from * FPS) + 1), "-i", path.join(dir, "frames", "%05d.jpg")],
    ...(to ? ["-frames:v", String(Math.round((to - from) * FPS))] : []),
    ...["-vf", `fps=12,scale=${width}:-2:flags=lanczos`, "-loop", "0", "-c:v", "libwebp_anim", "-quality", "72", "-compression_level", "6"],
    `${out}.webp`,
  );
}
