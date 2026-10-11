import { parseReply, REPLY_ITEMS_MAX, type ReplySection } from "@ronde/core/reply";
import { describe, expect, it } from "vitest";

const fr: ReplySection[] = [
  { key: "done", label: "Fait cette semaine", input: "list" },
  { key: "next", label: "Prévu semaine prochaine", input: "list" },
  { key: "blockers", label: "Difficultés à signaler", input: "list" },
  { key: "notes", label: "Notes", input: "text" },
];

describe("check-ins written in an email reply", () => {
  it("sorts the lines under the section they follow, bullets and numbers removed", () => {
    const text = [
      "Fait cette semaine :",
      "- Documentation de l'API",
      "* Tests de charge",
      "",
      "PRÉVU SEMAINE PROCHAINE",
      "1. Filtres par client",
      "2) Export CSV",
      "## Difficultés à signaler",
      "• Toujours pas d'accès à la base de test",
    ].join("\n");
    expect(parseReply(text, fr)).toEqual({
      done: ["Documentation de l'API", "Tests de charge"],
      next: ["Filtres par client", "Export CSV"],
      blockers: ["Toujours pas d'accès à la base de test"],
    });
  });

  it("takes a section and its item on one line, and lines before any heading as achievements", () => {
    const text = "Shipped the invoices endpoint\nPrévu semaine prochaine : écrire la doc\nblockers: none so far";
    expect(parseReply(text, fr)).toEqual({
      done: ["Shipped the invoices endpoint"],
      next: ["écrire la doc"],
      blockers: ["none so far"],
    });
  });

  it("knows a label typed short, but not a sentence that only has a label's word in it", () => {
    const en: ReplySection[] = [
      { key: "done", label: "Done this week", input: "list" },
      { key: "next", label: "Planned for next week", input: "list" },
      { key: "notes", label: "Notes", input: "list" },
    ];
    expect(parseReply("Done\n- API docs\nPlanned next week\n- Export\nWrite release notes\nnext: Load tests", en)).toEqual({
      done: ["API docs"],
      next: ["Export", "Write release notes", "Load tests"],
    });
  });

  it("keeps a free-text section as one paragraph, and checkboxes as they are", () => {
    const text = "**Fait cette semaine**\n[x] Démo client\n[ ] Revue de code\nNotes\nUne semaine chargée.\nRetour lundi.";
    expect(parseReply(text, fr)).toEqual({
      done: ["[x] Démo client", "[ ] Revue de code"],
      notes: ["Une semaine chargée.\nRetour lundi."],
    });
  });

  it("does not take a sentence with a colon for a heading, and caps what one reply adds", () => {
    expect(parseReply("Note: the deadline moved", fr)).toEqual({ done: ["Note: the deadline moved"] });
    const many = Array.from({ length: REPLY_ITEMS_MAX + 10 }, (_, i) => `item ${i}`).join("\n");
    expect(parseReply(many, fr).done).toHaveLength(REPLY_ITEMS_MAX);
    expect(parseReply("\n\n  \n", fr)).toEqual({});
  });
});
