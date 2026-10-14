import { prisma } from "@ronde/db";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "@/lib/server/authz";
import {
  browserName,
  cleanPath,
  type FeedbackInput,
  listFeedback,
  purgeFeedback,
  sendFeedback,
  setFeedbackStatus,
} from "@/lib/server/feedback";
import { workspace } from "./fixtures";

// "Send feedback": what people tell about Ronde, kept for the instance's administrators (the back-office in the
// cloud) and passed to the instance's Sentry project when it has one

const captureFeedback = vi.fn();
vi.mock("@sentry/nextjs", () => ({ captureFeedback: (...a: unknown[]) => captureFeedback(...a) }));

const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:141.0) Gecko/20100101 Firefox/141.0";
const meta = { browser: FIREFOX, locale: "en" };
const asUser = (u: { id: string; name: string; email: string }): CurrentUser => ({
  ...u,
  image: null,
  locale: null,
  timezone: null,
  instanceRole: "user",
});
const input = (patch: Partial<FeedbackInput> = {}): FeedbackInput => ({ kind: "bug", message: "The timer froze", contact: true, ...patch });
const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: "#c43" } })
    .png()
    .toBuffer()
    .then((b) => new Uint8Array(b));

beforeEach(() => {
  captureFeedback.mockClear();
  delete process.env.SENTRY_DSN;
  // A self-hosted instance that asked for its people's feedback
  process.env.RONDE_FEEDBACK = "on";
});
afterEach(() => {
  delete process.env.SENTRY_DSN;
  delete process.env.RONDE_FEEDBACK;
});

