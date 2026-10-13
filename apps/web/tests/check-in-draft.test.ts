import type { CheckInDTO, ProjectDTO, Section } from "@ronde/core/types";
import { describe, expect, it } from "vitest";
import {
  appendLine,
  asTask,
  type CarryContext,
  carryPlans,
  type Draft,
  draftOf,
  fieldsOf,
  normDraft,
  pendingPlans,
  planStatus,
  rebaseDraft,
  sameDraft,
  sheetHolder,
  tabOf,
} from "@/lib/shared/check-in-draft";

// The check-in being written: loaded from the saved one, last time's plans brought back, merged with a version
// saved elsewhere, sent to the server

/** "Done" is a checklist that brings back last time's plans, "Planned" a list, "Notes" a free text */
const done: Section = { k: "done", label: "Done", kind: "done", type: "checklist", carryPlans: true };
const next: Section = { k: "next", label: "Planned", kind: "next", type: "list" };
const notes: Section = { k: "x:notes", label: "Notes", kind: "extra", type: "text" };
const sections = [done, next, notes];
const texts = new Set(["x:notes"]);

const fields = (patch: Partial<CheckInDTO> = {}): CheckInDTO => ({
  done: [],
  next: [],
  blockers: [],
  other: [],
  extra: {},
  byProject: {},
  updatedAt: null,
  ...patch,
});
const draft = (items: Draft["items"], byProject: Draft["byProject"] = {}, tab = ""): Draft => ({ items, byProject, tab });
const projects = [{ id: "billing" }, { id: "mobile" }];

describe("a draft loaded from the saved check-in", () => {
  it("is empty for someone who has not written yet", () => {
    expect(draftOf(undefined, projects, sections)).toEqual({
      items: { done: [], next: [], "x:notes": [""] },
      byProject: { billing: { done: [], next: [], "x:notes": [""] }, mobile: { done: [], next: [], "x:notes": [""] } },
      tab: "",
    });
  });

  it("gives a box to the items written before the section became a checklist, and keeps ticked ones", () => {
    const tab = tabOf(fields({ done: ["Invoices", "[x] Refunds", "[ ] Exports"] }), sections);
    expect(tab.done).toEqual(["[ ] Invoices", "[x] Refunds", "[ ] Exports"]);
  });

  it("merges an older list into a free text, one line per item", () => {
    const tab = tabOf(fields({ extra: { notes: ["Line one", "خط ثانٍ", "第三行"] } }), sections);
    expect(tab["x:notes"]).toEqual(["Line one\nخط ثانٍ\n第三行"]);
  });

  it("has one tab per project of the meeting, and drops the tabs of projects no longer followed", () => {
    const f = fields({ byProject: { billing: fields({ next: ["Ship"] }), gone: fields({ next: ["Lost"] }) } });
    const d = draftOf(f, projects, sections, "billing");
    expect(Object.keys(d.byProject)).toEqual(["billing", "mobile"]);
    expect(d.byProject.billing!.next).toEqual(["Ship"]);
    expect(d.tab).toBe("billing");
  });

  it("is empty when the meeting follows no project", () => {
    expect(draftOf(fields(), [], sections).byProject).toEqual({});
  });

  it("writes checklist items as a task, once", () => {
    expect(asTask("Plain")).toBe("[ ] Plain");
    expect(asTask("[x] Ticked")).toBe("[x] Ticked");
    expect(asTask("[X] Upper")).toBe("[X] Upper");
    expect(asTask("")).toBe("[ ] ");
  });
});

