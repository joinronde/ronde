import { ambienceFor, birthdaysAround, easter, resolveAmbience } from "@ronde/core/ambience";
import { mergeLayout, moveBlock, setColumnCount } from "@ronde/core/layout";
import { minutesMarkdown } from "@ronde/core/minutes";
import { parseRecord } from "@ronde/core/record";
import { plainItem, resolveSections, taskItem, taskOf } from "@ronde/core/util";
import { describe, expect, it } from "vitest";

describe("block layout", () => {
  const def = [
    ["a", "b", "c"],
    ["d", "e"],
  ];

  it("falls back on the default layout without a valid preference", () => {
    expect(mergeLayout(def, undefined)).toEqual(def);
    expect(mergeLayout(def, [])).toEqual(def);
    expect(mergeLayout(def, [[], [], [], []])).toEqual(def);
    expect(mergeLayout(def, "whatever")).toEqual(def);
  });

  it("keeps the chosen order, forgets gone blocks and places new ones after their neighbour", () => {
    expect(
      mergeLayout(def, [
        ["e", "a"],
        ["zz", "d", "c"],
      ]),
    ).toEqual([
      ["e", "a", "b"],
      ["d", "c"],
    ]);
    // Duplicate ignored
    expect(
      mergeLayout(def, [
        ["a", "a", "b", "c"],
        ["d", "e"],
      ]),
    ).toEqual(def);
  });

  it("keeps the chosen number of columns, from 1 to 3", () => {
    expect(mergeLayout(def, [["e", "a"]])).toEqual([["e", "a", "b", "c", "d"]]);
    expect(mergeLayout(def, [["a"], ["d"], ["e"]])).toEqual([["a", "b", "c"], ["d"], ["e"]]);
    expect(setColumnCount(def, 1)).toEqual([["a", "b", "c", "d", "e"]]);
    expect(setColumnCount(def, 3)).toEqual([["a", "b", "c"], ["d", "e"], []]);
    expect(setColumnCount([["a"], ["b"], ["c"]], 2)).toEqual([["a"], ["b", "c"]]);
  });

  it("moves a block within a column or to another one", () => {
    expect(moveBlock(def, "c", 0, 0)).toEqual([
      ["c", "a", "b"],
      ["d", "e"],
    ]);
    expect(moveBlock(def, "a", 1, 1)).toEqual([
      ["b", "c"],
      ["d", "a", "e"],
    ]);
    expect(moveBlock(def, "e", 0, 99)).toEqual([["a", "b", "c", "e"], ["d"]]);
  });
});

