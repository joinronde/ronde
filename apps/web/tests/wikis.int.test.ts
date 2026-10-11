import { generateKeyPairSync, sign } from "node:crypto";
import { prisma } from "@ronde/db";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { saveLicense } from "@/lib/server/license";
import { runOp } from "@/lib/server/meeting/ops";
import { deleteWiki, publishSession, saveWiki, setMeetingWiki, wikiPagesOf } from "@/lib/server/wikis";
import { type Fixture, meeting, workspace } from "./fixtures";

// Minutes published to a wiki (Team): the page created at the archive, updated with the summary, a failure
// kept for the history to show, and nothing left behind when the wiki is removed

const pair = generateKeyPairSync("ed25519");
process.env.RONDE_LICENSE_TEST_KEYS = JSON.stringify({ "test-wiki": pair.publicKey.export({ format: "jwk" }).x });
const body = Buffer.from(
  JSON.stringify({
    kid: "test-wiki",
    id: "lic_w",
    customer: "Acme",
    edition: "team",
    seats: 0,
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
  }),
).toString("base64url");
const KEY = `ronde_lic_v1.${body}.${sign(null, Buffer.from(`ronde_lic_v1.${body}`), pair.privateKey).toString("base64url")}`;

/** What Notion receives, and what it answers: a new page each time it is asked for one */
const calls: { url: string; method: string; body: Record<string, unknown> }[] = [];
let failing = false;
let created = 0;
const notion = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : {} });
      if (failing) return new Response(JSON.stringify({ message: "Could not find page" }), { status: 404 });
      // The meeting's webhook connector is called too: only Notion's new pages count
      const n = init.method === "POST" && url.endsWith("/v1/pages") ? ++created : created;
      return new Response(JSON.stringify({ id: `page-${n}`, url: `https://www.notion.so/page-${n}` }), { status: 200 });
    }),
  );

let f: Fixture;
const PARENT = "https://www.notion.so/acme/Team-meetings-1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6";

beforeAll(async () => {
  await saveLicense(KEY);
  f = await meeting(await workspace(`wiki-${Date.now().toString(36)}`), "Platform sync");
});

afterEach(() => {
  vi.unstubAllGlobals();
  failing = false;
});

afterAll(async () => {
  await saveLicense("");
});

describe("wikis", () => {
  it("refuses an incomplete wiki, and keeps the token encrypted", async () => {
    await expect(
      saveWiki(f.ctx.ws, { kind: "notion", name: "Notion", config: { parent: "not a page" }, token: "ntn_x" }),
    ).rejects.toThrow();
    // Confluence Cloud signs in with an email; a Data Center does not need one
    await expect(
      saveWiki(f.ctx.ws, { kind: "confluence", name: "Wiki", config: { site: "https://acme.atlassian.net", space: "ENG" }, token: "t" }),
    ).rejects.toThrow();
    await saveWiki(f.ctx.ws, {
      kind: "confluence",
      name: "Intranet",
      config: { site: "https://wiki.acme.internal", space: "ENG" },
      token: "pat",
    });
    const { id } = await saveWiki(f.ctx.ws, { kind: "notion", name: "Team notes", config: { parent: PARENT }, token: "ntn_secret" });
    const row = await prisma.wiki.findUniqueOrThrow({ where: { id } });
    expect(row.secret).not.toContain("ntn_secret");
  });

  it("publishes the minutes at the archive, then updates the page when the summary changes", async () => {
    const wiki = await prisma.wiki.findFirstOrThrow({ where: { workspaceId: f.workspaceId, kind: "notion" } });
    await setMeetingWiki(f.ctx, wiki.id);
    notion();
    await runOp(f.ctx, { op: "meeting.goto", key: "end" }).catch(() => undefined);
    await runOp(f.ctx, { op: "meeting.archive", summary: "We ship on **Friday**.", omit: [] });
    const session = await prisma.session.findFirstOrThrow({ where: { meetingId: f.meetingId, status: "archived" } });
    await vi.waitFor(async () => expect(await prisma.wikiPage.count({ where: { sessionId: session.id } })).toBe(1));

    const newPage = calls.find((c) => c.method === "POST" && c.url.startsWith("https://api.notion.com"))!;
    expect(newPage.url).toBe("https://api.notion.com/v1/pages");
    expect(newPage.body.parent).toEqual({ page_id: "1a2b3c4d-5e6f-47a8-b9c0-d1e2f3a4b5c6" });
    // Named by its date first, the meeting's name after
    expect(newPage.body.properties).toEqual({ title: { title: [{ type: "text", text: { content: `${session.date} · Platform sync` } }] } });
    const text = JSON.stringify(newPage.body.children);
    expect(text).toContain('"content":"Friday"');
    // At the bottom, the way back to the meeting's history in Ronde
    expect(text).toMatch(new RegExp(`"Open in Ronde","link":\\{"url":"[^"]+/w/${f.ctx.ws.workspace.slug}/m/${f.meetingId}/history"`));
    expect((await wikiPagesOf(f.ctx.ws.db, { wikiId: wiki.id }, [session.id])).get(session.id)).toMatchObject({
      url: "https://www.notion.so/page-1",
      error: "",
    });

    // The summary is edited: a new version of the page, the earlier one in Notion's trash
    calls.length = 0;
    await runOp(f.ctx, { op: "history.summary", date: session.date, summary: "We ship on Monday." });
    await vi.waitFor(async () =>
      expect((await prisma.wikiPage.findFirstOrThrow({ where: { sessionId: session.id } })).url).toBe("https://www.notion.so/page-2"),
    );
    expect(calls.find((c) => c.method === "PATCH" && c.url.endsWith("/pages/page-1"))?.body).toEqual({ archived: true });
  });

  it("keeps a failure for the history, with the page published before", async () => {
    const session = await prisma.session.findFirstOrThrow({ where: { meetingId: f.meetingId, status: "archived" } });
    notion();
    failing = true;
    const page = await publishSession(session.id);
    // Kept as a code the history translates, with what Notion said
    expect(page).toMatchObject({ url: "https://www.notion.so/page-2", error: "notionPage:Could not find page" });
    const row = await prisma.wikiPage.findFirstOrThrow({ where: { sessionId: session.id } });
    expect(row).toMatchObject({ pageId: "page-2", error: "notionPage:Could not find page" });
  });

  it("stops publishing once the wiki is removed, and forgets its pages", async () => {
    const wiki = await prisma.wiki.findFirstOrThrow({ where: { workspaceId: f.workspaceId, kind: "notion" } });
    await deleteWiki(f.ctx.ws, wiki.id);
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: f.meetingId } })).wikiId).toBeNull();
    expect(await prisma.wikiPage.count({ where: { wikiId: wiki.id } })).toBe(0);
    const session = await prisma.session.findFirstOrThrow({ where: { meetingId: f.meetingId, status: "archived" } });
    expect(await publishSession(session.id)).toBeNull();
  });
});