describe("last time's plans brought back", () => {
  const ctx = (patch: Partial<CarryContext> = {}): CarryContext => ({
    sections,
    lastWeek: { date: "2026-10-06", next: ["Invoices", "Refunds"] },
    own: true,
    updatedAt: 100,
    lastArchivedAt: 200,
    projects,
    ...patch,
  });
  const empty = () => draftOf(undefined, projects, sections);

  it("come back as boxes to tick in the section that brings them back", () => {
    expect(carryPlans(empty(), ctx())!.items.done).toEqual(["[ ] Invoices", "[ ] Refunds"]);
  });

  it("come back in the tab they were written in", () => {
    const out = carryPlans(empty(), ctx({ lastWeek: { date: "d", next: ["Invoices", "Ship v2"], byProject: { billing: ["Ship v2"] } } }))!;
    expect(out.items.done).toEqual(["[ ] Invoices"]);
    expect(out.byProject.billing!.done).toEqual(["[ ] Ship v2"]);
    expect(out.byProject.mobile).toEqual(empty().byProject.mobile);
  });

  it("of a project no longer followed come back in the person's own tab", () => {
    const out = carryPlans(empty(), ctx({ lastWeek: { date: "d", next: ["Old"], byProject: { gone: ["Old"] } } }))!;
    expect(out.items.done).toEqual(["[ ] Old"]);
    expect(out.byProject.gone).toBeUndefined();
  });

  it("written both in the own tab and a project's come back in each", () => {
    const out = carryPlans(empty(), ctx({ lastWeek: { date: "d", next: ["Same", "Same"], byProject: { billing: ["Same"] } } }))!;
    expect(out.items.done).toEqual(["[ ] Same"]);
    expect(out.byProject.billing!.done).toEqual(["[ ] Same"]);
  });

  it("are not added twice, whatever the box, the case or the spaces", () => {
    const d = draft({ done: ["[x] invoices ", "", "[ ] "], next: [], "x:notes": [""] });
    const out = carryPlans(d, ctx({ lastWeek: { date: "d", next: [" Invoices", "Refunds"] } }))!;
    // The blank lines of the section go when something is brought back
    expect(out.items.done).toEqual(["[x] invoices ", "[ ] Refunds"]);
  });

  it("bring back nothing when every plan is already there", () => {
    const d = draft({ done: ["[x] Invoices", "[ ] Refunds"], next: [], "x:notes": [""] });
    expect(carryPlans(d, ctx())).toBeNull();
  });

  it("keep a plan written twice twice", () => {
    expect(carryPlans(empty(), ctx({ lastWeek: { date: "d", next: ["Twice", "Twice"] } }))!.items.done).toEqual(["[ ] Twice", "[ ] Twice"]);
  });

  it("keep odd characters and right-to-left text as written", () => {
    const next = ["مراجعة الفواتير", "<b>&amp;</b>", "🚀 launch", "发布"];
    expect(carryPlans(empty(), ctx({ lastWeek: { date: "d", next } }))!.items.done).toEqual(next.map((n) => `[ ] ${n}`));
  });

  it("are not brought back once the check-in was saved after the last meeting", () => {
    expect(carryPlans(empty(), ctx({ updatedAt: 200 }))).toBeNull();
    expect(carryPlans(empty(), ctx({ updatedAt: 300 }))).toBeNull();
    expect(carryPlans(empty(), ctx({ updatedAt: null }))).not.toBeNull();
  });

  it("are not brought back before any meeting was archived", () => {
    expect(carryPlans(empty(), ctx({ updatedAt: null, lastArchivedAt: null }))).toBeNull();
  });

  it("are not brought back by the host fixing someone else's check-in", () => {
    expect(carryPlans(empty(), ctx({ own: false }))).toBeNull();
  });

  it("need a checklist section that brings them back, and plans", () => {
    expect(carryPlans(empty(), ctx({ sections: [{ ...done, carryPlans: false }, next] }))).toBeNull();
    expect(carryPlans(empty(), ctx({ sections: [{ ...done, type: "list" }, next] }))).toBeNull();
    expect(carryPlans(empty(), ctx({ lastWeek: undefined }))).toBeNull();
    expect(carryPlans(empty(), ctx({ lastWeek: { date: "d", next: [] } }))).toBeNull();
  });

  it("bring many plans back in order", () => {
    const many = Array.from({ length: 50 }, (_, i) => `Plan ${i}`);
    const out = carryPlans(empty(), ctx({ lastWeek: { date: "d", next: many } }))!;
    expect(out.items.done).toHaveLength(50);
    expect(out.items.done![49]).toBe("[ ] Plan 49");
  });

  it("keep the tab being edited", () => {
    expect(carryPlans({ ...empty(), tab: "mobile" }, ctx())!.tab).toBe("mobile");
  });
});

