// SPDX-License-Identifier: LicenseRef-Ronde-EE
// Copyright (c) Ronde. Use requires a valid Ronde license key: see ee/LICENSE.

import { isMarkdownTableSeparator, listItemOf, markdownTableCells } from "@ronde/core/markdown";

// The Markdown of the minutes as Notion blocks: headings, paragraphs, lists (ticked items as to-dos), tables,
// with bold, italic, underline, strikethrough, code and links kept

export interface RichText {
  type: "text";
  text: { content: string; link: { url: string } | null };
  annotations?: Partial<Record<"bold" | "italic" | "strikethrough" | "underline" | "code", boolean>>;
}

export interface NotionBlock {
  object: "block";
  type: string;
  [kind: string]: unknown;
}

type Marks = NonNullable<RichText["annotations"]>;

/** What Notion takes in one text object, and in one block */
const MAX_TEXT = 2000;
const MAX_RICH = 100;

/** The marks of a line, the earliest found wins: an escaped character (kept as it is), code, a link, then styles */
const MARKS: { re: RegExp; kind: "escape" | "code" | "link" | keyof Marks }[] = [
  { re: /\\([\\`*_~[\]()+#.|!-])/, kind: "escape" },
  { re: /`([^`]+)`/, kind: "code" },
  { re: /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/, kind: "link" },
  { re: /\*\*(.+?)\*\*/, kind: "bold" },
  { re: /\+\+(?=\S)(.+?)(?<=\S)\+\+/, kind: "underline" },
  { re: /~~(.+?)~~/, kind: "strikethrough" },
  { re: /(?<=^|[\s(])[*_](?=\S)(.+?)(?<=\S)[*_](?=$|[\s).,;:!?])/, kind: "italic" },
];

/** Text objects of a line of Markdown, its marks as annotations */
export function richText(md: string, marks: Marks = {}, link: string | null = null): RichText[] {
  const text = (content: string, extra: Marks = {}): RichText[] => {
    const annotations = { ...marks, ...extra };
    const parts: RichText[] = [];
    for (let i = 0; i < content.length; i += MAX_TEXT)
      parts.push({
        type: "text",
        text: { content: content.slice(i, i + MAX_TEXT), link: link ? { url: link } : null },
        ...(Object.keys(annotations).length ? { annotations } : {}),
      });
    return parts;
  };
  const out: RichText[] = [];
  let rest = md;
  while (rest) {
    let first: { at: number; length: number; kind: (typeof MARKS)[number]["kind"]; groups: string[] } | null = null;
    for (const m of MARKS) {
      const found = m.re.exec(rest);
      if (found && (!first || found.index < first.at))
        first = { at: found.index, length: found[0].length, kind: m.kind, groups: found.slice(1) as string[] };
    }
    if (!first) {
      out.push(...text(rest));
      break;
    }
    if (first.at) out.push(...text(rest.slice(0, first.at)));
    const [inner = "", url = ""] = first.groups;
    if (first.kind === "escape") out.push(...text(inner));
    else if (first.kind === "code") out.push(...text(inner, { code: true }));
    else if (first.kind === "link") out.push(...richText(inner, marks, url));
    else out.push(...richText(inner, { ...marks, [first.kind]: true }, link));
    rest = rest.slice(first.at + first.length);
  }
  return out;
}

const rich = (md: string) => richText(md).slice(0, MAX_RICH);

const block = (type: string, body: Record<string, unknown>): NotionBlock => ({ object: "block", type, [type]: body });

/** A list item: ticked or not ("☑ ", "☐ ") becomes a to-do */
function listBlock(text: string, ordered: boolean): NotionBlock {
  const todo = /^([☑☐])\s?(.*)$/u.exec(text);
  if (todo) return block("to_do", { rich_text: rich(todo[2]!), checked: todo[1] === "☑" });
  return block(ordered ? "numbered_list_item" : "bulleted_list_item", { rich_text: rich(text) });
}

function tableBlock(lines: string[]): NotionBlock {
  const rows = lines.filter((l) => !isMarkdownTableSeparator(l)).map(markdownTableCells);
  const width = Math.max(1, ...rows.map((r) => r.length));
  return block("table", {
    table_width: width,
    has_column_header: true,
    has_row_header: false,
    children: rows.map((r) => block("table_row", { cells: Array.from({ length: width }, (_, i) => rich(r[i] ?? "")) })),
  });
}

/**
 * Blocks of a Markdown text. Notion takes two levels of blocks in one request: a list item deeper than its
 * parent's children joins them, in its order.
 */
export function markdownToBlocks(md: string): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  let table: string[] = [];
  /** The last top-level list item, which deeper items go under */
  let parent: NotionBlock | null = null;
  const flushTable = () => {
    if (table.length) blocks.push(tableBlock(table));
    table = [];
  };
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("|")) {
      parent = null;
      table.push(line);
      continue;
    }
    flushTable();
    const li = listItemOf(line);
    if (li) {
      const item = listBlock(li.text, li.ordered);
      if (li.level > 0 && parent) {
        const body = parent[parent.type] as { children?: NotionBlock[] };
        body.children = [...(body.children ?? []), item];
      } else {
        blocks.push(item);
        parent = item;
      }
      continue;
    }
    parent = null;
    if (!line.trim()) continue;
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (heading) blocks.push(block(`heading_${heading[1]!.length}`, { rich_text: rich(heading[2]!) }));
    else blocks.push(block("paragraph", { rich_text: rich(line) }));
  }
  flushTable();
  return blocks;
}
