import type { Section, Snapshot } from "@ronde/core/types";
import { describe, expect, it } from "vitest";
import { actionOwners, linesAbout, sheetRows, sheetsToComplete, writersOf } from "@/lib/shared/sheets";

// The project sheets of the control room and who an action can go to, computed from the meeting's state

const sections: Section[] = [{ k: "done", label: "Done", kind: "done" }];
const member = (id: string, active = true) => ({ id, name: `${id[0]!.toUpperCase()}${id.slice(1)} Doe`, active });
const tab = (done: string[]) => ({ done, next: [], blockers: [], other: [], extra: {} });

/** Alice and Bruno on the Billing project; Chloe gone from the meeting; Olivia observes */
function state(patch: Partial<Snapshot> = {}): Snapshot {
  return {
    members: [member("alice"), member("bruno"), member("chloe", false)],
    observers: [{ id: "olivia", name: "Olivia Watcher" }],
    meeting: { absent: [] },
    projects: [
      { id: "billing", name: "Billing", memberIds: ["alice", "bruno", "chloe"], sheet: { health: "green", headline: "On track" } },
    ],
    checkIns: { alice: { byProject: { billing: tab(["Invoices"]) } } },
    contributors: [],
    ...patch,
  } as unknown as Snapshot;
}
const label = (k: string) => k;
/** Someone joining Alice's line of a project ("Invoices" in "done" by default) */
const joined = (personId: string, projectId: string, section = "done", itemText = "Invoices") => ({
  ownerId: "alice",
  section,
  itemText,
  projectId,
  personId,
});

describe("project sheets", () => {
  it("wait for a line from each person expected today", () => {
    const [row] = sheetRows(state(), sections, (id) => id, label);
    // Chloe left the meeting: she does not hold the sheet back
    expect(row!.lines.map((x) => x.id)).toEqual(["alice", "bruno"]);
    expect(row!.missing).toEqual(["bruno"]);
    expect(sheetsToComplete(state(), sections)).toBe(1);
  });

  it("are complete when the one who has not written is absent today", () => {
    const s = state({ meeting: { absent: ["bruno"] } as unknown as Snapshot["meeting"] });
    expect(sheetRows(s, sections, (id) => id, label)[0]).toMatchObject({ missing: [], complete: true });
    expect(sheetsToComplete(s, sections)).toBe(0);
  });

  it("count a line someone joined as theirs", () => {
    const s = state({ contributors: [joined("bruno", "billing")] as unknown as Snapshot["contributors"] });
    expect(linesAbout(s, "bruno", "billing", sections)).toBe(1);
    expect(sheetsToComplete(s, sections)).toBe(0);
  });

  it("do not count a joined line that is no longer there: its section removed, or the line itself", () => {
    const gone = [joined("bruno", "billing", "x:removed"), joined("bruno", "billing", "done", "Deleted line")];
    const s = state({ contributors: gone as unknown as Snapshot["contributors"] });
    expect(linesAbout(s, "bruno", "billing", sections)).toBe(0);
    expect(sheetsToComplete(s, sections)).toBe(1);
  });

  it("ask for the health and the message of the day", () => {
    const s = state({
      projects: [
        { id: "billing", name: "Billing", memberIds: [], sheet: { health: null, headline: " " } },
      ] as unknown as Snapshot["projects"],
    });
    expect(sheetRows(s, sections, (id) => id, label)[0]!.missing).toEqual(["sheets.health", "sheets.headline"]);
  });
});

describe("action owners", () => {
  it("are the active members, then the observers, each once", () => {
    const s = state({ observers: [{ id: "olivia", name: "Olivia Watcher" }, member("alice")] as unknown as Snapshot["observers"] });
    expect(actionOwners(s).map((x) => x.id)).toEqual(["alice", "bruno", "olivia"]);
  });
});

describe("the writers of a project", () => {
  const withCheckIns = (checkIns: Record<string, unknown>, contributors: unknown[] = []) =>
    state({ checkIns, contributors } as unknown as Partial<Snapshot>);

  it("are the people who wrote a line about it", () => {
    expect(writersOf(state(), "billing", sections)).toEqual(["alice"]);
  });

  it("leave out blank lines and empty checkboxes", () => {
    const s = withCheckIns({ alice: { byProject: { billing: tab(["  ", "[ ] ", "[x]  "]) } } });
    expect(writersOf(s, "billing", sections)).toEqual([]);
  });

  it("count a ticked item that has text", () => {
    const s = withCheckIns({ alice: { byProject: { billing: tab(["[x] Invoices sent"]) } } });
    expect(writersOf(s, "billing", sections)).toEqual(["alice"]);
  });

  it("only read the sections of the meeting and the project asked about", () => {
    const s = withCheckIns({
      alice: { byProject: { billing: { ...tab([]), next: ["Not a section here"] } } },
      bruno: { byProject: { search: tab(["Another project"]) } },
    });
    expect(writersOf(s, "billing", sections)).toEqual([]);
    expect(writersOf(s, "search", sections)).toEqual(["bruno"]);
  });

  it("read custom sections too", () => {
    const custom: Section[] = [{ k: "x:risks", label: "Risks", kind: "other" } as Section];
    const s = withCheckIns({ alice: { byProject: { billing: { ...tab([]), extra: { risks: ["Vendor late"] } } } } });
    expect(writersOf(s, "billing", custom)).toEqual(["alice"]);
  });

  it("add those who joined a line, each once", () => {
    const s = withCheckIns({ alice: { byProject: { billing: tab(["Invoices"]) } } }, [
      joined("alice", "billing"),
      joined("bruno", "billing"),
      joined("bruno", "billing"),
      joined("chloe", "search"),
      // A line that is no longer there does not count
      joined("david", "billing", "done", "Deleted line"),
    ]);
    expect(writersOf(s, "billing", sections)).toEqual(["alice", "bruno"]);
  });

  it("are none for a project nobody wrote about, or with no sections", () => {
    expect(writersOf(state(), "unknown", sections)).toEqual([]);
    expect(writersOf(state(), "billing", [])).toEqual([]);
    expect(writersOf(withCheckIns({}), "billing", sections)).toEqual([]);
  });

  it("keep lines in any script", () => {
    const s = withCheckIns({
      alice: { byProject: { billing: tab(["الفواتير أُرسلت"]) } },
      bruno: { byProject: { billing: tab(["发票"]) } },
    });
    expect(writersOf(s, "billing", sections)).toEqual(["alice", "bruno"]);
  });
});
