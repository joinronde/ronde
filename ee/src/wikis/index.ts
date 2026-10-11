// SPDX-License-Identifier: LicenseRef-Ronde-EE
// Copyright (c) Ronde. Use requires a valid Ronde license key: see ee/LICENSE.

import { markdownToHtml } from "@ronde/core/markdown";
import type { EnterpriseEdition, WikiAccess, WikiDoc, WikiErrorCode, WikiPageRef } from "@ronde/editions/ee";
import { markdownToBlocks, type NotionBlock } from "./notion-blocks";

// Minutes published as wiki pages: under a Notion page shared with an integration, or in a Confluence space
// (Cloud, or Data Center / Server on the organization's own network)

/** A refusal of the wiki: its code says what to fix, the detail what the wiki said */
export class WikiError extends Error {
  constructor(
    readonly code: WikiErrorCode,
    readonly detail = "",
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

const NOTION = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
/** Blocks Notion takes in one request */
const NOTION_BATCH = 100;

const trim = (url: string) => url.trim().replace(/\/+$/, "");

/** The id of a Notion page, from its id or its address ("…/Weekly-notes-1a2b…") */
export function notionPageId(value: string): string | null {
  const hex = /([0-9a-f]{32})(?:[?#].*)?$/i.exec(value.replace(/-/g, "").trim())?.[1];
  if (!hex) return null;
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The id of a Confluence page, from its id or its address ("…/pages/123456/Title", "…?pageId=123456") */
export const confluencePageId = (value: string) => /(?:^|\/pages\/|pageId=)(\d+)/.exec(value.trim())?.[1] ?? null;

/** Confluence Cloud lives on atlassian.net; anything else is a Data Center or Server of the organization */
const isCloud = (site: string) => {
  try {
    return new URL(site).hostname.endsWith(".atlassian.net");
  } catch {
    return false;
  }
};

async function request(w: WikiAccess, url: string, init: RequestInit & { json?: unknown } = {}): Promise<unknown> {
  const { json, ...rest } = init;
  for (let attempt = 0; ; attempt++) {
    const res = await (w.fetch ?? fetch)(url, {
      ...rest,
      headers: { accept: "application/json", ...(json ? { "content-type": "application/json" } : {}), ...auth(w), ...(rest.headers ?? {}) },
      ...(json ? { body: JSON.stringify(json) } : {}),
      signal: AbortSignal.timeout(30_000),
    }).catch((e: unknown) => {
      throw new WikiError("network", e instanceof Error ? e.message : String(e));
    });
    // Too many requests: wait as asked (a few seconds at most), twice
    if (res.status === 429 && attempt < 2) {
      const wait = Math.min(10, Number(res.headers.get("retry-after")) || 1);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (res.ok) return res.status === 204 ? null : res.json();
    const body = (await res.json().catch(() => null)) as { message?: string; errors?: { title?: string }[] } | null;
    const said = body?.message ?? body?.errors?.[0]?.title ?? "";
    if (res.status === 401 || res.status === 403) throw new WikiError("token", String(res.status));
    if (res.status === 404) throw new WikiError(w.kind === "notion" ? "notionPage" : "confluenceSpace", said);
    throw new WikiError("answer", `${res.status}${said ? ` ${said}` : ""}`);
  }
}

function auth(w: WikiAccess): Record<string, string> {
  if (w.kind === "notion") return { authorization: `Bearer ${w.token}`, "notion-version": NOTION_VERSION };
  // Confluence Cloud: the account's email and an API token; Data Center: a personal access token
  return isCloud(w.config.site ?? "")
    ? { authorization: `Basic ${Buffer.from(`${w.config.email ?? ""}:${w.token}`).toString("base64")}` }
    : { authorization: `Bearer ${w.token}` };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// ---------- Notion ----------

async function notionPublish(w: WikiAccess, doc: WikiDoc, previous?: WikiPageRef | null): Promise<WikiPageRef> {
  const parent = notionPageId(w.config.parent ?? "");
  if (!parent) throw new WikiError("notionParent");
  // The minutes, then a line and the way back to the meeting in Ronde
  const blocks: NotionBlock[] = [
    ...markdownToBlocks(doc.markdown),
    ...(doc.link
      ? [
          { object: "block" as const, type: "divider", divider: {} },
          {
            object: "block" as const,
            type: "paragraph",
            paragraph: { rich_text: [{ type: "text", text: { content: doc.link.label, link: { url: doc.link.url } } }] },
          },
        ]
      : []),
  ];
  const page = (await request(w, `${NOTION}/pages`, {
    method: "POST",
    json: {
      parent: { page_id: parent },
      icon: { type: "emoji", emoji: "📝" },
      properties: { title: { title: [{ type: "text", text: { content: doc.title.slice(0, 2000) } }] } },
      children: blocks.slice(0, NOTION_BATCH),
    },
  })) as { id: string; url: string };
  for (let i = NOTION_BATCH; i < blocks.length; i += NOTION_BATCH)
    await request(w, `${NOTION}/blocks/${page.id}/children`, { method: "PATCH", json: { children: blocks.slice(i, i + NOTION_BATCH) } });
  // The new version replaces the page of the earlier one, which goes to Notion's trash (restorable there)
  if (previous?.id)
    await request(w, `${NOTION}/pages/${previous.id}`, { method: "PATCH", json: { archived: true } }).catch(() => undefined);
  return { id: page.id, url: page.url };
}

async function notionTest(w: WikiAccess) {
  const parent = notionPageId(w.config.parent ?? "");
  if (!parent) throw new WikiError("notionParent");
  await request(w, `${NOTION}/pages/${parent}`);
}

// ---------- Confluence ----------

/** Confluence keeps pages as XHTML ("storage"): the minutes' HTML, its tables without their wrapper, then the way back */
const storage = (doc: WikiDoc) =>
  markdownToHtml(doc.markdown)
    .replace(/<div class="tbl-wrap">(.*?)<\/div>/g, "$1")
    .replace(/ target="_blank" rel="noopener"/g, "") +
  (doc.link ? `<hr /><p><a href="${esc(doc.link.url)}">${esc(doc.link.label)}</a></p>` : "");

interface ConfluencePage {
  id: string;
  version?: { number: number };
  _links?: { webui?: string; base?: string };
}

async function confluencePublish(w: WikiAccess, doc: WikiDoc, previous?: WikiPageRef | null): Promise<WikiPageRef> {
  const site = trim(w.config.site ?? "");
  const space = w.config.space ?? "";
  const parentId = confluencePageId(w.config.parent ?? "");
  const value = storage(doc);
  const urlOf = (p: ConfluencePage, base: string) => `${p._links?.base ?? base}${p._links?.webui ?? ""}`;
  if (isCloud(site)) {
    const api = `${new URL(site).origin}/wiki/api/v2`;
    const body = { status: "current", title: doc.title, body: { representation: "storage", value } };
    if (previous?.id) {
      const current = (await request(w, `${api}/pages/${previous.id}`).catch(() => null)) as ConfluencePage | null;
      if (current) {
        const p = (await request(w, `${api}/pages/${previous.id}`, {
          method: "PUT",
          json: { id: previous.id, ...body, version: { number: (current.version?.number ?? 1) + 1 } },
        })) as ConfluencePage;
        return { id: p.id, url: urlOf(p, `${new URL(site).origin}/wiki`) };
      }
    }
    const spaces = (await request(w, `${api}/spaces?keys=${encodeURIComponent(space)}`)) as { results: { id: string }[] };
    const spaceId = spaces.results[0]?.id;
    if (!spaceId) throw new WikiError("confluenceSpace", space);
    const p = (await request(w, `${api}/pages`, {
      method: "POST",
      json: { spaceId, ...body, ...(parentId ? { parentId } : {}) },
    })) as ConfluencePage;
    return { id: p.id, url: urlOf(p, `${new URL(site).origin}/wiki`) };
  }
  // Data Center and Server: the REST API of their own version
  const api = `${site}/rest/api/content`;
  const body = { type: "page", title: doc.title, space: { key: space }, body: { storage: { value, representation: "storage" } } };
  if (previous?.id) {
    const current = (await request(w, `${api}/${previous.id}?expand=version`).catch(() => null)) as ConfluencePage | null;
    if (current) {
      const p = (await request(w, `${api}/${previous.id}`, {
        method: "PUT",
        json: { id: previous.id, ...body, version: { number: (current.version?.number ?? 1) + 1 } },
      })) as ConfluencePage;
      return { id: p.id, url: urlOf(p, site) };
    }
  }
  const p = (await request(w, api, {
    method: "POST",
    json: { ...body, ...(parentId ? { ancestors: [{ id: parentId }] } : {}) },
  })) as ConfluencePage;
  return { id: p.id, url: urlOf(p, site) };
}

async function confluenceTest(w: WikiAccess) {
  const site = trim(w.config.site ?? "");
  const space = encodeURIComponent(w.config.space ?? "");
  if (isCloud(site)) {
    const spaces = (await request(w, `${new URL(site).origin}/wiki/api/v2/spaces?keys=${space}`)) as { results: unknown[] };
    if (!spaces.results.length) throw new WikiError("confluenceSpace", w.config.space ?? "");
  } else await request(w, `${site}/rest/api/space/${space}`);
}

// ---------- Both ----------

export async function publish(w: WikiAccess, doc: WikiDoc, previous?: WikiPageRef | null): Promise<WikiPageRef> {
  return w.kind === "notion" ? notionPublish(w, doc, previous) : confluencePublish(w, doc, previous);
}

export async function test(w: WikiAccess): Promise<{ ok: true } | { ok: false; code: WikiErrorCode; detail: string }> {
  try {
    await (w.kind === "notion" ? notionTest(w) : confluenceTest(w));
    return { ok: true };
  } catch (e) {
    return e instanceof WikiError ? { ok: false, code: e.code, detail: e.detail } : { ok: false, code: "answer", detail: String(e) };
  }
}

export const wikis: EnterpriseEdition["wikis"] = { publish, test };
