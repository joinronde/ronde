// The notes editor's document (ProseMirror JSON, as Tiptap gives it) written back as the Markdown subset that
// markdown.ts renders: one line per paragraph (a line of notes is a bullet of the minutes), lists indented by
// two spaces, **bold**, _italic_, ++underline++, ~~strikethrough~~, `code`, [links](https://…) and tables.
// Characters that would read as formatting are escaped with a backslash.

export interface RichMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface RichNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichNode[];
  text?: string;
  marks?: RichMark[];
}

/** Marks from the outside in: a link holds the others, code holds nothing */
const ORDER = ["link", "bold", "italic", "underline", "strike", "code"];
const DELIMITERS: Record<string, string> = { bold: "**", italic: "_", underline: "++", strike: "~~", code: "`" };

const isWord = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

/** Text as typed, with what would read as formatting escaped */
function escapeText(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    const next = s[i + 1];
    if (c === "\\" || c === "`" || c === "*" || c === "[" || c === "]") out += `\\${c}`;
    // Inside a word an underscore is just one (snake_case); at its edge it could open or close italic
    else if (c === "_") out += isWord(s[i - 1]) && isWord(next) ? c : "\\_";
    else if ((c === "~" && (next === "~" || s[i - 1] === "~")) || (c === "+" && (next === "+" || s[i - 1] === "+"))) out += `\\${c}`;
    else out += c;
  }
  return out;
}

const keyOf = (m: RichMark) => (m.type === "link" ? `link:${String(m.attrs?.href ?? "")}` : m.type);
const safeHref = (m: RichMark) => {
  const href = String(m.attrs?.href ?? "");
  return /^https?:\/\/\S+$/.test(href) ? href.replace(/\)/g, "%29") : null;
};
const opener = (m: RichMark) => (m.type === "link" ? (safeHref(m) ? "[" : "") : DELIMITERS[m.type]!);
const closer = (m: RichMark) => {
  if (m.type !== "link") return DELIMITERS[m.type]!;
  const href = safeHref(m);
  return href ? `](${href})` : "";
};

/** A run of text with its marks, delimiters opened and closed around the whitespace, never inside it */
function inlineOf(nodes: RichNode[] | undefined, table = false): string {
  let out = "";
  let open: RichMark[] = [];
  // Spaces at the end of a marked run wait: they go after the closing delimiters
  let pending = "";
  const closeTo = (n: number) => {
    for (let i = open.length - 1; i >= n; i--) out += closer(open[i]!);
    open = open.slice(0, n);
  };
  for (const node of nodes ?? []) {
    // One line per paragraph: a line break inside one becomes a space
    const text = node.type === "hardBreak" ? " " : node.type === "text" ? (node.text ?? "") : "";
    if (!text) continue;
    const marks = (node.marks ?? []).filter((m) => ORDER.includes(m.type)).sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
    const lead = text.match(/^\s*/)![0];
    const trail = text.slice(lead.length).match(/\s*$/)![0];
    const core = text.slice(lead.length, text.length - trail.length);
    // Whitespace alone keeps the marks as they are
    if (!core) {
      pending += text;
      continue;
    }
    let same = 0;
    while (same < open.length && same < marks.length && keyOf(open[same]!) === keyOf(marks[same]!)) same++;
    if (same < open.length) closeTo(same);
    out += pending + lead;
    pending = "";
    for (const m of marks.slice(same)) out += opener(m);
    open = marks;
    const code = marks.some((m) => m.type === "code");
    let body = code ? core.replace(/`/g, "'") : escapeText(core);
    if (table) body = body.replace(/\|/g, "\\|");
    out += body;
    pending = trail;
  }
  closeTo(0);
  return out + pending;
}

/** A paragraph that would read as a list, a heading or a table keeps its first character literal */
function literalStart(line: string): string {
  const list = /^(\s*)([-+]|\d+[.)])(\s)/.exec(line);
  if (list) {
    const [, indent, marker, space] = list;
    const escaped = /\d/.test(marker!) ? `${marker!.slice(0, -1)}\\${marker!.slice(-1)}` : `\\${marker}`;
    return indent + escaped + space + line.slice(list[0].length);
  }
  if (/^#{1,6}\s/.test(line) || line.startsWith("|")) return `\\${line}`;
  return line;
}

const textOf = (node: RichNode): string => (node.text ?? "") + (node.content ?? []).map(textOf).join(" ");

function listLines(list: RichNode, level: number): string[] {
  const ordered = list.type === "orderedList";
  const start = Number(list.attrs?.start ?? 1) || 1;
  const lines: string[] = [];
  (list.content ?? []).forEach((item, i) => {
    const marker = ordered ? `${start + i}.` : "-";
    // The item's text, then its sub-lists; further paragraphs of the item join its line
    const texts: string[] = [];
    const subs: string[] = [];
    for (const child of item.content ?? []) {
      if (child.type === "bulletList" || child.type === "orderedList") subs.push(...listLines(child, level + 1));
      else if (child.type === "paragraph" || child.type === "heading") texts.push(inlineOf(child.content));
      else texts.push(escapeText(textOf(child)));
    }
    lines.push(`${"  ".repeat(level)}${marker} ${texts.filter(Boolean).join(" ")}`.trimEnd(), ...subs);
  });
  return lines;
}

function tableLines(table: RichNode): string[] {
  const rows = (table.content ?? []).map((row) =>
    (row.content ?? []).map((cell) =>
      (cell.content ?? [])
        .map((p) => inlineOf(p.content, true))
        .filter(Boolean)
        .join(" "),
    ),
  );
  if (!rows.length) return [];
  const width = Math.max(...rows.map((r) => r.length));
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
  return [line(rows[0]!), line(Array.from({ length: width }, () => "---")), ...rows.slice(1).map(line)];
}

/** The editor's document as Markdown: what the minutes, the PDF and the emails read */
export function docToMarkdown(doc: RichNode): string {
  const lines: string[] = [];
  for (const node of doc.content ?? []) {
    if (node.type === "paragraph") lines.push(literalStart(inlineOf(node.content)));
    else if (node.type === "heading") {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 3);
      lines.push(`${"#".repeat(level)} ${inlineOf(node.content)}`.trimEnd());
    } else if (node.type === "bulletList" || node.type === "orderedList") lines.push(...listLines(node, 0));
    else if (node.type === "table") lines.push(...tableLines(node));
    else if (node.content || node.text) lines.push(literalStart(escapeText(textOf(node))));
  }
  // Empty lines at the end are the editor's, not the person's
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  return lines.join("\n");
}
