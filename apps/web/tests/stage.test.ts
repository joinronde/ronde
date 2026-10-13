import type { Step } from "@ronde/core/meeting";
import type { CheckInFields, Section, Snapshot } from "@ronde/core/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  joinedOf,
  plannedStart,
  projectEntries,
  projectsWithTurn,
  sectionsHave,
  startTarget,
  waitLabel,
  waitTone,
} from "@/lib/shared/stage";

// What the stage computes from the meeting's state: the items about a project, who joined them, and when the
// meeting starts as the waiting pill words it

const done: Section = { k: "done", label: "Done", kind: "done" };
const next: Section = { k: "next", label: "Next", kind: "next" };
const risks: Section = { k: "x:risks", label: "Risks", kind: "extra" };
const fields = (patch: Partial<CheckInFields> = {}): CheckInFields => ({
  done: [],
  next: [],
  blockers: [],
  other: [],
  extra: {},
  ...patch,
});

// Every time zone test sets its own, then puts the runner's back
const zone = process.env.TZ;
afterEach(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});
const inZone = (tz: string) => {
  process.env.TZ = tz;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe("projects with a turn", () => {
  const step = (type: Step["type"], projectId?: string): Step => ({ type, key: `${type}-${projectId ?? ""}`, label: "", projectId });

  it("are none in an empty agenda", () => {
    expect(projectsWithTurn([]).size).toBe(0);
  });

  it("are the projects of the project steps only", () => {
    const agenda = [step("intro"), step("speaker"), step("project", "billing"), step("block"), step("project", "search"), step("end")];
    expect([...projectsWithTurn(agenda)]).toEqual(["billing", "search"]);
  });

  it("count a project with two steps once", () => {
    expect([...projectsWithTurn([step("project", "billing"), step("project", "billing")])]).toEqual(["billing"]);
  });
});

describe("people who joined an item", () => {
  const item = { ownerId: "alice", projectId: null, section: "done", text: "Shipped the invoices" };
  const joined = (patch: Partial<Snapshot["contributors"][number]>) => ({
    ownerId: "alice",
    projectId: null,
    section: "done",
    itemText: "Shipped the invoices",
    personId: "bruno",
    ...patch,
  });

  it("are nobody without contributors", () => {
    expect(joinedOf({ contributors: [] }, item)).toEqual([]);
  });

  it("are listed in the order they joined", () => {
    const s = { contributors: [joined({ personId: "bruno" }), joined({ personId: "chloe" }), joined({ personId: "david" })] };
    expect(joinedOf(s, item)).toEqual(["bruno", "chloe", "david"]);
  });

  it("joined this very item: same author, project tab, section and text", () => {
    const s = {
      contributors: [
        joined({ personId: "bruno" }),
        joined({ personId: "x1", ownerId: "chloe" }),
        joined({ personId: "x2", projectId: "billing" }),
        joined({ personId: "x3", section: "next" }),
        joined({ personId: "x4", itemText: "Shipped the invoices " }),
        joined({ personId: "x5", itemText: "[x] Shipped the invoices" }),
      ],
    };
    expect(joinedOf(s, item)).toEqual(["bruno"]);
    // The same text in a project's tab is another item
    expect(joinedOf(s, { ...item, projectId: "billing" })).toEqual(["x2"]);
  });

  it("match emoji and right-to-left text exactly", () => {
    const text = "أنهينا الفواتير 🎉";
    const s = { contributors: [joined({ itemText: text, personId: "omar" }), joined({ itemText: "أنهينا الفواتير", personId: "x" })] };
    expect(joinedOf(s, { ...item, text })).toEqual(["omar"]);
  });

  it("keep a person who appears twice twice, as the server sent them", () => {
    const s = { contributors: [joined({ personId: "bruno" }), joined({ personId: "bruno" })] };
    expect(joinedOf(s, item)).toEqual(["bruno", "bruno"]);
  });
});

describe("items written about a project", () => {
  const about = (byProject: Record<string, CheckInFields>) => ({ byProject });

  it("are none when nobody wrote", () => {
    expect(projectEntries({}, [], "billing", done)).toEqual([]);
    expect(projectEntries({}, ["alice", "bruno"], "billing", done)).toEqual([]);
  });

  it("follow the speaking order, then the others who wrote", () => {
    const checkIns = {
      chloe: about({ billing: fields({ done: ["Refunds"] }) }),
      alice: about({ billing: fields({ done: ["Invoices", "Receipts"] }) }),
      bruno: about({ billing: fields({ done: ["Taxes"] }) }),
    };
    expect(projectEntries(checkIns, ["bruno", "alice"], "billing", done)).toEqual([
      { ownerId: "bruno", text: "Taxes" },
      { ownerId: "alice", text: "Invoices" },
      { ownerId: "alice", text: "Receipts" },
      { ownerId: "chloe", text: "Refunds" },
    ]);
  });

  it("list each person once, even twice in the order", () => {
    const checkIns = { alice: about({ billing: fields({ done: ["Invoices"] }) }) };
    expect(projectEntries(checkIns, ["alice", "alice"], "billing", done)).toEqual([{ ownerId: "alice", text: "Invoices" }]);
  });

  it("keep only the project and the section asked for", () => {
    const checkIns = {
      alice: about({ billing: fields({ done: ["Invoices"], next: ["Taxes"] }), search: fields({ done: ["Index"] }) }),
      bruno: about({}),
    };
    expect(projectEntries(checkIns, [], "billing", next)).toEqual([{ ownerId: "alice", text: "Taxes" }]);
    expect(projectEntries(checkIns, [], "unknown", done)).toEqual([]);
  });

  it("read the team's own sections, and keep duplicates and checklist marks", () => {
    const checkIns = { alice: about({ billing: fields({ extra: { risks: ["[ ] Audit", "[ ] Audit", "مراجعة"] } }) }) };
    expect(projectEntries(checkIns, [], "billing", risks).map((e) => e.text)).toEqual(["[ ] Audit", "[ ] Audit", "مراجعة"]);
  });

  it("hold fifty people", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `p${String(i).padStart(2, "0")}`);
    const checkIns = Object.fromEntries(ids.map((id) => [id, about({ billing: fields({ done: [`Line of ${id}`] }) })]));
    const order = [...ids].reverse();
    expect(projectEntries(checkIns, order, "billing", done).map((e) => e.ownerId)).toEqual(order);
  });
});

