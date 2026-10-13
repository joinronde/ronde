import {
  ago,
  COMBO_WINDOW_MS,
  checkInFromItems,
  comboCount,
  comboThreshold,
  DEFAULT_SECTIONS,
  fmtMinutes,
  hostName,
  initials,
  isCheckInReady,
  isCheckInStale,
  itemsFromCheckIn,
  itemsOf,
  lines,
  matchesProjects,
  mmss,
  moodAverage,
  moodEmoji,
  nextMeetingDate,
  nextMonday,
  REACTION_EMOJIS,
  rebaseList,
  rebaseText,
  reminderDate,
  repoPath,
  resolveSections,
  signalCombo,
  similarity,
} from "@ronde/core/util";
import { describe, expect, it } from "vitest";

describe("util", () => {
  it("formats durations and overruns", () => {
    expect(mmss(125_000)).toBe("2:05");
    expect(mmss(-12_000)).toBe("+0:12");
  });

  it("finds the next Monday", () => {
    expect(nextMonday("2026-09-21")).toBe("2026-09-28");
    expect(nextMonday(null, new Date("2026-09-25T10:00:00"))).toBe("2026-09-28");
    expect(nextMonday(null, new Date("2026-09-28T10:00:00"))).toBe("2026-09-28");
  });

  it("computes the next meeting from the weekday and the frequency", () => {
    const monday = { meetingWeekday: 1, meetingEveryWeeks: 1 };
    const today = new Date("2026-09-23T10:00:00"); // Wednesday
    expect(nextMeetingDate(monday, null, today)).toBe("2026-09-28");
    expect(nextMeetingDate(monday, null, new Date("2026-09-28T10:00:00"))).toBe("2026-09-28");
    expect(nextMeetingDate(monday, "2026-09-28", today)).toBe("2026-10-05");
    expect(nextMeetingDate({ meetingWeekday: 1, meetingEveryWeeks: 2 }, "2026-09-28", today)).toBe("2026-10-12");
    // Meeting moved to a Tuesday: back to the usual day
    expect(nextMeetingDate(monday, "2026-09-29", today)).toBe("2026-10-05");
    expect(nextMeetingDate({ meetingWeekday: 4, meetingEveryWeeks: 1 }, null, today)).toBe("2026-09-24");
    // Skipped weeks: never a past date
    expect(nextMeetingDate(monday, "2026-08-31", today)).toBe("2026-09-28");
  });

  it("sends the reminder on the working day before or on the same day", () => {
    expect(reminderDate("2026-09-28", "dayBefore")).toBe("2026-09-25");
    expect(reminderDate("2026-09-29", "dayBefore")).toBe("2026-09-28");
    expect(reminderDate("2026-09-28", "sameDay")).toBe("2026-09-28");
  });

  it("tells apart a check-in kept during an absence", () => {
    const archivedAt = 1_000;
    expect(isCheckInStale({ done: ["a"], updatedAt: 500 }, archivedAt)).toBe(true);
    expect(isCheckInReady({ done: ["a"], updatedAt: 500 }, archivedAt)).toBe(false);
    expect(isCheckInReady({ done: ["a"], updatedAt: 1_500 }, archivedAt)).toBe(true);
    expect(isCheckInReady({ done: [], updatedAt: 1_500 }, archivedAt)).toBe(false);
    expect(isCheckInReady({ done: ["a"], updatedAt: 500 }, null)).toBe(true);
  });

  it("spots a blocker that comes back in other words", () => {
    expect(similarity("Access to the staging database still blocked", "No access to the staging database")).toBeGreaterThanOrEqual(0.5);
    expect(similarity("Icon licence", "Saturated runners")).toBe(0);
  });

  it("compares Chinese by pairs of characters, dates and numbers aside", () => {
    expect(similarity("跟进法务审批合同", "等待法务审批合同")).toBeGreaterThanOrEqual(0.5);
    // The same deadline is not the same task
    expect(similarity("3月15日前完成登录", "3月15日前提交报告")).toBeLessThan(0.5);
  });

  it("cleans lists and initials", () => {
    expect(lines(" a \n\n b ")).toEqual(["a", "b"]);
    expect(initials("Sarah N'Diaye")).toBe("SN");
  });

  it("says how old a date is, in each language", () => {
    const now = new Date("2026-10-05T12:00:00").getTime();
    expect(ago("2026-10-05", now, "en")).toBe("today");
    expect(ago("2026-10-04", now, "en")).toBe("yesterday");
    expect(ago("2026-09-28", now, "en")).toBe("7 days ago");
    expect(ago("2026-09-07", now, "en")).toBe("4 weeks ago");
    expect(ago("2026-10-04", now, "fr")).toBe("hier");
  });
});

