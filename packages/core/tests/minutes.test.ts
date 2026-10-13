import { markdownToHtml } from "@ronde/core/markdown";
import { decisionsOf, MINUTES_PARTS, minutesMarkdown, recordDecisions } from "@ronde/core/minutes";
import { parseRecord } from "@ronde/core/record";
import { describe, expect, it } from "vitest";

// Written in the first record format: every case also checks that it is read as the current one
const old = {
  date: "2026-09-21",
  teamName: "Product team",
  startedAt: 0,
  endedAt: 1_380_000,
  durationMs: 1_380_000,
  spent: { a: 125_000 },
  participants: [{ id: "a", name: "Alice Martin", jobCategory: "Design" }],
  absent: ["Bruno Petit"],
  updates: { a: { done: ["OIDC sign-in"], next: ["Tests"], blockers: ["Staging access"], other: [] } },
  notes: { a: "Decision: we follow up with IT", intro: "Back from holidays" },
  interactions: [{ type: "question", byId: "c", targetId: "a", text: "Which date?", stepKey: "a", resolved: true }],
  topics: [{ text: "On-call rota", byId: null, done: true }],
  actions: [{ text: "Follow up | with IT", ownerId: "a", status: "doing" }],
  names: { a: "Alice Martin", c: "Chloe Roy" },
  icebreaker: { question: "Your win of the week?", answers: [{ byId: "c", text: "The demo worked" }] },
  kudos: [{ fromId: "c", toId: "a", text: "Thanks for the review" }],
};
const v1 = (patch: object = {}) => parseRecord({ ...old, ...patch })!;
const record = v1();

describe("minutesMarkdown", () => {
  const md = minutesMarkdown(record, "en");

  it("includes the header, absent people and duration", () => {
    expect(md).toContain("# Minutes · Product team");
    expect(md).toContain("duration 23:00");
    expect(md).toContain("absent: Bruno Petit");
  });

  it("details each turn with the check-in, the notes and the questions", () => {
    expect(md).toContain("### Alice Martin (design) · 2:05");
    expect(md).toContain("**Done this week**\n- OIDC sign-in");
    expect(md).toContain("**Notes · Host**\n- Decision: we follow up with IT");
    expect(md).toContain("- Chloe Roy: Which date?");
  });

  it("produces a valid actions table and the next meeting", () => {
    expect(md).toContain("| Follow up / with IT | Alice Martin | In progress |");
    expect(md).toContain("## Blockers raised\n- Staging access (Alice Martin)");
    expect(md).toMatch(/Next meeting: Monday, September 28/);
  });

  it("groups decisions at the top", () => {
    expect(md).toContain("## Decisions\n- we follow up with IT _(Alice Martin)_");
  });

  it("gives the decisions of a session for the decision log, in agenda order", () => {
    const r = v1({ notes: { misc: "Decision: rota every month", a: "- **Decision:** we follow up with IT" } });
    expect(recordDecisions(r, "en")).toEqual([
      { text: "we follow up with IT", context: "(Alice Martin)" },
      { text: "rota every month", context: "(Open topics)" },
    ]);
  });

  it("finds the decisions noted during the blocks of the agenda", () => {
    const r = v1({
      ...record,
      agenda: [
        { id: "pk", type: "poker" },
        { id: "tb", type: "timebox", title: "Hiring" },
      ],
      notes: { pk: "Decision: SSO first", tb: "Decision: open a role", "qa:tb": "Decision: ask HR" },
    });
    expect(recordDecisions(r, "en").map((d) => `${d.text} ${d.context}`)).toEqual([
      "SSO first (Estimates)",
      "open a role (Hiring)",
      "ask HR (Questions · Hiring)",
    ]);
    expect(minutesMarkdown(r, "en")).toContain("Decision: SSO first");
  });

  it("lists the parking lot after the open topics", () => {
    const parked = minutesMarkdown(v1({ ...record, parking: [{ text: "Office move", byId: "c" }] }), "en");
    expect(parked).toContain("## Parking lot\n- Office move (Chloe Roy)");
    expect(minutesMarkdown(v1({ ...record, omit: ["topics"], parking: [{ text: "Office move", byId: "c" }] }), "en")).not.toContain(
      "Parking lot",
    );
  });

  it("is written in French when the team works in French", () => {
    const fr = minutesMarkdown(v1({ notes: { a: "Décision : on relance la DSI" } }), "fr");
    expect(fr).toContain("# Compte rendu · Product team");
    expect(fr).toContain("durée 23:00");
    expect(fr).toContain("**Fait cette semaine**\n- OIDC sign-in");
    expect(fr).toContain("**Notes · Régisseur**");
    expect(fr).toContain("| Follow up / with IT | Alice Martin | En cours |");
    expect(fr).toContain("## Décisions\n- on relance la DSI _(Alice Martin)_");
    expect(fr).toMatch(/Prochaine réunion\s: lundi 28 septembre/);
  });
});

