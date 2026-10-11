import { markdownPlain, markdownToHtml } from "@ronde/core/markdown";
import { decisionsOf, noteLines } from "@ronde/core/minutes";
import { docToMarkdown, type RichNode } from "@ronde/core/rich-text";
import { describe, expect, it } from "vitest";

// The notes editor writes the Markdown that the minutes read: what is formatted on screen comes out the same

const text = (t: string, ...marks: (string | { type: string; attrs: Record<string, unknown> })[]): RichNode => ({
  type: "text",
  text: t,
  ...(marks.length ? { marks: marks.map((m) => (typeof m === "string" ? { type: m } : m)) } : {}),
});
const p = (...content: RichNode[]): RichNode => ({ type: "paragraph", content });
const doc = (...content: RichNode[]): RichNode => ({ type: "doc", content });
const li = (...content: RichNode[]): RichNode => ({ type: "listItem", content });

describe("docToMarkdown", () => {
  it("writes one line per paragraph, with the marks", () => {
    const md = docToMarkdown(
      doc(
        p(text("Plain, "), text("bold", "bold"), text(", "), text("italic", "italic"), text(" and "), text("under", "underline")),
        p(text("gone", "strike"), text(" with "), text("x = 1", "code")),
      ),
    );
    expect(md).toBe("Plain, **bold**, _italic_ and ++under++\n~~gone~~ with `x = 1`");
    expect(markdownToHtml(md)).toBe(
      "<p>Plain, <strong>bold</strong>, <em>italic</em> and <u>under</u></p><p><del>gone</del> with <code>x = 1</code></p>",
    );
  });

  it("nests marks and keeps their spaces outside the delimiters", () => {
    const md = docToMarkdown(doc(p(text("Go "), text("now ", "bold"), text("please", "bold", "italic"), text(" ok"))));
    expect(md).toBe("Go **now _please_** ok");
    expect(markdownToHtml(md)).toBe("<p>Go <strong>now <em>please</em></strong> ok</p>");
  });

  it("keeps characters typed as text from turning into formatting", () => {
    const md = docToMarkdown(doc(p(text("2 * 3 = 6, C++, file_name, _x_ and ~~y~~ [z]"))));
    expect(markdownToHtml(md)).toBe("<p>2 * 3 = 6, C++, file_name, _x_ and ~~y~~ [z]</p>");
    expect(markdownPlain(md)).toBe("2 * 3 = 6, C++, file_name, _x_ and ~~y~~ [z]");
  });

  it("keeps a paragraph that looks like a list, a heading or a table as a paragraph", () => {
    const md = docToMarkdown(doc(p(text("- not a bullet")), p(text("1. not a number")), p(text("# not a title")), p(text("| a |"))));
    expect(markdownToHtml(md)).toBe("<p>- not a bullet</p><p>1. not a number</p><p># not a title</p><p>| a |</p>");
  });

  it("writes links, and only web ones", () => {
    const md = docToMarkdown(
      doc(
        p(
          text("See "),
          text("the doc", { type: "link", attrs: { href: "https://example.com/a_(b)" } }),
          text(" or "),
          text("this", { type: "link", attrs: { href: "javascript:alert(1)" } }),
        ),
      ),
    );
    expect(md).toBe("See [the doc](https://example.com/a_(b%29) or this");
    expect(markdownToHtml(md)).toContain('<a href="https://example.com/a_(b%29" target="_blank" rel="noopener">the doc</a>');
  });

  it("indents sub-lists and numbers ordered lists", () => {
    const md = docToMarkdown(
      doc(
        {
          type: "bulletList",
          content: [li(p(text("a")), { type: "orderedList", content: [li(p(text("one"))), li(p(text("two")))] }), li(p(text("b")))],
        },
        { type: "orderedList", attrs: { start: 3 }, content: [li(p(text("three")))] },
      ),
    );
    expect(md).toBe("- a\n  1. one\n  2. two\n- b\n3. three");
    expect(markdownToHtml(md)).toBe("<ul><li>a<ol><li>one</li><li>two</li></ol></li><li>b</li></ul><ol><li>three</li></ol>");
  });

  it("writes headings and tables, with bars in cells kept", () => {
    const cell = (t: string, type = "tableCell"): RichNode => ({ type, content: [p(text(t))] });
    const md = docToMarkdown(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [text("Plan")] },
        {
          type: "table",
          content: [
            { type: "tableRow", content: [cell("Who", "tableHeader"), cell("What", "tableHeader")] },
            { type: "tableRow", content: [cell("Ana"), cell("a | b")] },
          ],
        },
      ),
    );
    expect(md).toBe("## Plan\n| Who | What |\n| --- | --- |\n| Ana | a \\| b |");
    expect(markdownToHtml(md)).toContain("<td>a | b</td>");
  });

  it("keeps decisions and note bullets readable by the minutes", () => {
    const md = docToMarkdown(doc(p(text("Decision:", "bold"), text(" ship it")), p(), p(text("Then the demo"))));
    expect(md).toBe("**Decision:** ship it\n\nThen the demo");
    expect(decisionsOf(md)).toEqual(["ship it"]);
    expect(noteLines(md)).toEqual(["- **Decision:** ship it", "- Then the demo"]);
  });

  it("turns a line break into a space and drops trailing empty lines", () => {
    expect(docToMarkdown(doc(p(text("a"), { type: "hardBreak" }, text("b")), p(), p()))).toBe("a b");
  });
});

describe("markdown read back into the editor", () => {
  it("renders underline, escapes and italic with underscores", () => {
    expect(markdownToHtml("++under++ and _it_ and \\*star\\*")).toBe("<p><u>under</u> and <em>it</em> and *star*</p>");
    expect(markdownPlain("++under++ \\_x\\_")).toBe("under _x_");
  });
});