describe("sections and mood", () => {
  it("renames, hides and adds sections, with defaults in the right language", () => {
    const settings = {
      sections: [
        { key: "done", label: "Achievements", role: "achievement" as const, input: "list" as const },
        { key: "next", label: "", role: "plan" as const, input: "list" as const },
        { key: "blockers", label: "", role: "blocker" as const, input: "list" as const },
        { key: "k1", label: "Research", role: "custom" as const, input: "list" as const },
      ],
    };
    const secs = resolveSections(settings, "en");
    expect(secs.map((x) => x.label)).toEqual(["Achievements", "Planned for next week", "Blockers to flag", "Research"]);
    expect(resolveSections(settings, "fr").map((x) => x.label)).toEqual([
      "Achievements",
      "Prévu semaine prochaine",
      "Difficultés à signaler",
      "Research",
    ]);
    expect(itemsOf({ done: ["a"], extra: { k1: ["b"] } }, secs[3]!)).toEqual(["b"]);
    expect(itemsOf({ done: ["a"] }, "done")).toEqual(["a"]);
  });

  it("gives a section the behaviour of its role, whatever its key", () => {
    const secs = resolveSections(
      {
        sections: [
          { key: "wins", label: "Wins", role: "achievement", input: "list" },
          { key: "risks", label: "Risks", role: "blocker", input: "text" },
          // A role already held: the section falls back to custom
          { key: "more", label: "More risks", role: "blocker", input: "list" },
        ],
      },
      "en",
    );
    expect(secs.map((x) => [x.k, x.kind, x.type])).toEqual([
      ["done", "done", "list"],
      ["blockers", "blockers", "text"],
      ["x:more", "extra", "list"],
    ]);
  });

  it("keeps a section's items when its role changes", () => {
    const before = [
      { key: "done", label: "", role: "achievement" as const, input: "list" as const },
      { key: "k9", label: "Risks", role: "custom" as const, input: "list" as const },
    ];
    const items = itemsFromCheckIn({ done: ["shipped"], next: [], blockers: [], other: [], extra: { k9: ["late vendor"] } }, before);
    expect(items).toEqual({ done: ["shipped"], k9: ["late vendor"] });
    const after = [before[0]!, { ...before[1]!, role: "blocker" as const }];
    expect(checkInFromItems(items, after)).toEqual({ done: ["shipped"], next: [], blockers: ["late vendor"], other: [], extra: {} });
  });

  it("starts new meetings with the weekly sync sections", () => {
    expect(resolveSections({ sections: DEFAULT_SECTIONS }, "en").map((x) => x.k)).toEqual(["done", "next", "blockers", "other"]);
  });

  it("computes the average mood", () => {
    expect(moodAverage([0, 0, 0, 0, 0])).toBeNull();
    expect(moodAverage([1, 0, 0, 0, 1])).toBe(3);
    expect(moodEmoji(4.4)).toBe("🌤️");
  });

  it("filters issues on the followed projects or groups", () => {
    const filter = "acme/platform/ci-templates, acme-labs";
    expect(matchesProjects("acme/platform/ci-templates#12", filter)).toBe(true);
    expect(matchesProjects("acme-labs/it/directory!3", filter)).toBe(true);
    expect(matchesProjects("acme/other#1", filter)).toBe(false);
    expect(matchesProjects("acme-labs-bis/x#1", filter)).toBe(false);
    expect(matchesProjects("any/thing#1", "")).toBe(true);
    // Project name alone
    expect(matchesProjects("acme/ronde#4", "ronde")).toBe(true);
  });

  it("formats target durations and the host name per language", () => {
    expect(fmtMinutes(45, "en")).toBe("45 min");
    expect(fmtMinutes(60, "en")).toBe("1 h");
    expect(fmtMinutes(105, "en")).toBe("1 h 45 min");
    expect(fmtMinutes(105, "fr")).toBe("1 h 45");
    expect(hostName({ hostLabel: "" }, "en")).toBe("Host");
    expect(hostName({ hostLabel: "" }, "fr")).toBe("Régisseur");
    expect(hostName({ hostLabel: " Julie " }, "fr")).toBe("Julie");
  });
});

