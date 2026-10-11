import { buildMinutes, minutesToMarkdown } from "@ronde/core/minutes";
import { itemsWithRole, parseRecord, recordCheckIn, recordV1 } from "@ronde/core/record";
import { describe, expect, it } from "vitest";

// First record format, as archived before versions
const v0 = {
  date: "2026-09-21",
  teamName: "Product team",
  startedAt: 0,
  endedAt: 1_380_000,
  durationMs: 1_380_000,
  spent: { a: 125_000 },
  participants: [{ id: "a", name: "Alice Martin", jobCategory: "Design" }],
  absent: ["Bruno Petit"],
  updates: { a: { projects: ["Portal"], done: ["OIDC sign-in"], next: ["[ ] Tests"], blockers: [], other: [], extra: { k1: ["Read"] } } },
  notes: { a: "Decision: ship" },
  interactions: [],
  topics: [{ text: "On-call rota", byId: null, done: true }],
  actions: [],
  names: { a: "Alice Martin", b: "Bruno Petit" },
  sections: [
    { k: "done", label: "Achievements", kind: "done" },
    { k: "next", label: "", kind: "next", type: "checklist" },
    { k: "x:k1", label: "Research", kind: "extra" },
  ],
  comments: [{ ownerId: "a", section: "done", itemText: "OIDC sign-in", byId: "b", text: "Nice" }],
};

describe("records", () => {
  it("reads the first format as the current one", () => {
    const r = parseRecord(v0)!;
    expect(r.v).toBe(1);
    expect(r.sections).toEqual([
      { key: "done", label: "Achievements", role: "achievement", input: "list" },
      { key: "next", label: "", role: "plan", input: "checklist" },
      { key: "k1", label: "Research", role: "custom", input: "list" },
    ]);
    expect(r.absent).toEqual([{ id: "b", name: "Bruno Petit" }]);
    expect(itemsWithRole(r, "a", "plan").map((i) => i.text)).toEqual(["[ ] Tests"]);
    // The comment now points at the item, not at its text
    const signIn = r.checkIns.a!.items.find((i) => i.text === "OIDC sign-in")!;
    expect(r.comments).toEqual([{ itemId: signIn.id, byId: "b", text: "Nice" }]);
    expect(recordCheckIn(r, "a")).toEqual({
      done: ["OIDC sign-in"],
      next: ["[ ] Tests"],
      blockers: [],
      other: [],
      extra: { k1: ["Read"] },
    });
  });

  it("round-trips the current format through JSON", () => {
    const r = parseRecord(v0)!;
    const again = parseRecord(JSON.parse(JSON.stringify(r)));
    expect(again).toEqual(r);
    expect(recordV1.safeParse(again).success).toBe(true);
  });

  it("refuses what is not a record", () => {
    expect(parseRecord(null)).toBeNull();
    expect(parseRecord("minutes")).toBeNull();
    expect(parseRecord({ v: 1, date: "2026-09-21" })).toBeNull();
  });

  it("renders the same minutes in English and French from one record", () => {
    const r = parseRecord(v0)!;
    expect(minutesToMarkdown(buildMinutes(r, "en", { summary: "Short **week**." }))).toMatchSnapshot();
    expect(minutesToMarkdown(buildMinutes(r, "fr", { summary: "Semaine **courte**." }))).toMatchSnapshot();
  });

  it("builds a tree the history renders without reading text back", () => {
    const doc = buildMinutes(parseRecord(v0)!, "en");
    expect(doc.parts.map((p) => p.kind)).toEqual(["decisions", "round", "topics"]);
    const round = doc.parts.find((p) => p.kind === "round")!;
    expect(round.blocks[0]).toMatchObject({ type: "person", id: "a", name: "Alice Martin", role: "Design", spentMs: 125_000 });
    const person = round.blocks[0] as Extract<(typeof round.blocks)[number], { type: "person" }>;
    expect(person.blocks).toContainEqual({ type: "label", text: "Planned for next week", tone: "plan" });
    expect(person.blocks).toContainEqual({ type: "list", items: [{ text: "Tests", checked: false }] });
  });
});

describe("records with a project round", () => {
  const r = parseRecord({
    ...parseRecord(v0)!,
    participants: [
      { id: "a", name: "Alice Martin", jobCategory: "Design" },
      { id: "b", name: "Bruno Petit", jobCategory: "Engineering" },
    ],
    absent: [],
    spent: { a: 60_000, b: 30_000, "p:p1": 245_000 },
    names: { a: "Alice Martin", b: "Bruno Petit", c: "Chloe Roy" },
    notes: { "p:p1": "Decision: move the launch to May" },
    comments: [],
    checkIns: {
      a: {
        items: [
          { id: "a1", section: "done", text: "Holidays booked" },
          { id: "a2", section: "done", text: "Login page", projectId: "p1" },
          { id: "a3", section: "next", text: "[ ] Mobile layout", projectId: "p2" },
        ],
      },
      b: { items: [{ id: "b1", section: "done", text: "API deployed", projectId: "p1" }] },
      // Absent, but her project was presented by its members
      c: { items: [{ id: "c1", section: "done", text: "Legal review", projectId: "p1" }] },
    },
    projects: [
      {
        id: "p1",
        name: "Portal",
        theme: "Customers",
        status: "active",
        health: "atRisk",
        headline: "Launch slips",
        speakers: ["a", "b"],
        presented: true,
      },
      { id: "p2", name: "Mobile app", status: "active", health: null, presented: false },
    ],
  })!;

  it("keeps the items of each project and gives a person's tabs back", () => {
    expect(r.projects[1]).toMatchObject({ theme: "", headline: "", speakers: [] });
    expect(recordCheckIn(r, "a")).toEqual({
      done: ["Holidays booked"],
      next: [],
      blockers: [],
      other: [],
      extra: { k1: [] },
      byProject: {
        p1: { done: ["Login page"], next: [], blockers: [], other: [], extra: { k1: [] } },
        p2: { done: [], next: ["[ ] Mobile layout"], blockers: [], other: [], extra: { k1: [] } },
      },
    });
  });

  it("gives the project round its own part, and leaves its items out of the turns", () => {
    const doc = buildMinutes(r, "en");
    expect(doc.parts.map((p) => p.kind)).toEqual(["decisions", "round", "projects", "topics"]);
    const md = minutesToMarkdown(doc);
    expect(md).toContain("## Decisions\n- move the launch to May _(Portal)_");
    expect(md).toContain(
      "## Projects\n\n### Portal (Customers) · At risk · 4:05\nLaunch slips\n**Achievements**\n- Alice Martin: Login page\n- Bruno Petit: API deployed\n- Chloe Roy: Legal review",
    );
    // Alice's own news stay in her turn, with the project that had no step of its own
    expect(md).toContain(
      "### Alice Martin (design) · 1:00\n**Achievements**\n- Holidays booked\nAbout Mobile app\n**Planned for next week**\n- ☐ Mobile layout",
    );
    expect(md).not.toContain("- Login page\n");
    expect(minutesToMarkdown(buildMinutes(r, "fr"))).toContain("## Projets\n\n### Portal (Customers) · À risque · 4:05");
  });
});
