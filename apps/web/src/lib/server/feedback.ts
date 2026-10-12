import "server-only";
import { prisma } from "@ronde/db";
import sharp from "sharp";
import { z } from "zod";
import type { CurrentUser } from "./authz";
import { env } from "./env";
import { AppError, OpError } from "./errors";
import { sniffImage } from "./images";

// What people tell about Ronde from the app (the button of the top bar, the error page): kept for the instance's
// administrators (/admin), in the cloud for the Ronde team's back-office, and sent to the instance's Sentry
// project when it has one. RONDE_FEEDBACK=off takes the button away.

export const FEEDBACK_KINDS = ["bug", "idea", "other"] as const;
export const FEEDBACK_STATUSES = ["new", "handled", "archived"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** The whole request: the message, its context and a screenshot the browser has already scaled down */
export const FEEDBACK_MAX_BYTES = 4_000_000;
/** Longest side of a screenshot kept */
const SHOT_MAX = 1920;
/** At most this many messages per person: in ten minutes, in a day */
const BURST = { count: 5, minutes: 10 };
const DAILY = 20;
/** Messages are deleted after a year */
export const FEEDBACK_KEEP_DAYS = 365;

export const feedbackInput = z.object({
  kind: z.enum(FEEDBACK_KINDS),
  message: z.string().trim().min(1).max(5000),
  contact: z.boolean(),
  /** The workspace open (its slug), kept only when the person belongs to it */
  workspace: z.string().max(80).optional(),
  path: z.string().max(500).optional(),
  viewport: z.string().max(20).optional(),
  theme: z.enum(["light", "dark"]).optional(),
  /** Reference of the error shown on the error page */
  errorRef: z.string().max(80).optional(),
});
export type FeedbackInput = z.infer<typeof feedbackInput>;

/**
 * The page, without what may be a secret: no query or fragment, no token of a guest link, an invitation or an
 * unsubscribe link, and no long random segment
 */
export function cleanPath(raw: string | undefined): string {
  if (!raw) return "";
  const path = raw.split(/[?#]/)[0] ?? "";
  if (!path.startsWith("/")) return "";
  return path
    .replace(/\/(g|invite|unsubscribe|reset-password|verify)\/[^/]+/g, "/$1/…")
    .split("/")
    .map((s) => (s.length > 40 ? "…" : s))
    .join("/")
    .slice(0, 300);
}

/** The screenshot, re-encoded (WebP, no metadata, at most 1920 px): what was sent is never served as it is */
export async function cleanScreenshot(bytes: Uint8Array): Promise<{ data: Uint8Array<ArrayBuffer>; width: number; height: number }> {
  if (!sniffImage(bytes)) throw new OpError("feedbackImageFormat");
  try {
    const { data, info } = await sharp(bytes, { limitInputPixels: 8192 * 8192 })
      .rotate()
      .resize({ width: SHOT_MAX, height: SHOT_MAX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { data: new Uint8Array(data), width: info.width, height: info.height };
  } catch {
    throw new OpError("feedbackImageFormat");
  }
}

const BROWSERS: [RegExp, string][] = [
  [/Edg(?:e|A|iOS)?\/(\d+)/, "Edge"],
  [/OPR\/(\d+)/, "Opera"],
  [/SamsungBrowser\/(\d+)/, "Samsung Internet"],
  [/(?:Firefox|FxiOS)\/(\d+)/, "Firefox"],
  [/(?:Chrome|CriOS)\/(\d+)/, "Chrome"],
  [/Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari/, "Safari"],
];
const SYSTEMS: [RegExp, string][] = [
  [/Windows/, "Windows"],
  [/iPhone|iPad|iPod/, "iOS"],
  [/Android/, "Android"],
  [/CrOS/, "ChromeOS"],
  [/Macintosh|Mac OS X/, "macOS"],
  [/Linux/, "Linux"],
];

/** "Firefox 141 · Linux": enough to reproduce a problem, short enough to read at a glance */
export function browserName(ua: string): string {
  let browser = "";
  for (const [re, name] of BROWSERS) {
    const m = re.exec(ua);
    if (m) {
      browser = `${name} ${m[1]}`;
      break;
    }
  }
  const system = SYSTEMS.find(([re]) => re.test(ua))?.[1];
  return [browser, system].filter(Boolean).join(" · ") || ua.slice(0, 80);
}

/** The person has sent too many messages lately: in ten minutes, or in a day */
async function overLimit(db: Pick<typeof prisma, "feedback">, userId: string): Promise<boolean> {
  const now = Date.now();
  const [burst, daily] = await Promise.all([
    db.feedback.count({ where: { userId, createdAt: { gte: new Date(now - BURST.minutes * 60_000) } } }),
    db.feedback.count({ where: { userId, createdAt: { gte: new Date(now - 86_400_000) } } }),
  ]);
  return burst >= BURST.count || daily >= DAILY;
}

/** People sending right now: one message at a time each (in this process; the database lock covers the others) */
const sending = new Set<string>();
/** Screenshots re-encoded at once: the others wait their turn, so a burst does not take the server's memory */
const ENCODING_AT_ONCE = 2;
let encoding = 0;
const queue: (() => void)[] = [];
async function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  if (encoding >= ENCODING_AT_ONCE) await new Promise<void>((resolve) => queue.push(resolve));
  encoding++;
  try {
    return await work();
  } finally {
    encoding--;
    queue.shift()?.();
  }
}

/** Keeps a message, then passes it to Sentry when the instance has a project there */
export async function sendFeedback(
  user: CurrentUser,
  input: FeedbackInput,
  shot: Uint8Array | null,
  meta: { browser: string; locale: string },
): Promise<{ id: string }> {
  if (!env.feedbackTo()) throw new AppError("notFound", {}, 404);
  if (sending.has(user.id) || (await overLimit(prisma, user.id))) throw new AppError("feedbackTooMany", {}, 429);
  sending.add(user.id);
  try {
    const image = shot?.length ? await oneAtATime(() => cleanScreenshot(shot)) : null;
    const workspace = input.workspace
      ? await prisma.workspace.findFirst({
          where: { slug: input.workspace, deletedAt: null, members: { some: { userId: user.id, status: "active" } } },
          select: { id: true, slug: true, plan: true },
        })
      : null;
    const context = {
      path: cleanPath(input.path),
      version: process.env.RONDE_VERSION || "dev",
      browser: browserName(meta.browser),
      userAgent: meta.browser.slice(0, 300),
      viewport: input.viewport ?? "",
      locale: meta.locale,
      ...(input.theme ? { theme: input.theme } : {}),
      ...(input.errorRef ? { errorRef: input.errorRef } : {}),
    };
    // Counted again under a lock of the person: requests sent together, to several servers, are not all let in
    const row = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`feedback:${user.id}`}))`;
      if (await overLimit(tx, user.id)) throw new AppError("feedbackTooMany", {}, 429);
      return tx.feedback.create({
        data: {
          kind: input.kind,
          message: input.message,
          contact: input.contact,
          context,
          userId: user.id,
          fromWorkspaceId: workspace?.id ?? null,
          ...(image ? { screenshot: { create: { data: image.data, type: "image/webp", width: image.width, height: image.height } } } : {}),
        },
        select: { id: true },
      });
    });
    void toSentry(row.id, user, input, context, workspace?.plan ?? null, image?.data ?? null);
    return row;
  } finally {
    sending.delete(user.id);
  }
}

/** The same message in the instance's Sentry project (User Feedback): the address only when an answer is welcome */
async function toSentry(
  id: string,
  user: CurrentUser,
  input: FeedbackInput,
  context: { path: string; version: string; locale: string; errorRef?: string },
  plan: string | null,
  image: Uint8Array | null,
) {
  if (!env.sentryDsn()) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureFeedback(
      {
        message: input.message,
        ...(input.contact ? { name: user.name || undefined, email: user.email } : {}),
        url: `${env.appUrl()}${context.path}`,
        source: "ronde-app",
        tags: {
          kind: input.kind,
          feedback: id,
          locale: context.locale,
          ...(plan ? { plan } : {}),
          ...(context.errorRef ? { error_ref: context.errorRef } : {}),
        },
      },
      image ? { attachments: [{ filename: "screenshot.webp", data: image, contentType: "image/webp" }] } : undefined,
    );
  } catch (e) {
    console.error("[feedback] not sent to Sentry", e);
  }
}

/** The messages for the instance's administrators: the newest first, the archived ones on request */
export async function listFeedback(f: { status?: string; kind?: string }) {
  const rows = await prisma.feedback.findMany({
    where: {
      ...((FEEDBACK_STATUSES as readonly string[]).includes(f.status ?? "") ? { status: f.status } : { status: { not: "archived" } }),
      ...((FEEDBACK_KINDS as readonly string[]).includes(f.kind ?? "") ? { kind: f.kind } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      kind: true,
      message: true,
      context: true,
      contact: true,
      status: true,
      handledBy: true,
      createdAt: true,
      user: { select: { name: true, email: true } },
      fromWorkspace: { select: { name: true, slug: true } },
      screenshot: { select: { width: true, height: true } },
    },
  });
  // The address is only shown to whoever may answer: when the person asked for it
  return rows.map(({ user, fromWorkspace, ...r }) => ({
    ...r,
    workspace: fromWorkspace,
    context: r.context as Record<string, string>,
    from: { name: user.name, email: r.contact ? user.email : null },
  }));
}
export type FeedbackRow = Awaited<ReturnType<typeof listFeedback>>[number];

export async function setFeedbackStatus(id: string, status: string, by: string) {
  if (!(FEEDBACK_STATUSES as readonly string[]).includes(status)) throw new OpError("invalidRequest", { details: "status" });
  const { count } = await prisma.feedback.updateMany({
    where: { id },
    data: { status, handledBy: status === "new" ? null : by, handledAt: status === "new" ? null : new Date() },
  });
  if (!count) throw new AppError("notFound", {}, 404);
}

/** Messages older than a year go away */
export async function purgeFeedback() {
  await prisma.feedback.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - FEEDBACK_KEEP_DAYS * 86_400_000) } } });
}