describe("a draft as the server stores it", () => {
  it("trims items, drops blank ones and boxes checklist items", () => {
    const d = draft({ done: ["  Invoices ", "", "[ ]   ", "[x] Refunds"], next: [" a ", "   "], "x:notes": ["\n  first  \n\n second\n"] });
    expect(normDraft(d, sections)).toEqual({
      tab: "",
      items: { done: ["[ ] Invoices", "[x] Refunds"], next: ["a"], "x:notes": ["first\nsecond"] },
      byProject: {},
    });
  });

  it("gives every section a value, and drops what is not a section any more", () => {
    expect(normDraft(draft({ gone: ["x"] }), sections).items).toEqual({ done: [], next: [], "x:notes": [""] });
  });

  it("normalises each project tab and forgets which tab is shown", () => {
    const d = draft({}, { billing: { next: [" Ship "] } }, "billing");
    const n = normDraft(d, sections);
    expect(n.tab).toBe("");
    expect(n.byProject.billing!.next).toEqual(["Ship"]);
  });

  it("tells two drafts the server would store the same way", () => {
    const a = draft({ done: ["Invoices"], next: [], "x:notes": ["hi"] }, {}, "billing");
    const b = draft({ done: ["[ ] Invoices ", ""], "x:notes": ["  hi\n"] });
    expect(sameDraft(a, b, sections)).toBe(true);
    expect(sameDraft(a, draft({ done: ["[x] Invoices"] }), sections)).toBe(false);
  });
});

describe("a line added to a section", () => {
  it("is ticked in Done when the section is a checklist", () => {
    expect(appendLine([], done, "Invoices")).toEqual(["[x] Invoices"]);
    expect(appendLine([], { ...done, k: "x:todo" }, "Invoices")).toEqual(["[ ] Invoices"]);
  });

  it("goes as is into a list", () => {
    expect(appendLine(["a"], next, "b")).toEqual(["a", "b"]);
  });

  it("is not added twice, whatever its box, case or spaces", () => {
    expect(appendLine(["[ ] Invoices"], done, " invoices ")).toBeNull();
    expect(appendLine(["Ünïcode"], next, "ünïcode")).toBeNull();
    expect(appendLine(["مرحبا"], next, " مرحبا")).toBeNull();
  });

  it("starts a free text, or goes on a new line of it", () => {
    expect(appendLine([], notes, "first")).toEqual(["first"]);
    expect(appendLine(["   "], notes, "first")).toEqual(["first"]);
    expect(appendLine(["first  \n"], notes, "second")).toEqual(["first\nsecond"]);
  });

  it("is not added to a free text that is that line already", () => {
    expect(appendLine(["First"], notes, "first")).toBeNull();
  });

  it("is not added again to a free text that already has that line among others", () => {
    expect(appendLine(["first\nsecond"], notes, "second")).toBeNull();
  });
});

describe("the fields sent when saving", () => {
  it("are the four sections, then the custom ones under their own key", () => {
    const sections2: Section[] = [...sections, { k: "x:risks", label: "Risks", kind: "extra", type: "checklist" }];
    const out = fieldsOf({ done: [" a ", "", "[ ] "], next: ["b"], "x:notes": ["c"], "x:risks": ["d"], stray: ["e"] }, sections2);
    expect(out).toEqual({ done: ["[ ] a"], next: ["b"], blockers: [], other: [], extra: { notes: ["c"], risks: ["[ ] d"] } });
  });

  // Regression: an emptied box ("[ ] ", left by Enter at the end of an item) was trimmed to "[ ]", no longer read
  // as a box, and saved as the item "[ ] [ ]"
  it("leave out a checklist box emptied of its text", () => {
    expect(fieldsOf({ done: ["[ ] ", "[x] ", " [ ]  ", "[ ] kept"] }, sections).done).toEqual(["[ ] kept"]);
    expect(normDraft(draft({ done: ["[x]   "] }), sections).items.done).toEqual([]);
  });

  it("keep a free text as typed, blank ones aside", () => {
    expect(fieldsOf({ "x:notes": ["[ ] ", "   "] }, sections).extra.notes).toEqual(["[ ]"]);
  });

  it("are empty for an empty tab", () => {
    expect(fieldsOf({}, [])).toEqual({ done: [], next: [], blockers: [], other: [], extra: {} });
  });
});

