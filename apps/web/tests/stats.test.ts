import { toCsv } from "@ronde/core/csv";
import type { SessionStats, StatsDTO } from "@ronde/core/stats";
import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, niceStep, presence, sessionsCsv, statsKpis } from "@/lib/shared/stats";

// A meeting's statistics: the chart scale, the figures at the top and the spreadsheet of its sessions

const session = (date: string, patch: Partial<SessionStats> = {}): SessionStats => ({
  date,
  durationMs: 15 * 60_000,
  present: 5,
  absent: 0,
  absentNames: [],
  planned: 0,
  done: 0,
  blockers: 0,
  questions: 0,
  hands: 0,
  kudos: 0,
  answers: 0,
  mood: null,
  moodVotes: 0,
  rating: null,
  ratingVotes: 0,
  ...patch,
});
const stats = (sessions: SessionStats[], speaking: StatsDTO["speaking"] = []) => ({ sessions, speaking });

describe("the step of a chart's axis", () => {
  it("is a round number whose four steps reach the largest value", () => {
    expect(niceStep(1.05)).toBe(1);
    expect(niceStep(4)).toBe(1);
    expect(niceStep(4.2)).toBe(2);
    expect(niceStep(8.4)).toBe(5);
    expect(niceStep(21)).toBe(10);
    expect(niceStep(84)).toBe(25);
    expect(niceStep(2000)).toBe(500);
  });

  it("is a quarter of the value, rounded up, past the round numbers", () => {
    expect(niceStep(2001)).toBe(501);
    expect(niceStep(1_000_000)).toBe(250_000);
  });

  it("is 1 for nothing or less", () => {
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-5)).toBe(1);
  });

  it("is always enough: four steps reach the value", () => {
    for (const v of [0.5, 3, 7.7, 19.9, 33, 99, 101, 450, 1999, 2345, 98_765]) expect(niceStep(v) * 4).toBeGreaterThanOrEqual(v);
  });

  it("is not a number for one that is not", () => {
    expect(niceStep(Number.NaN)).toBeNaN();
  });
});

describe("the presence at a session", () => {
  it("is the share of those expected who came", () => {
    expect(presence({ present: 3, absent: 1 })).toBe(0.75);
    expect(presence({ present: 0, absent: 4 })).toBe(0);
  });

  it("is full when nobody was expected", () => {
    expect(presence({ present: 0, absent: 0 })).toBe(1);
  });
});

describe("the figures at the top", () => {
  it("skip the first session for planned → done: nothing was planned before it", () => {
    const k = statsKpis(stats([session("2026-10-01", { planned: 10, done: 0 }), session("2026-10-08", { planned: 4, done: 3 })]));
    expect(k.pdKnown.map((x) => x.date)).toEqual(["2026-10-08"]);
    expect(k.pdTotal).toBe(4);
    expect(k.pdRate).toBe(0.75);
  });

  it("weigh planned → done by the items planned, and skip sessions where nothing was", () => {
    const k = statsKpis(
      stats([
        session("2026-10-01"),
        session("2026-10-08", { planned: 1, done: 1 }),
        session("2026-10-15", { planned: 0, done: 2 }),
        session("2026-10-22", { planned: 9, done: 0 }),
      ]),
    );
    expect(k.pdKnown).toHaveLength(2);
    expect(k.pdRate).toBe(0.1);
  });

  it("go past 100% when more was done than planned", () => {
    expect(statsKpis(stats([session("a"), session("b", { planned: 2, done: 3 })])).pdRate).toBe(1.5);
  });

  it("have no planned → done rate with a single session", () => {
    const k = statsKpis(stats([session("2026-10-01", { planned: 5, done: 5 })]));
    expect(k).toMatchObject({ pdKnown: [], pdTotal: 0, pdRate: null });
  });

  it("average the presence per session, a small session counting as much as a big one", () => {
    const k = statsKpis(
      stats([session("a", { present: 1, absent: 1 }), session("b", { present: 10, absent: 0 }), session("c", { present: 0, absent: 0 })]),
    );
    expect(k.avgPres).toBeCloseTo((0.5 + 1 + 1) / 3);
  });

  it("average the duration over the sessions", () => {
    const k = statsKpis(stats([session("a", { durationMs: 10 * 60_000 }), session("b", { durationMs: 20 * 60_000 })]));
    expect(k.avgDur).toBe(15 * 60_000);
  });

  it("weigh the rating by the votes, not by the meetings", () => {
    const k = statsKpis(
      stats([
        session("a", { rating: 5, ratingVotes: 1 }),
        session("b", { rating: 2, ratingVotes: 3 }),
        session("c", { rating: null, ratingVotes: 4 }),
      ]),
    );
    // (5 × 1 + 2 × 3) / 4, the four votes of a session without a rating left out
    expect(k.ratingVotes).toBe(4);
    expect(k.ratingAvg).toBe(2.75);
  });

  it("have no rating when nobody rated", () => {
    expect(statsKpis(stats([session("a"), session("b", { rating: 4, ratingVotes: 0 })]))).toMatchObject({
      ratingVotes: 0,
      ratingAvg: null,
    });
  });

  it("weigh the speaking time by the turns of each person", () => {
    const k = statsKpis(
      stats(
        [session("a")],
        [
          { id: "p1", name: "Alice", avgMs: 60_000, turns: 1 },
          { id: "p2", name: "Bruno", avgMs: 120_000, turns: 3 },
        ],
      ),
    );
    expect(k.avgS).toBe(105_000);
  });

  it("have no speaking time without turns", () => {
    expect(statsKpis(stats([session("a")], [])).avgS).toBe(0);
    expect(statsKpis(stats([session("a")], [{ id: "p1", name: "Alice", avgMs: 60_000, turns: 0 }])).avgS).toBe(0);
  });

  it("give no NaN without any session (the page shows its empty state then)", () => {
    const k = statsKpis(stats([]));
    expect(k).toEqual({ avgDur: 0, avgS: 0, pdKnown: [], pdTotal: 0, pdRate: null, avgPres: 1, ratingVotes: 0, ratingAvg: null });
  });

  it("hold a hundred sessions", () => {
    const many = Array.from({ length: 100 }, (_, i) => session(`d${i}`, { planned: 2, done: i % 2 ? 2 : 0, rating: 4, ratingVotes: 2 }));
    const k = statsKpis(stats(many));
    expect(k.pdTotal).toBe(198);
    expect(k.pdRate).toBeCloseTo(100 / 198);
    expect(k.ratingAvg).toBe(4);
  });
});