describe("minutesMarkdown, engagement", () => {
  it("includes the icebreaker, the votes and the kudos", () => {
    const md = minutesMarkdown(v1({ topics: [{ text: "On-call rota", byId: null, done: true, votes: 3 }] }), "en");
    expect(md).toContain("## Icebreaker: Your win of the week?\n- Chloe Roy: The demo worked");
    expect(md).toContain("- On-call rota · 3 votes");
    expect(md).toContain("## Kudos\n- Chloe Roy → Alice Martin: Thanks for the review");
  });

  it("flags postponed topics and the planned date of the next meeting", () => {
    const md = minutesMarkdown(v1({ topics: [{ text: "Remote work", byId: null, done: false }], nextDate: "2026-10-06" }), "en");
    expect(md).toContain("- Remote work · postponed");
    expect(md).toMatch(/Next meeting: Tuesday, October 6/);
  });

  it("accepts records without the optional parts", () => {
    const { icebreaker: _i, kudos: _k, ...rest } = old;
    const r = parseRecord(rest);
    expect(r).not.toBeNull();
    expect(() => minutesMarkdown(r!, "en")).not.toThrow();
  });

  it("uses the team's sections, the mood and the comments", () => {
    const md = minutesMarkdown(
      v1({
        updates: { a: { done: ["OIDC sign-in"], next: [], blockers: [], other: [], extra: { k1: ["Read about Next 16"] } } },
        sections: [
          { k: "done", label: "Achievements", kind: "done" },
          { k: "x:k1", label: "Research", kind: "extra" },
        ],
        mood: { counts: [0, 0, 1, 2, 1], avg: 4 },
        comments: [
          { ownerId: "a", section: "done", itemText: "OIDC sign-in", byId: "c", text: "" },
          { ownerId: "a", section: "done", itemText: "OIDC sign-in", byId: "c", text: "Well done!" },
        ],
      }),
      "en",
    );
    expect(md).toContain("**Achievements**\n- OIDC sign-in (👍 1)\n  - Chloe Roy: Well done!");
    expect(md).toContain("**Research**\n- Read about Next 16");
    expect(md).not.toContain("Done this week");
    expect(md).toContain("## Team mood\n⛈️ 0 · 🌧️ 0 · ⛅ 1 · 🌤️ 2 · ☀️ 1 (average 4.0/5)");
    expect(minutesMarkdown(v1({ mood: { counts: [0, 0, 1, 2, 1], avg: 4 } }), "fr")).toContain("(moyenne 4,0/5)");
  });
});

