import type { Section, Snapshot } from "@ronde/core/types";
import { describe, expect, it } from "vitest";
import { actionOwners, linesAbout, sheetRows, sheetsToComplete } from "@/lib/shared/sheets";

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
    const s = state({ contributors: [{ personId: "bruno", projectId: "billing" }] as unknown as Snapshot["contributors"] });
    expect(linesAbout(s, "bruno", "billing", sections)).toBe(1);
    expect(sheetsToComplete(s, sections)).toBe(0);
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