describe("the highlighted text", () => {
  it("is not found without a check-in or without sections", () => {
    expect(sectionsHave(undefined, [done], "Invoices")).toBe(false);
    expect(sectionsHave(fields({ done: ["Invoices"] }), [], "Invoices")).toBe(false);
  });

  it("is found in any of the sections shown", () => {
    const f = fields({ next: ["Taxes"], extra: { risks: ["Audit"] } });
    expect(sectionsHave(f, [done, next], "Taxes")).toBe(true);
    expect(sectionsHave(f, [done, risks], "Audit")).toBe(true);
    // A section that is not shown does not count
    expect(sectionsHave(f, [done], "Taxes")).toBe(false);
  });

  it("is compared without the checklist mark, but otherwise exactly", () => {
    const f = fields({ done: ["[x] Invoices", "[ ] Receipts"] });
    expect(sectionsHave(f, [done], "Invoices")).toBe(true);
    expect(sectionsHave(f, [done], "Receipts")).toBe(true);
    expect(sectionsHave(f, [done], "[x] Invoices")).toBe(false);
    expect(sectionsHave(f, [done], "invoices")).toBe(false);
    expect(sectionsHave(f, [done], "Invoices ")).toBe(false);
  });

  it("matches right-to-left text and emoji", () => {
    const f = fields({ done: ["[x] أنهينا الفواتير 🎉"] });
    expect(sectionsHave(f, [done], "أنهينا الفواتير 🎉")).toBe(true);
  });
});

describe("the planned start", () => {
  it("reads the date and time in the browser's time zone", () => {
    inZone("Europe/Paris");
    expect(startTarget("2026-10-13", "09:30")).toBe(Date.UTC(2026, 9, 13, 7, 30));
    inZone("America/New_York");
    expect(startTarget("2026-10-13", "09:30")).toBe(Date.UTC(2026, 9, 13, 13, 30));
    inZone("Asia/Kolkata");
    expect(startTarget("2026-10-13", "09:30")).toBe(Date.UTC(2026, 9, 13, 4, 0));
  });

  it("falls on the day before in UTC far east of Greenwich", () => {
    inZone("Pacific/Kiritimati");
    expect(startTarget("2026-10-13", "09:30")).toBe(Date.UTC(2026, 9, 12, 19, 30));
  });

  it("covers the whole day, midnight to one minute before the next", () => {
    inZone("UTC");
    expect(startTarget("2026-12-31", "00:00")).toBe(Date.UTC(2026, 11, 31, 0, 0));
    expect(startTarget("2026-12-31", "23:59")).toBe(Date.UTC(2026, 11, 31, 23, 59));
    expect(startTarget("2028-02-29", "12:00")).toBe(Date.UTC(2028, 1, 29, 12, 0));
  });

  it("moves a time the clocks skip forward an hour, and takes the first of a time they repeat", () => {
    inZone("Europe/Paris");
    // 02:30 does not exist on 29 March 2026 in Paris: it is 03:30 summer time
    expect(startTarget("2026-03-29", "02:30")).toBe(Date.UTC(2026, 2, 29, 1, 30));
    // 02:30 happens twice on 25 October 2026: the first one, still summer time
    expect(startTarget("2026-10-25", "02:30")).toBe(Date.UTC(2026, 9, 25, 0, 30));
  });

  it("keeps the time on a day whose midnight does not exist", () => {
    // Chile moves to summer time at midnight: the day starts at one, the meeting stays at 09:30
    inZone("America/Santiago");
    expect(startTarget("2026-09-06", "09:30")).toBe(Date.UTC(2026, 8, 6, 12, 30));
    expect(startTarget("2026-09-06", "00:00")).toBe(Date.UTC(2026, 8, 6, 4, 0));
  });

  it("reads an hour without minutes, a blank time as midnight, and nothing from garbage", () => {
    // The server only stores "HH:MM"; these show what the parsing would do otherwise
    inZone("UTC");
    expect(startTarget("2026-10-13", "9")).toBe(Date.UTC(2026, 9, 13, 9, 0));
    expect(startTarget("2026-10-13", "")).toBe(Date.UTC(2026, 9, 13, 0, 0));
    expect(startTarget("2026-10-13", "9h30")).toBeNaN();
    expect(startTarget("", "09:30")).toBeNaN();
  });

  it("is the instant the schedule set when there is one, whatever the browser's zone", () => {
    inZone("Asia/Tokyo");
    const at = Date.UTC(2026, 9, 13, 7, 30);
    expect(plannedStart({ date: "2026-10-13", time: "09:30", plannedAt: at })).toBe(at);
    // Even the epoch is an instant, not a missing one
    expect(plannedStart({ date: "2026-10-13", time: "09:30", plannedAt: 0 })).toBe(0);
    expect(plannedStart({ date: "2026-10-13", time: "09:30", plannedAt: null })).toBe(Date.UTC(2026, 9, 13, 0, 30));
  });
});