describe("the sessions spreadsheet", () => {
  const head = ["Date", ...CSV_COLUMNS.map((c) => `csv.${c}`)];

  it("has a header line only when there is no session", () => {
    expect(sessionsCsv(stats([]), head)).toEqual([head]);
  });

  it("has one line per session, in the order of the columns", () => {
    const rows = sessionsCsv(
      stats([
        session("2026-10-13", {
          durationMs: 754_000,
          present: 6,
          absent: 2,
          planned: 7,
          done: 5,
          blockers: 1,
          questions: 2,
          hands: 3,
          kudos: 4,
          mood: 3.456,
          rating: 4.333333,
        }),
      ]),
      head,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(CSV_COLUMNS.length + 1);
    // 12 min 34 s is 12.6 minutes, to a tenth; mood and rating to two decimals
    expect(rows[1]).toEqual(["2026-10-13", 12.6, 6, 2, 7, 5, 1, 2, 3, 4, 3.46, 4.33]);
  });

  it("leaves the mood and the rating blank when none was given", () => {
    const [, row] = sessionsCsv(stats([session("2026-10-13")]), head);
    expect(row!.slice(-2)).toEqual([null, null]);
    expect(toCsv([row!], "en")).toBe("﻿2026-10-13,15,5,0,0,0,0,0,0,0,,\r\n");
  });

  it("rounds a very short session to zero minutes", () => {
    expect(sessionsCsv(stats([session("d", { durationMs: 2_999 })]), head)[1]![1]).toBe(0);
    expect(sessionsCsv(stats([session("d", { durationMs: 3_000 })]), head)[1]![1]).toBe(0.1);
  });

  it("is escaped when written: quotes, separators and line breaks in a column title stay in their cell", () => {
    const odd = ["Date, day", 'Say "hi"', "two\nlines"];
    expect(toCsv(sessionsCsv(stats([]), odd), "en")).toBe('﻿"Date, day","Say ""hi""","two\nlines"\r\n');
    // A spreadsheet in French splits on ";" and reads "12,6" as a number
    expect(toCsv(sessionsCsv(stats([session("2026-10-13", { durationMs: 754_000 })]), ["a;b"]), "fr")).toBe(
      '﻿"a;b"\r\n2026-10-13;12,6;5;0;0;0;0;0;0;0;;\r\n',
    );
  });

  it("defuses a column title that a spreadsheet would run as a formula", () => {
    const csv = toCsv(sessionsCsv(stats([]), ['=HYPERLINK("x")', "+1", "-1", "@SUM(A1)"]), "en");
    expect(csv).toBe('﻿"\'=HYPERLINK(""x"")",\'+1,\'-1,\'@SUM(A1)\r\n');
  });

  it("keeps right-to-left and other scripts as they are", () => {
    expect(toCsv(sessionsCsv(stats([]), ["التاريخ", "日期"]), "ar")).toBe("﻿التاريخ,日期\r\n");
  });
});