describe("signals", () => {
  it("triggers a combo when enough different people send the same signal", () => {
    expect(comboThreshold(3)).toBe(2);
    expect(comboThreshold(6)).toBe(2);
    expect(comboThreshold(9)).toBe(3);
    const t = 100_000;
    const hits = [
      { emoji: "🥱", byId: "a", at: t - 5_000 },
      { emoji: "🥱", byId: "a", at: t - 3_000 },
      { emoji: "🍿", byId: "b", at: t - 2_000 },
    ];
    // The same person insisting only counts once
    expect(comboCount(hits, "🥱", t, 2)).toBe(0);
    expect(comboCount([...hits, { emoji: "🥱", byId: "b", at: t }], "🥱", t, 2)).toBe(2);
    // A signal too old leaves the window
    expect(
      comboCount(
        [
          { emoji: "🥱", byId: "c", at: t - COMBO_WINDOW_MS - 1 },
          { emoji: "🥱", byId: "b", at: t },
        ],
        "🥱",
        t,
        2,
      ),
    ).toBe(0);
  });

  it("accepts signals as reactions, with the speaker's first name in the combo", () => {
    expect(REACTION_EMOJIS).toContain("🍿");
    expect(new Set(REACTION_EMOJIS).size).toBe(REACTION_EMOJIS.length);
    expect(signalCombo("mindBlown", "Paul", "en")).toBe("Paul just blew the team's mind");
    expect(signalCombo("mindBlown", "Paul", "fr")).toBe("Paul a retourné le cerveau de l'équipe");
    expect(signalCombo("mindBlown", "", "en")).toBe("Minds blown!");
  });
});

describe("repository of a project link", () => {
  it("reads the path the forges use, whatever page of the repository the link opens", () => {
    expect(repoPath("gitlab", "https://gitlab.com/Acme/Platform/billing-api/-/issues?state=opened")).toBe("acme/platform/billing-api");
    expect(repoPath("gitlab", "https://git.example.org/acme/billing.git")).toBe("acme/billing");
    expect(repoPath("github", "https://github.com/acme/billing-api/pulls/12")).toBe("acme/billing-api");
    expect(repoPath("github", "https://github.com/acme")).toBeNull();
    expect(repoPath("gitlab", "not a link")).toBeNull();
  });
});

describe("rebasing a check-in being written onto a version saved elsewhere", () => {
  it("keeps what was added or removed here, and what the other side changed", () => {
    // Here: "b" removed, "d" added; there (the host): "c" removed, "e" added
    expect(rebaseList(["a", "b", "c"], ["a", "c", "d"], ["a", "b", "e"])).toEqual(["a", "e", "d"]);
    // An item ticked here, while the other side added one
    expect(rebaseList(["[ ] a"], ["[x] a"], ["[ ] a", "[ ] b"])).toEqual(["[ ] b", "[x] a"]);
    // Both sides added the same item: once
    expect(rebaseList([], ["a"], ["a"])).toEqual(["a"]);
  });

  it("gives a free text to the side that changed it, the one written here when both did", () => {
    expect(rebaseText("x", "x", "y")).toBe("y");
    expect(rebaseText("x", "z", "x")).toBe("z");
    expect(rebaseText("x", "z", "y")).toBe("z");
  });
});