describe("the waiting pill", () => {
  const meeting = { date: "2026-10-13", time: "09:30" };
  const t = (key: string, values?: Record<string, string | number>) => (values ? `${key} ${JSON.stringify(values)}` : key);
  const label = (ms: number, locale = "en") => waitLabel(ms, meeting, locale, t);

  it("stops announcing a start long gone", () => {
    expect(label(-30 * MINUTE)).toBe("waitingForStart");
    expect(label(-3 * 24 * HOUR)).toBe("waitingForStart");
    expect(label(-Infinity)).toBe("waitingForStart");
    expect(waitTone(-30 * MINUTE)).toBe("");
  });

  it("says it is starting from the start to half an hour late", () => {
    expect(label(-30 * MINUTE + 1)).toBe("startingNow");
    expect(label(0)).toBe("startingNow");
    expect(waitTone(-30 * MINUTE + 1)).toBe(" late");
    expect(waitTone(0)).toBe(" late");
  });

  it("counts the last minute in seconds, rounded up", () => {
    expect(label(1)).toBe('startsInSeconds {"s":1}');
    expect(label(1_001)).toBe('startsInSeconds {"s":2}');
    expect(label(MINUTE)).toBe('startsInSeconds {"s":60}');
  });

  it("counts the last hour in minutes, rounded up", () => {
    expect(label(MINUTE + 1)).toBe('startsInMinutes {"m":2}');
    expect(label(HOUR)).toBe('startsInMinutes {"m":60}');
  });

  it("turns soon in the last five minutes", () => {
    expect(waitTone(1)).toBe(" soon");
    expect(waitTone(5 * MINUTE)).toBe(" soon");
    expect(waitTone(5 * MINUTE + 1)).toBe("");
    expect(waitTone(Infinity)).toBe("");
  });

  it("gives the time within twelve hours", () => {
    expect(label(HOUR + 1)).toBe('startsAt {"time":"09:30"}');
    expect(label(12 * HOUR)).toBe('startsAt {"time":"09:30"}');
  });

  it("gives the weekday further ahead, capitalised where the script has capitals", () => {
    inZone("UTC");
    const far = 12 * HOUR + 1;
    expect(label(far, "en")).toBe("Tuesday · 09:30");
    expect(label(far, "fr")).toBe("Mardi · 09:30");
    expect(label(far, "ru")).toBe("Вторник · 09:30");
    expect(label(far, "pt")).toBe("Terça-feira · 09:30");
    expect(label(far, "it")).toBe("Martedì · 09:30");
    expect(label(far, "ar")).toBe("الثلاثاء · 09:30");
    expect(label(far, "zh")).toBe("星期二 · 09:30");
    expect(label(far, "hi")).toBe("मंगलवार · 09:30");
  });

  it("names the meeting's own day in any time zone", () => {
    for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "America/Santiago", "Asia/Kolkata"]) {
      inZone(tz);
      expect(label(24 * HOUR, "en")).toBe("Tuesday · 09:30");
    }
  });

  it("falls back to the weekday when the start cannot be read", () => {
    // A start that is not a number compares false everywhere: the pill names the day rather than a countdown
    inZone("UTC");
    expect(label(Number.NaN)).toBe("Tuesday · 09:30");
    expect(waitTone(Number.NaN)).toBe("");
  });
});