describe("feedback", () => {
  it("keeps the message with where it came from, the workspace only for its members, and a cleaned screenshot", async () => {
    const run = Date.now().toString(36);
    const a = await workspace(`fb-a-${run}`);
    const b = await workspace(`fb-b-${run}`);
    const user = asUser(a.user);

    const { id } = await sendFeedback(
      user,
      input({ workspace: a.ws.slug, path: `/w/${a.ws.slug}/m/abc/control?token=secret#x`, viewport: "1280×800", errorRef: "123" }),
      await png(3000, 2000),
      meta,
    );
    const row = await prisma.feedback.findUniqueOrThrow({ where: { id }, include: { screenshot: true } });
    expect(row).toMatchObject({
      kind: "bug",
      message: "The timer froze",
      contact: true,
      userId: a.user.id,
      fromWorkspaceId: a.ws.id,
      status: "new",
    });
    expect(row.context).toMatchObject({
      path: `/w/${a.ws.slug}/m/abc/control`,
      browser: "Firefox 141 · Linux",
      userAgent: FIREFOX,
      viewport: "1280×800",
      locale: "en",
      errorRef: "123",
    });
    // Re-encoded: WebP, at most 1920 px, nothing of the file sent kept as it was
    expect(row.screenshot).toMatchObject({ type: "image/webp", width: 1920, height: 1280 });
    expect(Buffer.from(row.screenshot!.data).subarray(8, 12).toString()).toBe("WEBP");

    // Another workspace than the person's: the message stays, without it
    const other = await sendFeedback(user, input({ workspace: b.ws.slug }), null, meta);
    expect((await prisma.feedback.findUniqueOrThrow({ where: { id: other.id } })).fromWorkspaceId).toBeNull();
  });

  it("refuses what is not an image, and too many messages in a short time", async () => {
    const run = Date.now().toString(36);
    const { user } = await workspace(`fb-limit-${run}`);
    await expect(sendFeedback(asUser(user), input(), new TextEncoder().encode("<svg onload=alert(1)>"), meta)).rejects.toMatchObject({
      key: "feedbackImageFormat",
    });
    for (let i = 0; i < 5; i++) await sendFeedback(asUser(user), input({ message: `Message ${i}` }), null, meta);
    await expect(sendFeedback(asUser(user), input(), null, meta)).rejects.toMatchObject({ key: "feedbackTooMany", status: 429 });
  });

  it("keeps to the limit when messages are sent all at once", async () => {
    const { user } = await workspace(`fb-race-${Date.now().toString(36)}`);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => sendFeedback(asUser(user), input({ message: `At once ${i}` }), null, meta)),
    );
    expect(results.filter((r) => r.status === "fulfilled").length).toBeLessThanOrEqual(5);
    expect(await prisma.feedback.count({ where: { userId: user.id } })).toBeLessThanOrEqual(5);
  });

  it("is off by default on a self-hosted instance", async () => {
    const { user } = await workspace(`fb-default-${Date.now().toString(36)}`);
    delete process.env.RONDE_FEEDBACK;
    await expect(sendFeedback(asUser(user), input(), null, meta)).rejects.toMatchObject({ key: "notFound", status: 404 });
  });

  it("is turned off with RONDE_FEEDBACK=off", async () => {
    const { user } = await workspace(`fb-off-${Date.now().toString(36)}`);
    process.env.RONDE_FEEDBACK = "off";
    await expect(sendFeedback(asUser(user), input(), null, meta)).rejects.toMatchObject({ key: "notFound", status: 404 });
  });

  it("goes to Sentry when the instance has a project there, with the address only when an answer is welcome", async () => {
    const run = Date.now().toString(36);
    const { user } = await workspace(`fb-sentry-${run}`);
    await sendFeedback(asUser(user), input(), null, meta);
    expect(captureFeedback).not.toHaveBeenCalled();

    process.env.SENTRY_DSN = "https://key@sentry.example.test/1";
    const { id } = await sendFeedback(asUser(user), input({ kind: "idea", message: "Dark screen", path: "/w/x" }), await png(10, 10), meta);
    await vi.waitFor(() => expect(captureFeedback).toHaveBeenCalledTimes(1));
    const [params, hint] = captureFeedback.mock.calls[0]!;
    expect(params).toMatchObject({ message: "Dark screen", email: user.email, source: "ronde-app", tags: { kind: "idea", feedback: id } });
    expect(hint.attachments[0]).toMatchObject({ filename: "screenshot.webp", contentType: "image/webp" });

    await sendFeedback(asUser(user), input({ contact: false }), null, meta);
    await vi.waitFor(() => expect(captureFeedback).toHaveBeenCalledTimes(2));
    expect(captureFeedback.mock.calls[1]![0]).not.toHaveProperty("email");
    expect(captureFeedback.mock.calls[1]![0]).not.toHaveProperty("name");
  });

  it("lists the messages for the administrators, the address only when the person asked for an answer", async () => {
    const run = Date.now().toString(36);
    const { user } = await workspace(`fb-list-${run}`);
    const yes = await sendFeedback(asUser(user), input({ message: `answer me ${run}` }), null, meta);
    const no = await sendFeedback(asUser(user), input({ message: `no answer ${run}`, contact: false }), null, meta);

    const mine = (await listFeedback({})).filter((f) => f.message.endsWith(run));
    expect(mine.find((f) => f.id === yes.id)?.from).toEqual({ name: user.name, email: user.email });
    expect(mine.find((f) => f.id === no.id)?.from).toEqual({ name: user.name, email: null });

    await setFeedbackStatus(no.id, "archived", "admin@example.test");
    expect((await listFeedback({})).some((f) => f.id === no.id)).toBe(false);
    expect((await listFeedback({ status: "archived" })).find((f) => f.id === no.id)).toMatchObject({ handledBy: "admin@example.test" });
    await setFeedbackStatus(no.id, "new", "admin@example.test");
    expect(await prisma.feedback.findUniqueOrThrow({ where: { id: no.id } })).toMatchObject({ status: "new", handledBy: null });

    await expect(setFeedbackStatus(no.id, "deleted", "admin@example.test")).rejects.toMatchObject({ key: "invalidRequest" });
    await expect(setFeedbackStatus("00000000-0000-7000-8000-000000000000", "handled", "x")).rejects.toMatchObject({ key: "notFound" });
  });

  it("goes away with the account, and after a year", async () => {
    const run = Date.now().toString(36);
    const { user } = await workspace(`fb-purge-${run}`);
    const old = await sendFeedback(asUser(user), input(), await png(10, 10), meta);
    const recent = await sendFeedback(asUser(user), input(), null, meta);
    await prisma.feedback.update({ where: { id: old.id }, data: { createdAt: new Date(Date.now() - 366 * 86_400_000) } });
    await purgeFeedback();
    expect(await prisma.feedback.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.feedbackImage.findUnique({ where: { feedbackId: old.id } })).toBeNull();

    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.feedback.findUnique({ where: { id: recent.id } })).toBeNull();
  });
});

describe("what goes with a message", () => {
  it("keeps the page without its query, and without the tokens a link may carry", () => {
    expect(cleanPath("/w/acme/m/1/control?x=1#y")).toBe("/w/acme/m/1/control");
    expect(cleanPath("/g/very-secret-token/screen")).toBe("/g/…/screen");
    expect(cleanPath("/invite/abc")).toBe("/invite/…");
    expect(cleanPath(`/w/acme/${"a".repeat(64)}`)).toBe("/w/acme/…");
    expect(cleanPath("https://evil.test/x")).toBe("");
    expect(cleanPath(undefined)).toBe("");
  });

  it("names the browser and the system in a few words", () => {
    expect(browserName(FIREFOX)).toBe("Firefox 141 · Linux");
    expect(
      browserName(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
      ),
    ).toBe("Edge 140 · Windows");
    expect(
      browserName(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari 18 · iOS");
    expect(browserName("curl/8.0")).toBe("curl/8.0");
  });
});
