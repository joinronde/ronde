// The minutes as PDF: printed by the browser (its dialog saves a PDF), with the app's fonts. Every language
// comes out, Chinese, Hindi and Arabic right to left included, which a PDF library with its Latin fonts could not.
import { isMarkdownTableSeparator, listItemOf, markdownPlain, markdownTableCells } from "@ronde/core/markdown";

export type MinutesBlock =
  | { kind: "h1" | "h2" | "h3" | "p" | "strong"; text: string }
  | { kind: "li"; text: string; level: number; marker: string }
  | { kind: "table"; head: string[] | null; rows: string[][] };

/** The minutes' Markdown as blocks to lay out: titles, paragraphs, list items with their depth, tables */
export function minutesBlocks(md: string): MinutesBlock[] {
  const blocks: MinutesBlock[] = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith("|")) {
      // A table: its first row is a header when the separator follows it
      const rows: string[][] = [];
      let head: string[] | null = null;
      for (; i < lines.length && lines[i]!.trim().startsWith("|"); i++) {
        const row = lines[i]!.trim();
        if (isMarkdownTableSeparator(row)) {
          if (rows.length === 1 && !head) head = rows.pop()!;
          continue;
        }
        rows.push(markdownTableCells(row).map(markdownPlain));
      }
      i--;
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    const li = listItemOf(raw);
    if (l.startsWith("# ")) blocks.push({ kind: "h1", text: markdownPlain(l.slice(2)) });
    else if (l.startsWith("## ")) blocks.push({ kind: "h2", text: markdownPlain(l.slice(3)) });
    else if (l.startsWith("### ")) blocks.push({ kind: "h3", text: markdownPlain(l.slice(4)) });
    else if (li) blocks.push({ kind: "li", text: markdownPlain(li.text), level: li.level, marker: li.ordered ? li.marker : "•" });
    else blocks.push({ kind: /^\*\*.*\*\*$/.test(l) ? "strong" : "p", text: markdownPlain(l) });
  }
  return blocks;
}

/** The sheet printed: built with text nodes only, so nothing written in the minutes is ever read as HTML */
function sheet(blocks: MinutesBlock[], logo: string | null | undefined): HTMLElement {
  const root = document.createElement("div");
  root.className = "print-sheet";
  const el = (tag: string, text?: string, className?: string) => {
    const e = document.createElement(tag);
    // Each block reads in its own direction: English minutes stay left to right under an Arabic interface,
    // an Arabic line right to left in English minutes
    e.dir = "auto";
    if (text !== undefined) e.textContent = text;
    if (className) e.className = className;
    return e;
  };
  if (logo) {
    const img = el("img", undefined, "print-logo") as HTMLImageElement;
    img.src = logo;
    img.alt = "";
    root.append(img);
  }
  for (const b of blocks) {
    if (b.kind === "table") {
      const table = el("table");
      if (b.head) {
        const head = el("thead");
        const tr = el("tr");
        for (const c of b.head) tr.append(el("th", c));
        head.append(tr);
        table.append(head);
      }
      const body = el("tbody");
      for (const row of b.rows) {
        const tr = el("tr");
        for (const c of row) tr.append(el("td", c));
        body.append(tr);
      }
      table.append(body);
      root.append(table);
    } else if (b.kind === "li") {
      const p = el("p", undefined, "print-li");
      p.style.setProperty("--level", String(b.level));
      p.append(el("span", b.marker, "print-marker"), document.createTextNode(b.text));
      root.append(p);
    } else root.append(el(b.kind === "strong" ? "p" : b.kind, b.text, b.kind === "strong" ? "print-strong" : undefined));
  }
  return root;
}

/** Opens the print dialog on the minutes alone; the file name offered is the title */
export async function printMinutes(md: string, opts: { title: string; logo?: string | null }): Promise<void> {
  const root = sheet(minutesBlocks(md), opts.logo);
  // The logo drawn before the dialog takes its picture of the page
  const img = root.querySelector("img");
  if (img) await img.decode().catch(() => img.remove());
  const title = document.title;
  document.body.append(root);
  document.documentElement.dataset.printing = "";
  document.title = opts.title;
  window.addEventListener(
    "afterprint",
    () => {
      root.remove();
      delete document.documentElement.dataset.printing;
      document.title = title;
    },
    { once: true },
  );
  window.print();
}
