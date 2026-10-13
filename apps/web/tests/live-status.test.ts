import type { Step } from "@ronde/core/meeting";
import type { MeetingDTO } from "@ronde/core/types";
import { afterEach, describe, expect, it } from "vitest";
import { type LiveInput, liveStatus, plannedStartOf } from "@/lib/shared/live-status";

// Where the meeting stands for a participant: the bar before the start, the live step, when their turn comes

const NOW = Date.UTC(2026, 9, 13, 12, 0);
const speaker = (id: string, label: string, limitMs?: number): Step => ({ type: "speaker", key: id, id, label, limitMs });
/** An intro, five speakers, then the end */
const agenda: Step[] = [
  { type: "intro", key: "intro", label: "Intro" },
  speaker("alice", "Alice Martin"),
  speaker("bruno", "Bruno Costa"),
  speaker("chloe", "Chloé Dubois"),
  speaker("dan", "Dan Weber"),
  speaker("eve", "Eve Rossi"),
  { type: "end", key: "end", label: "End" },
];
const meeting = (patch: Partial<MeetingDTO> = {}): MeetingDTO =>
  ({
    date: "2026-10-13",
    time: "14:00",
    plannedAt: NOW,
    startedAt: NOW - 60_000,
    stepKey: "alice",
    spent: {},
    bonus: {},
    timer: { running: true, startedAt: NOW - 20_000, baseMs: 5_000 },
    ...patch,
  }) as unknown as MeetingDTO;
const t = (k: string) => `<${k}>`;
const input = (patch: Partial<LiveInput> = {}): LiveInput => ({
  m: meeting(),
  agenda,
  cur: 1,
  now: NOW,
  hydrated: true,
  me: "bruno",
  speakSec: 60,
  t,
  ...patch,
});
const waiting = (patch: Partial<LiveInput> = {}) => input({ m: meeting({ startedAt: null }), cur: 0, ...patch });

describe("the live status", () => {
  it("is nothing without a meeting or a current step", () => {
    expect(liveStatus(input({ m: null }))).toEqual({ state: "none", title: "" });
    expect(liveStatus(input({ cur: 99 }))).toEqual({ state: "none", title: "" });
    expect(liveStatus(input({ agenda: [] }))).toEqual({ state: "none", title: "" });
  });

  it("is ended on the last step", () => {
    expect(liveStatus(input({ cur: 6 }))).toEqual({ state: "ended", title: "" });
  });

  it("names the speaker by first name and their place in the round", () => {
    expect(liveStatus(input())).toMatchObject({ state: "live", label: "Alice · 1/5", current: "Alice" });
    expect(liveStatus(input({ cur: 5, me: null }))).toMatchObject({ label: "Eve · 5/5", current: "Eve" });
  });

  it("shows another step by its label, with nobody speaking and no timer", () => {
    expect(liveStatus(input({ cur: 0 }))).toMatchObject({ label: "Intro", current: null, rem: null });
  });

  it("keeps a right-to-left first name as written", () => {
    const rtl = [speaker("layla", "ليلى حسن")];
    expect(liveStatus(input({ agenda: rtl, cur: 0, me: null }))).toMatchObject({ label: "ليلى · 1/1", current: "ليلى" });
  });
});

describe("the time left to the speaker", () => {
  const remOf = (x: LiveInput) => {
    const s = liveStatus(x);
    return s.state === "live" ? s.rem : undefined;
  };

  it("is their speaking time, plus the time given, less the time spent", () => {
    // 60 s + 30 s given, 5 s before a pause and 20 s since
    expect(remOf(input({ m: meeting({ bonus: { alice: 30_000 } }) }))).toBe(65_000);
  });

  it("follows the time the agenda plans for that step", () => {
    const planned = agenda.map((x) => (x.key === "alice" ? speaker("alice", "Alice Martin", 120_000) : x));
    expect(remOf(input({ agenda: planned }))).toBe(95_000);
  });

  it("goes negative once over", () => {
    expect(remOf(input({ m: meeting({ timer: { running: false, startedAt: null, baseMs: 75_000 } }) }))).toBe(-15_000);
  });
});

