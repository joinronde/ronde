import type { WikiAccess } from "@ronde/editions/ee";
import { describe, expect, it } from "vitest";
import { test as check, confluencePageId, notionPageId, publish } from "../src/wikis";
import { markdownToBlocks, richText } from "../src/wikis/notion-blocks";

// Minutes published as wiki pages: what Notion and Confluence receive, the page of an earlier publication
// replaced, and what an administrator reads when the wiki refuses

type Call = { url: string; init: RequestInit };
const fake = (answers: (unknown | { status: number; body?: unknown; headers?: Record<string, string> })[]) => {
  const calls: Call[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const a = answers[calls.length - 1] as { status?: number; body?: unknown; headers?: Record<string, string> } | undefined;
    if (a && typeof a.status === "number") return new Response(JSON.stringify(a.body ?? {}), { status: a.status, headers: a.headers });
    return new Response(JSON.stringify(a ?? {}), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
};
const body = (c: Call) => JSON.parse(String(c.init.body)) as Record<string, unknown>;
const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

const doc = {
  title: "Weekly sync · October 5, 2026",
  markdown: "Tuesday 10:00 · 25 min\n\n## Decisions\n- Ship on **Friday**\n\n## Actions\n- ☐ Book a room\n- ☑ Send the invite",
  link: { label: "Open in Ronde", url: "https://app.example.com/w/acme/m/1/history" },
};

describe("minutes as Notion blocks", () => {
  it("keeps headings, lists, to-dos and tables, and nests deeper items under their parent", () => {
    const blocks = markdownToBlocks(
      "## Round table\n- Alice: shipped the API\n  - docs too\n    - and examples\n1. First\n- ☑ Done\n- ☐ Open\n| Who | Time |\n|---|---|\n| Alice | 2:05 |\nA closing line",
    );
    expect(blocks.map((b) => b.type)).toEqual([
      "heading_2",
      "bulleted_list_item",
      "numbered_list_item",
      "to_do",
      "to_do",
      "table",
      "paragraph",
    ]);
    // Notion takes two levels of blocks at once: the third level joins the second
    const nested = (blocks[1]!.bulleted_list_item as { children: { type: string }[] }).children;
    expect(nested).toHaveLength(2);
    expect(blocks[3]!.to_do).toMatchObject({ checked: true, rich_text: [{ text: { content: "Done" } }] });
    expect(blocks[4]!.to_do).toMatchObject({ checked: false });
    const table = blocks[5]!.table as { table_width: number; children: { table_row: { cells: { text: { content: string } }[][] } }[] };
    expect(table.table_width).toBe(2);
    expect(table.children.map((r) => r.table_row.cells.map((c) => c[0]!.text.content))).toEqual([
      ["Who", "Time"],
      ["Alice", "2:05"],
    ]);
  });

  it("turns marks into annotations, links into links, and keeps escaped characters", () => {
    expect(richText("Ship **on _Friday_** with `npm`, see [the plan](https://x.test/p) \\*not bold\\*")).toEqual([
      { type: "text", text: { content: "Ship ", link: null } },
      { type: "text", text: { content: "on ", link: null }, annotations: { bold: true } },
      { type: "text", text: { content: "Friday", link: null }, annotations: { bold: true, italic: true } },
      { type: "text", text: { content: " with ", link: null } },
      { type: "text", text: { content: "npm", link: null }, annotations: { code: true } },
      { type: "text", text: { content: ", see ", link: null } },
      { type: "text", text: { content: "the plan", link: { url: "https://x.test/p" } } },
      { type: "text", text: { content: " ", link: null } },
      { type: "text", text: { content: "*", link: null } },
      { type: "text", text: { content: "not bold", link: null } },
      { type: "text", text: { content: "*", link: null } },
    ]);
    // Notion takes 2,000 characters in a text object
    expect(richText("a".repeat(4500)).map((r) => r.text.content.length)).toEqual([2000, 2000, 500]);
  });
});

describe("Notion", () => {
  const notion = (fetch: typeof globalThis.fetch): WikiAccess => ({
    kind: "notion",
    config: { parent: "https://www.notion.so/acme/Team-meetings-1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6?pvs=4" },
    token: "ntn_secret",
    fetch,
  });

  it("creates the page under the shared page, then adds what one request cannot hold", async () => {
    const long = { ...doc, markdown: Array.from({ length: 130 }, (_, i) => `- item ${i}`).join("\n") };
    const f = fake([{ id: "p1", url: "https://www.notion.so/p1" }, {}]);
    expect(await publish(notion(f.fetch), long)).toEqual({ id: "p1", url: "https://www.notion.so/p1" });
    expect(f.calls[0]!.url).toBe("https://api.notion.com/v1/pages");
    expect(header(f.calls[0]!, "authorization")).toBe("Bearer ntn_secret");
    expect(header(f.calls[0]!, "notion-version")).toBe("2022-06-28");
    const created = body(f.calls[0]!);
    expect(created.parent).toEqual({ page_id: "1a2b3c4d-5e6f-47a8-b9c0-d1e2f3a4b5c6" });
    expect(created.properties).toEqual({ title: { title: [{ type: "text", text: { content: long.title } }] } });
    expect(created.children).toHaveLength(100);
    // 130 items, a line and the way back to Ronde: 32 more blocks
    expect(f.calls[1]!.url).toBe("https://api.notion.com/v1/blocks/p1/children");
    expect(f.calls[1]!.init.method).toBe("PATCH");
    expect((body(f.calls[1]!).children as unknown[]).length).toBe(32);
  });

  it("puts the earlier version in the trash once the new one exists", async () => {
    const f = fake([{ id: "p2", url: "https://www.notion.so/p2" }, {}]);
    await publish(notion(f.fetch), doc, { id: "p1", url: "https://www.notion.so/p1" });
    expect(f.calls[1]!.url).toBe("https://api.notion.com/v1/pages/p1");
    expect(body(f.calls[1]!)).toEqual({ archived: true });
  });

  it("says what to do when the page is not shared with the integration", async () => {
    const f = fake([{ status: 404, body: { object: "error", code: "object_not_found", message: "Could not find page" } }]);
    expect(await check(notion(f.fetch))).toEqual({ ok: false, code: "notionPage", detail: "Could not find page" });
    expect(notionPageId("not a page")).toBeNull();
  });

  it("waits when Notion asks to slow down, then goes on", async () => {
    const f = fake([{ status: 429, headers: { "retry-after": "0" } }, {}]);
    expect(await check(notion(f.fetch))).toEqual({ ok: true });
    expect(f.calls).toHaveLength(2);
  });
});

describe("Confluence", () => {
  it("creates the page in a Cloud space, under its parent page", async () => {
    const f = fake([
      { results: [{ id: "98304" }] },
      { id: "4521", _links: { base: "https://acme.atlassian.net/wiki", webui: "/spaces/ENG/pages/4521" } },
    ]);
    const w: WikiAccess = {
      kind: "confluence",
      config: {
        site: "https://acme.atlassian.net/wiki/spaces/ENG",
        space: "ENG",
        parent: "https://acme.atlassian.net/wiki/spaces/ENG/pages/1200/Meetings",
        email: "bot@acme.com",
      },
      token: "atl_token",
      fetch: f.fetch,
    };
    expect(await publish(w, doc)).toEqual({ id: "4521", url: "https://acme.atlassian.net/wiki/spaces/ENG/pages/4521" });
    expect(f.calls[0]!.url).toBe("https://acme.atlassian.net/wiki/api/v2/spaces?keys=ENG");
    expect(header(f.calls[0]!, "authorization")).toBe(`Basic ${Buffer.from("bot@acme.com:atl_token").toString("base64")}`);
    const created = body(f.calls[1]!) as {
      spaceId: string;
      parentId: string;
      title: string;
      body: { representation: string; value: string };
    };
    expect(created).toMatchObject({ spaceId: "98304", parentId: "1200", title: doc.title, status: "current" });
    expect(created.body.representation).toBe("storage");
    expect(created.body.value).toContain("<h2>Decisions</h2><ul><li>Ship on <strong>Friday</strong></li></ul>");
    expect(created.body.value).toContain('<hr /><p><a href="https://app.example.com/w/acme/m/1/history">Open in Ronde</a></p>');
  });

  it("updates the page of an earlier publication, one version up", async () => {
    const f = fake([
      { id: "4521", version: { number: 3 } },
      { id: "4521", _links: { webui: "/spaces/ENG/pages/4521" } },
    ]);
    const w: WikiAccess = {
      kind: "confluence",
      config: { site: "https://acme.atlassian.net", space: "ENG", email: "bot@acme.com" },
      token: "t",
      fetch: f.fetch,
    };
    const ref = await publish(w, doc, { id: "4521", url: "" });
    expect(f.calls[1]!.init.method).toBe("PUT");
    expect(body(f.calls[1]!)).toMatchObject({ id: "4521", version: { number: 4 } });
    expect(ref.url).toBe("https://acme.atlassian.net/wiki/spaces/ENG/pages/4521");
  });

  it("uses the REST API of a Data Center with a personal access token", async () => {
    const f = fake([{ id: "77", _links: { base: "https://wiki.acme.internal", webui: "/display/ENG/Weekly" } }]);
    const w: WikiAccess = {
      kind: "confluence",
      config: { site: "https://wiki.acme.internal/", space: "ENG", parent: "pageId=55" },
      token: "pat",
      fetch: f.fetch,
    };
    expect(await publish(w, doc)).toEqual({ id: "77", url: "https://wiki.acme.internal/display/ENG/Weekly" });
    expect(f.calls[0]!.url).toBe("https://wiki.acme.internal/rest/api/content");
    expect(header(f.calls[0]!, "authorization")).toBe("Bearer pat");
    expect(body(f.calls[0]!)).toMatchObject({ type: "page", space: { key: "ENG" }, ancestors: [{ id: "55" }] });
    expect(confluencePageId("https://wiki.acme.internal/pages/viewpage.action?pageId=55")).toBe("55");
  });
});