describe("waiting-screen ambience", () => {
  const on = (iso: string) => ambienceFor(new Date(iso + "T10:00:00")).key;

  it("computes Easter", () => {
    expect(easter(2026).getDate()).toBe(5);
    expect(easter(2026).getMonth()).toBe(3);
    expect(easter(2027).getMonth()).toBe(2); // March 28, 2027
  });

  it("covers at least a week around each holiday: a weekly meeting always falls inside", () => {
    // Week of July 14 (day off): meeting moved to Wednesday 8 or Monday 13
    expect(on("2026-07-08")).toBe("bastille-day");
    expect(on("2026-07-13")).toBe("bastille-day");
    expect(on("2026-03-09")).toBe("pi-day");
    expect(on("2026-04-28")).toBe("star-wars");
    expect(on("2026-06-15")).toBe("music-day");
    expect(on("2026-02-09")).toBe("valentines");
    expect(on("2026-03-30")).toBe("easter-april-fools"); // Holy Week 2026 overlaps April Fools'
    expect(on("2026-03-27")).toBe("easter-april-fools");
    expect(on("2028-04-14")).toBe("easter"); // Easter 2028 on April 16, no overlap
    expect(on("2027-04-02")).toBe("easter-april-fools"); // Easter 2027 on March 28
    expect(on("2028-03-28")).toBe("april-fools"); // Easter 2028 on April 16
    expect(on("2026-09-07")).toBe("programmers-day");
    expect(on("2026-10-19")).toBe("halloween");
    expect(on("2026-11-02")).toBe("halloween");
    // Each holiday lasts at least 7 days
    const year = [...Array(365)].map((_, i) => ambienceFor(new Date(2026, 0, 1 + i)).key);
    const runs: Record<string, number> = {};
    let prev = "";
    let len = 0;
    for (const k of [...year, "end"]) {
      if (k === prev) len++;
      else {
        if (prev) runs[prev] = Math.min(runs[prev] ?? Infinity, len);
        prev = k;
        len = 1;
      }
    }
    // Seasons are only a fallback between holidays: only holidays have a minimum duration
    const seasons = ["winter", "spring", "summer", "autumn"];
    for (const [k, min] of Object.entries(runs)) if (!seasons.includes(k)) expect(min, k).toBeGreaterThanOrEqual(7);
  });

  it("picks the holiday of the day, otherwise the season", () => {
    expect(on("2026-10-30")).toBe("halloween");
    expect(on("2026-12-15")).toBe("christmas");
    expect(on("2026-12-28")).toBe("holidays");
    expect(on("2027-01-02")).toBe("new-year");
    expect(on("2027-02-02")).toBe("candlemas");
    expect(on("2027-03-14")).toBe("pi-day");
    expect(on("2026-04-06")).toBe("easter-april-fools"); // Easter Monday 2026
    expect(on("2026-05-04")).toBe("star-wars");
    expect(on("2026-09-13")).toBe("programmers-day");
    expect(on("2028-09-12")).toBe("programmers-day"); // leap year
    expect(on("2026-09-03")).toBe("back-to-school");
    expect(on("2026-08-26")).toBe("back-to-school");
    expect(on("2026-09-29")).toBe("autumn");
    expect(on("2026-02-20")).toBe("winter");
    expect(on("2026-05-12")).toBe("spring");
    expect(on("2026-07-28")).toBe("summer");
  });

  it("follows the choice made on the shared screen", () => {
    const d = new Date("2026-10-30T10:00:00");
    expect(resolveAmbience("off", d, "en")).toBeNull();
    expect(resolveAmbience("christmas", d, "en")?.key).toBe("christmas");
    expect(resolveAmbience("auto", d, "en")?.key).toBe("halloween");
    expect(resolveAmbience("unknown", d, "en")?.key).toBe("halloween");
    expect(resolveAmbience("auto", d, "fr")?.greeting).toBe("Joyeux Halloween : gare aux bugs zombies 🎃");
  });
});