describe("the viewer's turn", () => {
  const turnOf = (me: string | null, cur = 1) => {
    const s = liveStatus(input({ me, cur }));
    return s.state === "live" ? { turn: s.turn, before: s.before } : null;
  };

  it("is theirs while they speak", () => {
    expect(turnOf("alice")).toEqual({ turn: "mine", before: 0 });
  });

  it("is next when only the current speaker is before them", () => {
    expect(turnOf("bruno")).toEqual({ turn: "next", before: 1 });
  });

  it("is soon with one or two people still to speak before them", () => {
    expect(turnOf("chloe")).toEqual({ turn: "soon", before: 2 });
    expect(turnOf("dan")).toEqual({ turn: "soon", before: 3 });
  });

  it("is not announced with more people before them", () => {
    expect(turnOf("eve")).toEqual({ turn: null, before: 4 });
  });

  it("is next for the first speaker during the intro, nobody speaking before them", () => {
    expect(turnOf("alice", 0)).toEqual({ turn: "next", before: 0 });
    expect(turnOf("bruno", 0)).toEqual({ turn: "soon", before: 1 });
  });

  it("is past once they spoke, and nothing for someone outside the round", () => {
    expect(turnOf("alice", 3)).toEqual({ turn: null, before: 0 });
    expect(turnOf("olivia")).toEqual({ turn: null, before: 0 });
    expect(turnOf(null)).toEqual({ turn: null, before: 0 });
  });

  it("counts only the speakers in between, not the other steps", () => {
    const withBreak: Step[] = [agenda[1]!, { type: "misc", key: "break", label: "Break" }, agenda[2]!, agenda[3]!];
    const s = liveStatus(input({ agenda: withBreak, cur: 0, me: "chloe" }));
    expect(s).toMatchObject({ turn: "soon", before: 2 });
  });
});

describe("the browser tab's title", () => {
  it("says it is the viewer's turn", () => {
    expect(liveStatus(input({ me: "alice" })).title).toBe("👉 <yourTurnTitle> — Ronde");
  });

  it("names the step, and says the viewer is next", () => {
    expect(liveStatus(input({ me: "bruno" })).title).toBe("🔴 Alice · 1/5 · <youreNext> — Ronde");
    expect(liveStatus(input({ me: "eve" })).title).toBe("🔴 Alice · 1/5 — Ronde");
  });

  it("is left alone before the start and before the page has its clock", () => {
    expect(liveStatus(input({ hydrated: false })).title).toBe("");
    expect(liveStatus(waiting({ now: NOW - 60_000 })).title).toBe("");
  });
});

describe("before the start", () => {
  it("shows the bar from a quarter of an hour before the planned time", () => {
    expect(liveStatus(waiting({ now: NOW - 15 * 60_000 - 1 })).state).toBe("none");
    expect(liveStatus(waiting({ now: NOW - 15 * 60_000 }))).toMatchObject({ state: "waiting", turn: null, rem: null, title: "" });
    // Late: it stays
    expect(liveStatus(waiting({ now: NOW + 3_600_000 })).state).toBe("waiting");
  });

  it("waits for the browser's clock", () => {
    expect(liveStatus(waiting({ now: NOW, hydrated: false })).state).toBe("none");
  });

  it("counts who speaks before the viewer, without announcing a turn", () => {
    expect(liveStatus(waiting({ now: NOW, me: "chloe" }))).toMatchObject({ before: 2, turn: null });
  });
});

describe("the planned start", () => {
  const tz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = tz;
  });
  const at = (date: string, time: string, zone: string) => {
    process.env.TZ = zone;
    return new Date(plannedStartOf({ date, time, plannedAt: null })).toISOString();
  };

  it("is the instant the server planned, when it has one", () => {
    expect(plannedStartOf({ date: "2000-01-01", time: "09:00", plannedAt: 1234 })).toBe(1234);
  });

  it("is otherwise the local date and time of the browser", () => {
    expect(at("2026-10-13", "14:00", "Europe/Paris")).toBe("2026-10-13T12:00:00.000Z");
    expect(at("2026-10-13", "14:00", "Asia/Kolkata")).toBe("2026-10-13T08:30:00.000Z");
    expect(at("2026-10-13", "14:00", "America/New_York")).toBe("2026-10-13T18:00:00.000Z");
  });

  it("can fall on the previous or next day in UTC", () => {
    expect(at("2026-10-13", "00:30", "Pacific/Kiritimati")).toBe("2026-10-12T10:30:00.000Z");
    expect(at("2026-10-13", "23:30", "Pacific/Pago_Pago")).toBe("2026-10-14T10:30:00.000Z");
  });

  it("moves past an hour skipped by daylight saving, and takes the first of an hour repeated", () => {
    expect(at("2026-03-29", "02:30", "Europe/Paris")).toBe("2026-03-29T01:30:00.000Z");
    expect(at("2026-10-25", "02:30", "Europe/Paris")).toBe("2026-10-25T00:30:00.000Z");
  });

  it("is midnight for a blank time", () => {
    // The 14:00 default never applies: "".split(":") gives [""], read as 0
    expect(at("2026-10-13", "", "UTC")).toBe("2026-10-13T00:00:00.000Z");
  });
});
