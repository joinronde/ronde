import { describe, expect, it } from "vitest";
import { minutesBlocks } from "@/components/print-minutes";

// The minutes laid out for printing (and saving as PDF): every script kept, titles, lists and tables

describe("minutesBlocks", () => {
  it("keeps every language's text as it is", () => {
    const blocks = minutesBlocks("# 周会 · 2026-10-12\n## 进展\n- 完成了 **登录**\n## المحضر\nتمت مراجعة الخطة\n## कार्यवृत्त\nसब ठीक है");
    expect(blocks).toEqual([
      { kind: "h1", text: "周会 · 2026-10-12" },
      { kind: "h2", text: "进展" },
      { kind: "li", text: "完成了 登录", level: 0, marker: "•" },
      { kind: "h2", text: "المحضر" },
      { kind: "p", text: "تمت مراجعة الخطة" },
      { kind: "h2", text: "कार्यवृत्त" },
      { kind: "p", text: "सब ठीक है" },
    ]);
  });

  it("lays out nested and numbered lists, bold lines and tables with their header", () => {
    const md = [
      "**Decisions**",
      "1. Ship on Friday",
      "   - after the review",
      "| Who | What |",
      "| --- | --- |",
      "| Ana | Tests |",
      "| Ben | Docs |",
      "Plain text with <b>tags</b> stays text",
    ].join("\n");
    expect(minutesBlocks(md)).toEqual([
      { kind: "strong", text: "Decisions" },
      { kind: "li", text: "Ship on Friday", level: 0, marker: "1." },
      { kind: "li", text: "after the review", level: 1, marker: "•" },
      {
        kind: "table",
        head: ["Who", "What"],
        rows: [
          ["Ana", "Tests"],
          ["Ben", "Docs"],
        ],
      },
      { kind: "p", text: "Plain text with <b>tags</b> stays text" },
    ]);
  });
});