describe("birthdays on the waiting screen", () => {
  const team = [
    { name: "Ines Moreau", birthday: "10-02" },
    { name: "Paul Martin", birthday: "09-27" },
    { name: "Lea Petit", birthday: "10-04" },
    { name: "No Date", birthday: null },
  ];
  const at = (iso: string) => new Date(iso + "T10:00:00");

  it("celebrates birthdays within 3 days, over 7 days in all", () => {
    expect(birthdaysAround(team, at("2026-09-30"))).toEqual(["Ines", "Paul"]);
    expect(birthdaysAround(team, at("2026-10-01"))).toEqual(["Ines", "Lea"]);
    expect(birthdaysAround(team, at("2026-10-08"))).toEqual([]);
    // Each birthday is seen exactly 7 days: a weekly meeting falls inside
    const days = [...Array(365)].filter((_, i) => birthdaysAround([team[0]!], new Date(2026, 0, 1 + i)).length).length;
    expect(days).toBe(7);
  });

  it("handles the new year and celebrates February 29 on the 28th", () => {
    expect(birthdaysAround([{ name: "Noah", birthday: "01-01" }], at("2026-12-30"))).toEqual(["Noah"]);
    expect(birthdaysAround([{ name: "Zoe", birthday: "12-31" }], at("2027-01-02"))).toEqual(["Zoe"]);
    expect(birthdaysAround([{ name: "Leo", birthday: "02-29" }], at("2027-02-25"))).toEqual(["Leo"]);
    expect(birthdaysAround([{ name: "Leo", birthday: "02-29" }], at("2027-03-04"))).toEqual([]);
  });

  it("wins over holidays in automatic mode, not when a theme is picked", () => {
    const d = at("2026-10-30");
    const bday = [{ name: "Ines Moreau", birthday: "10-31" }];
    expect(resolveAmbience("auto", d, "en", bday)).toMatchObject({ key: "birthday", greeting: "Happy birthday Ines! 🎂" });
    expect(
      resolveAmbience("auto", d, "en", [...bday, { name: "Paul", birthday: "11-01" }, { name: "Lea", birthday: "10-28" }])?.greeting,
    ).toBe("Happy birthday Ines, Paul, and Lea! 🎂");
    expect(
      resolveAmbience("auto", d, "fr", [...bday, { name: "Paul", birthday: "11-01" }, { name: "Lea", birthday: "10-28" }])?.greeting,
    ).toBe("Joyeux anniversaire Ines, Paul et Lea ! 🎂");
    expect(resolveAmbience("christmas", d, "en", bday)?.key).toBe("christmas");
    expect(resolveAmbience("off", d, "en", bday)).toBeNull();
    expect(resolveAmbience("birthday", d, "en", [])?.greeting).toBe("Happy birthday! 🎂");
  });
});

describe("typed sections", () => {
  it("reads and writes checklist items", () => {
    expect(taskOf("[x] Ship v2")).toEqual({ done: true, text: "Ship v2" });
    expect(taskOf("[ ] Review the MR")).toEqual({ done: false, text: "Review the MR" });
    expect(taskOf("No checkbox")).toEqual({ done: null, text: "No checkbox" });
    expect(taskItem("Deploy", true)).toBe("[x] Deploy");
    expect(plainItem("[ ] Deploy")).toBe("Deploy");
  });

  it("gives each section its input, list by default", () => {
    const secs = resolveSections(
      {
        sections: [
          { key: "done", label: "Achievements", role: "achievement", input: "list" },
          { key: "next", label: "", role: "plan", input: "checklist" },
          { key: "blockers", label: "", role: "blocker", input: "list" },
          { key: "research", label: "Research", role: "custom", input: "text" },
        ],
      },
      "en",
    );
    expect(secs.map((x) => [x.k, x.label, x.type])).toEqual([
      ["done", "Achievements", "list"],
      ["next", "Planned for next week", "checklist"],
      ["blockers", "Blockers to flag", "list"],
      ["x:research", "Research", "text"],
    ]);
  });

  it("renders checkboxes and free text in the minutes", () => {
    const rec = parseRecord({
      date: "2026-09-28",
      teamName: "Dev",
      startedAt: 0,
      endedAt: 60_000,
      durationMs: 60_000,
      spent: {},
      participants: [{ id: "m1", name: "Ines Moreau", jobCategory: "Engineering" }],
      absent: [],
      updates: {
        m1: {
          done: [],
          next: ["[x] Review the MR", "[ ] Deploy"],
          blockers: [],
          other: [],
          extra: { research: ["Read an article.\nTried Bun."] },
        },
      },
      notes: {},
      interactions: [],
      topics: [],
      actions: [],
      names: { m1: "Ines Moreau" },
      sections: [
        { k: "next", label: "Planned", kind: "next", type: "checklist" },
        { k: "x:research", label: "Research", kind: "extra", type: "text" },
      ],
    })!;
    const md = minutesMarkdown(rec, "en");
    expect(md).toContain("- ☑ Review the MR");
    expect(md).toContain("- ☐ Deploy");
    expect(md).toContain("**Research**\nRead an article.\nTried Bun.");
  });
});