describe("a draft rebased onto a version saved elsewhere", () => {
  it("merges lists item by item: what each side added stays, what one side removed goes", () => {
    const base = draft({ next: ["a", "b"] });
    const mine = draft({ next: ["a", "b", "mine"] });
    const theirs = draft({ next: ["b", "theirs"] });
    expect(rebaseDraft(base, mine, theirs, texts).items.next).toEqual(["b", "theirs", "mine"]);
  });

  it("does not add twice an item both sides added", () => {
    const out = rebaseDraft(draft({ next: [] }), draft({ next: ["both"] }), draft({ next: ["both"] }), texts);
    expect(out.items.next).toEqual(["both"]);
  });

  it("gives a free text to the side that changed it, and to this side when both did", () => {
    const base = draft({ "x:notes": ["base"] });
    expect(rebaseDraft(base, base, draft({ "x:notes": ["theirs"] }), texts).items["x:notes"]).toEqual(["theirs"]);
    expect(rebaseDraft(base, draft({ "x:notes": ["mine"] }), base, texts).items["x:notes"]).toEqual(["mine"]);
    expect(rebaseDraft(base, draft({ "x:notes": ["mine"] }), draft({ "x:notes": ["theirs"] }), texts).items["x:notes"]).toEqual(["mine"]);
  });

  it("merges each project tab on its own, including one only one side has", () => {
    const base = draft({}, { billing: { next: ["a"] } });
    const mine = draft({}, { billing: { next: ["a", "mine"] }, mobile: { next: ["new here"] } }, "mobile");
    const theirs = draft({}, { billing: { next: [] }, web: { next: ["new there"] } });
    const out = rebaseDraft(base, mine, theirs, texts);
    expect(out.tab).toBe("mobile");
    expect(out.byProject).toEqual({ billing: { next: ["mine"] }, mobile: { next: ["new here"] }, web: { next: ["new there"] } });
  });

  it("keeps sections only one side has", () => {
    const out = rebaseDraft(draft({}), draft({ done: ["x"] }), draft({ blockers: ["y"] }), texts);
    expect(out.items).toEqual({ done: ["x"], blockers: ["y"] });
  });

  it("is empty when every side is", () => {
    expect(rebaseDraft(draft({}), draft({}), draft({}), texts)).toEqual(draft({}));
  });
});

describe("who holds a project's sheet", () => {
  const p = (editingById: string | null, editingUntil: number | null) =>
    ({ sheet: { editingById, editingUntil } }) as unknown as Pick<ProjectDTO, "sheet">;

  it("is the person writing it until their reservation lapses", () => {
    expect(sheetHolder(p("alice", 1000), 999)).toBe("alice");
    expect(sheetHolder(p("alice", 1000), 1000)).toBeNull();
    expect(sheetHolder(p("alice", null), 0)).toBeNull();
  });

  it("is nobody without a sheet or a writer", () => {
    expect(sheetHolder({ sheet: null }, 0)).toBeNull();
    expect(sheetHolder(p(null, 5000), 0)).toBeNull();
  });
});

describe("sorting last time's plans", () => {
  const d = draft({ done: ["[x] Invoices", "[ ] Refunds"], next: ["Exports"] }, { billing: { done: ["[x] Ship v2"] } });

  it("finds a plan done, brought back but not ticked, carried over, dismissed or still to sort", () => {
    expect(planStatus(d, [], "invoices ")).toBe("done");
    expect(planStatus(d, [], "Refunds")).toBe("here");
    expect(planStatus(d, [], "Exports")).toBe("next");
    expect(planStatus(d, ["audit"], " Audit")).toBe("skip");
    expect(planStatus(d, [], "Audit")).toBeNull();
  });

  it("looks in every project tab", () => {
    expect(planStatus(d, [], "Ship v2")).toBe("done");
  });

  it("prefers Done over Planned and over a dismissal", () => {
    const both = draft({ done: ["[x] Same"], next: ["Same"] });
    expect(planStatus(both, ["same"], "Same")).toBe("done");
  });

  it("leaves the plans not handled yet to sort, in order", () => {
    expect(pendingPlans(["Invoices", "Audit", "Exports", "Hiring"], d, ["hiring"])).toEqual(["Audit"]);
    expect(pendingPlans([], d, [])).toEqual([]);
    expect(pendingPlans(["Audit", "Audit"], d, [])).toEqual(["Audit", "Audit"]);
  });

  it("matches right-to-left and Chinese plans", () => {
    const rtl = draft({ done: ["[x] مراجعة"], next: ["发布"] });
    expect(pendingPlans(["مراجعة", "发布", "其他"], rtl, [])).toEqual(["其他"]);
  });

  // A free-text "Done" or "Planned" holds every line in one block: a plan is found among them
  it("finds a plan in a free-text section of several lines", () => {
    expect(planStatus(draft({ done: ["Invoices\nRefunds"] }), [], "Refunds")).toBe("done");
  });
});