describe("minutesMarkdown, content choice", () => {
  it("turns notes into a list while keeping sub-lists", () => {
    const md = minutesMarkdown(v1({ notes: { a: "Point A\n  - detail\n**Decision:** we keep it" } }), "en");
    expect(md).toContain("**Notes · Host**\n- Point A\n  - detail\n- **Decision:** we keep it");
  });

  it("can keep the host notes only", () => {
    const md = minutesMarkdown(
      v1({
        participants: [...old.participants, { id: "b", name: "Bruno Petit", jobCategory: "Engineering" }],
        updates: { ...old.updates, b: { done: ["Nothing to report"], next: [], blockers: [], other: [] } },
      }),
      "en",
      { omit: MINUTES_PARTS },
    );
    expect(md).toContain("### Alice Martin (design) · 2:05\n- Decision: we follow up with IT");
    expect(md).not.toContain("Notes · Host");
    expect(md).not.toContain("Bruno Petit (engineering)");
    expect(md).not.toContain("OIDC sign-in");
    expect(md).not.toContain("Which date?");
    expect(md).not.toContain("Icebreaker");
    expect(md).not.toContain("## Kudos");
    expect(md).not.toContain("Blockers raised");
    expect(md).not.toContain("On-call rota");
    expect(md).toContain("| Follow up / with IT | Alice Martin | In progress |");
  });

  it("recognises decisions typed in any supported language", () => {
    expect(decisionsOf("- **Decision:** ship it\nDécision : on livre\nnot a decision")).toEqual(["ship it", "on livre"]);
  });
});

describe("markdownToHtml", () => {
  it("escapes HTML and renders headings, lists and tables", () => {
    const html = markdownToHtml("# Title <script>\n- **bold**\n| A | B |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<h1>Title &lt;script&gt;</h1>");
    expect(html).toContain("<li><strong>bold</strong></li>");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td>2</td>");
    expect(html).not.toContain("<script>");
  });

  it("renders italic, strikethrough, code and safe links", () => {
    const html = markdownToHtml(
      "A *word* and ~~that~~, `a**b**` and [doc](https://example.com/a?b=1&c=2) but not [x](javascript:alert(1))",
    );
    expect(html).toContain("<em>word</em>");
    expect(html).toContain("<del>that</del>");
    expect(html).toContain("<code>a**b**</code>");
    expect(html).toContain('<a href="https://example.com/a?b=1&amp;c=2" target="_blank" rel="noopener">doc</a>');
    expect(html).not.toContain('href="javascript');
  });

  it("nests sub-lists and numbered lists", () => {
    const html = markdownToHtml("- a\n  - a1\n  - a2\n- b\n1. one\n2. two");
    expect(html).toBe("<ul><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul><ol><li>one</li><li>two</li></ol>");
  });

  it("does not mistake bold at the start of a line for a bullet", () => {
    expect(markdownToHtml("**Decision:** yes")).toBe("<p><strong>Decision:</strong> yes</p>");
  });
});

describe("minutes of the project round", () => {
  it("name the author of each line, then the people who joined it", () => {
    const r = {
      ...record,
      projects: [{ id: "p", name: "Billing", theme: "", status: "active", health: null, headline: "", speakers: ["a"], presented: true }],
      checkIns: {
        a: { items: [{ id: "i1", section: record.sections[0]!.key, text: "Pagination", sourceItemId: null, projectId: "p", with: ["c"] }] },
      },
    };
    const md = minutesMarkdown(r, "en");
    expect(md).toContain("Pagination");
    expect(md).toContain("Alice Martin, Chloe Roy");
  });

  it("name the people who joined a line of someone's own round, and nobody on the other lines", () => {
    const key = record.sections[0]!.key;
    const r = {
      ...record,
      checkIns: {
        a: {
          items: [
            { id: "i1", section: key, text: "Release notes", sourceItemId: null, projectId: null, with: ["c"] },
            { id: "i2", section: key, text: "Design review", sourceItemId: null, projectId: null, with: [] },
          ],
        },
      },
    };
    const md = minutesMarkdown(r, "en");
    expect(md).toContain("- Alice Martin, Chloe Roy: Release notes");
    expect(md).toContain("- Design review");
    expect(md).not.toContain("Alice Martin: Design review");
  });
});
