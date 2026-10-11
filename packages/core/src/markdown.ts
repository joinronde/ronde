// HTML rendering of the Markdown subset used by the minutes and the host notes:
// headings #, ##, ###, "- " or "1. " lists (nested with a 2-space indent), **bold**, *italic* or _italic_,
// ++underline++, ~~strikethrough~~, `code`, [links](https://…) and | tables. A backslash keeps the next mark
// character as it is (the notes editor writes \* for a star typed as text). All text is escaped.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A backslash before one of these keeps it literal: what would start a mark, a list, a heading or a table */
const ESCAPED = /\\([\\`*_~[\]()+#.|!-])/g;

/** Pieces set aside while the marks are read, then put back (code, escaped characters) */
function setAside() {
  const kept: string[] = [];
  return {
    keep: (v: string) => `\u0000${kept.push(v) - 1}\u0000`,
    restore: (s: string) => {
      let out = s;
      // A piece can hold another (an escaped character inside code): a few passes put everything back
      for (let i = 0; i < 3 && out.includes("\u0000"); i++) out = out.replace(/\u0000(\d+)\u0000/g, (_, n: string) => kept[Number(n)]!);
      return out;
    },
  };
}

const inline = (s: string) => {
  const { keep, restore } = setAside();
  return restore(
    esc(s)
      .replace(ESCAPED, (_, c: string) => keep(c))
      .replace(/`([^`]+)`/g, (_, c: string) => keep(`<code>${c}</code>`))
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\+\+(?=\S)(.+?)(?<=\S)\+\+/g, "<u>$1</u>")
      .replace(/(^|[\s(>])[*_](?=\S)(.+?)(?<=\S)[*_](?=$|[\s).,;:!?<])/g, "$1<em>$2</em>")
      .replace(/~~(.+?)~~/g, "<del>$1</del>"),
  );
};

const isSeparator = (l: string) => /^\|[\s|:-]+\|$/.test(l);
const cells = (r: string) =>
  r
    .replace(/^\||\|$/g, "")
    // An escaped bar belongs to the cell
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

/** List item: level (2 spaces per level), list type and text */
export function listItemOf(line: string): { level: number; ordered: boolean; marker: string; text: string } | null {
  const m = /^(\s*)([-*]|\d+[.)])\s+(.*)$/.exec(line);
  if (!m) return null;
  return { level: Math.floor(m[1]!.replace(/\t/g, "  ").length / 2), ordered: /\d/.test(m[2]!), marker: m[2]!, text: m[3]! };
}

export function markdownToHtml(md: string): string {
  const out: string[] = [];
  const lists: ("ul" | "ol")[] = [];
  let table: string[] = [];
  const closeLists = (depth: number) => {
    while (lists.length > depth) out.push(`</li></${lists.pop()}>`);
  };
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter((r) => !isSeparator(r)).map(cells);
    out.push(
      `<div class="tbl-wrap"><table>${rows
        .map((r, i) => `<tr>${r.map((c) => (i ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`)).join("")}</tr>`)
        .join("")}</table></div>`,
    );
    table = [];
  };
  for (const raw of md.split("\n")) {
    const l = raw.trimEnd();
    if (l.startsWith("|")) {
      closeLists(0);
      table.push(l);
      continue;
    }
    flushTable();
    const li = listItemOf(l);
    if (li) {
      // At most one level deeper than the current list
      const level = Math.min(li.level, lists.length);
      const tag = li.ordered ? "ol" : "ul";
      closeLists(level + 1);
      if (lists.length === level + 1) {
        if (lists[level] !== tag) closeLists(level);
        else out.push("</li>");
      }
      if (lists.length === level) {
        out.push(`<${tag}>`);
        lists.push(tag);
      }
      out.push(`<li>${inline(li.text)}`);
      continue;
    }
    closeLists(0);
    if (l.startsWith("### ")) out.push(`<h3>${inline(l.slice(4))}</h3>`);
    else if (l.startsWith("## ")) out.push(`<h2>${inline(l.slice(3))}</h2>`);
    else if (l.startsWith("# ")) out.push(`<h1>${inline(l.slice(2))}</h1>`);
    else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  closeLists(0);
  flushTable();
  return out.join("");
}

/** Plain text of a Markdown line (PDF export): formatting marks removed, links as "text (url)" */
export function markdownPlain(s: string): string {
  const { keep, restore } = setAside();
  return restore(
    s
      .replace(ESCAPED, (_, c: string) => keep(c))
      .replace(/`([^`]+)`/g, (_, c: string) => keep(c))
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\+\+(?=\S)(.+?)(?<=\S)\+\+/g, "$1")
      .replace(/(^|[\s(])[*_](?=\S)(.+?)(?<=\S)[*_](?=$|[\s).,;:!?])/g, "$1$2")
      .replace(/~~(.+?)~~/g, "$1"),
  );
}

/** HTML of a line of Markdown (bold, italic, code, links), text escaped */
export const inlineToHtml = inline;

export { cells as markdownTableCells, isSeparator as isMarkdownTableSeparator };
