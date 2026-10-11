import type { BlockData } from "@ronde/core/agenda";
import { agendaSchema } from "@ronde/core/agenda";
import { baseKeyOf, buildAgenda, currentIndex, elapsedOf, limitOf, projectOfKey, spentOf, transition } from "@ronde/core/meeting";
import type { InteractionDTO, MeetingDTO, MemberDTO } from "@ronde/core/types";
import { describe, expect, it } from "vitest";

const member = (id: string, name: string): MemberDTO => ({
  id,
  name,
  email: `${id}@example.com`,
  jobCategory: "Engineering",
  role: "participant",
  color: 0,
  position: 0,
  active: true,
  remind: true,
  gitlabUsername: null,
  githubUsername: null,
  birthday: null,
  avatarVer: null,
});
const members = { a: member("a", "Alice Martin"), b: member("b", "Bruno Petit"), c: member("c", "Chloe Roy") };
const meeting = (p: Partial<MeetingDTO> = {}): MeetingDTO => ({
  date: "2026-09-28",
  time: "14:00",
  plannedAt: null,
  durationMin: 30,
  occurrenceKey: null,
  assignments: {},
  stepKey: "intro",
  order: ["a", "b", "c"],
  projectOrder: [],
  projectsAdded: [],
  absent: [],
  spent: {},
  bonus: {},
  timer: { running: false, startedAt: null, baseMs: 0 },
  startedAt: null,
  endedAt: null,
  icebreaker: null,
  spotlight: null,
  draw: null,
  ...p,
});
const hand = (stepKey: string, resolved = false): InteractionDTO => ({
  id: "i" + stepKey,
  type: "hand",
  byId: "c",
  targetId: null,
  text: "",
  stepKey,
  resolved,
  createdAt: 0,
});

describe("buildAgenda", () => {
  it("chains intro, present people, open topics and wrap-up", () => {
    const ag = buildAgenda(meeting({ absent: ["b"] }), members, [], "en");
    expect(ag.map((s) => s.key)).toEqual(["intro", "a", "c", "misc", "end"]);
    expect(ag.map((s) => s.label)).toEqual(["Intro", "Alice Martin", "Chloe Roy", "Open topics", "Wrap-up"]);
  });

  it("labels the steps in the requested language", () => {
    const ag = buildAgenda(meeting(), members, [], "fr");
    expect(ag.find((s) => s.key === "misc")?.label).toBe("Points divers");
    expect(ag.find((s) => s.key === "end")?.label).toBe("Clôture");
  });

  it("inserts a Questions step after the person who received a raised hand", () => {
    const ag = buildAgenda(meeting(), members, [hand("a"), hand("a", true)], "en");
    expect(ag.map((s) => s.key)).toEqual(["intro", "a", "qa:a", "b", "c", "misc", "end"]);
    expect(ag[2]).toMatchObject({ type: "qa", of: "a", pending: 1, total: 2 });
  });

  it("ignores deleted members", () => {
    const ag = buildAgenda(meeting({ order: ["a", "zz"] }), members, [], "en");
    expect(ag.map((s) => s.key)).toEqual(["intro", "a", "misc", "end"]);
  });
});

describe("timer", () => {
  it("adds the base time and the time elapsed since the start", () => {
    const m = meeting({ stepKey: "a", timer: { running: true, startedAt: 1_000, baseMs: 5_000 } });
    expect(elapsedOf(m, 4_000)).toBe(8_000);
    expect(spentOf(m, "a", 4_000)).toBe(8_000);
    expect(spentOf({ ...m, spent: { b: 42 } }, "b", 4_000)).toBe(42);
  });

  it("stores the time of the step left and resumes the time of the step joined", () => {
    const m = meeting({ stepKey: "a", spent: { b: 30_000 }, timer: { running: true, startedAt: 0, baseMs: 0 } });
    const ag = buildAgenda(m, members, [], "en");
    const next = transition(m, ag.find((s) => s.key === "b")!, 90_000, true);
    expect(next.spent.a).toBe(90_000);
    expect(next.timer).toEqual({ running: true, startedAt: 90_000, baseMs: 30_000 });
    expect(next.startedAt).toBe(90_000);
  });

  it("keeps running on steps that are not turns, and stops at the wrap-up", () => {
    const m = meeting({ stepKey: "a", timer: { running: true, startedAt: 0, baseMs: 0 } });
    const ag = buildAgenda(m, members, [], "en");
    expect(transition(m, ag.find((s) => s.key === "b")!, 10, false).timer.running).toBe(false);
    expect(transition(m, ag.find((s) => s.key === "misc")!, 10, false).timer.running).toBe(true);
    const end = transition(m, ag.find((s) => s.key === "end")!, 10, true);
    expect(end.timer.running).toBe(false);
    expect(end.endedAt).toBe(10);
  });
});

describe("step keys", () => {
  it("attaches wrap-up and questions reactions to the right step", () => {
    expect(baseKeyOf("qa:a")).toBe("a");
    expect(baseKeyOf("end")).toBe("misc");
    expect(baseKeyOf("b")).toBe("b");
  });

  it("finds the base step when the Questions step is gone", () => {
    const ag = buildAgenda(meeting(), members, [], "en");
    expect(currentIndex(ag, "qa:b")).toBe(2);
    expect(currentIndex(ag, "unknown")).toBe(0);
  });
});

describe("agenda blocks", () => {
  const data = {
    retro: {
      reflectMin: 7,
      voteMin: 3,
      discussMin: 5,
      groups: [
        { id: "g1", title: "Slow deploys", votes: 1, position: 0 },
        { id: "g2", title: "Flaky tests", votes: 4, position: 1 },
        { id: "g3", title: "Nothing voted", votes: 0, position: 2 },
      ],
    },
  };

  it("expands a retro into its phases, one discussion per voted group, most voted first", () => {
    const ag = buildAgenda(
      meeting(),
      members,
      [],
      "en",
      [
        { id: "intro", type: "intro" },
        { id: "retro", type: "retro" },
      ],
      data,
    );
    expect(ag.map((s) => s.key)).toEqual([
      "intro",
      "retro:reflect",
      "retro:group",
      "retro:vote",
      "retro:discuss:g2",
      "retro:discuss:g1",
      "retro:done",
      "end",
    ]);
    expect(ag[1]).toMatchObject({ type: "block", block: "retro", sub: "reflect", limitMs: 7 * 60_000 });
    expect(ag[4]).toMatchObject({ label: "Discuss: Flaky tests", limitMs: 5 * 60_000 });
  });

  it("gives a timebox its own duration, and the default agenda the usual steps", () => {
    const ag = buildAgenda(meeting(), members, [], "fr", [{ id: "tb1", type: "timebox", title: "Budget 2027", minutes: 12 }]);
    expect(ag.map((s) => [s.key, s.label])).toEqual([
      ["tb1", "Budget 2027"],
      ["end", "Clôture"],
    ]);
    expect(limitOf(meeting(), "tb1", 120, ag[0])).toBe(12 * 60_000);
    expect(limitOf(meeting(), "a", 120)).toBe(120_000);
    const types = buildAgenda(meeting(), members, [], "en").map((s) => s.type);
    expect([types[0], ...types.slice(-2)]).toEqual(["intro", "misc", "end"]);
    expect(types.slice(1, -2).every((x) => x === "speaker")).toBe(true);
  });

  it("leaves a retro out until its data is known", () => {
    expect(buildAgenda(meeting(), members, [], "en", [{ id: "retro", type: "retro" }]).map((s) => s.key)).toEqual(["end"]);
  });
});

describe("project round", () => {
  const project = (id: string, p: Partial<NonNullable<BlockData["projects"]>["list"][number]> = {}) => ({
    id,
    name: id.toUpperCase(),
    health: null,
    themePosition: null,
    position: 0,
    memberIds: [],
    authorIds: [],
    filled: false,
    ...p,
  });
  const data: BlockData = {
    projects: {
      speakSec: 60,
      list: [
        project("p1", { position: 0, memberIds: ["a", "c"], health: "onTrack", themePosition: 1, filled: true }),
        project("p2", { position: 1, memberIds: ["b"], health: "offTrack", themePosition: 0, filled: true }),
        project("p3", { position: 2, health: "atRisk" }),
        project("p4", { position: 3, filled: true, authorIds: ["zz"] }),
        project("p5", { position: 4, memberIds: ["a"], health: "onTrack" }),
      ],
    },
  };
  const round = (order: "manual" | "theme" | "health", m = meeting(), perProjectSec?: number) =>
    buildAgenda(m, members, [], "en", [{ id: "projects", type: "projects", order, ...(perProjectSec ? { perProjectSec } : {}) }], data);

  it("gives each project with a sheet or items a step, where its members present speak together", () => {
    const ag = round("manual", meeting({ absent: ["c"] }));
    expect(ag.map((s) => s.key)).toEqual(["p:p1", "p:p2", "p:p4", "end"]);
    expect(ag[0]).toMatchObject({ type: "project", projectId: "p1", label: "P1", speakers: ["a"], limitMs: 60_000 });
    // Nobody present on it, but its sheet is written: it still has its step
    expect(ag[2]).toMatchObject({ speakers: [], limitMs: 60_000 });
    // Its people are present, but nobody wrote anything about it (p5): no step, nothing to show…
    // …unless it is being presented: emptied meanwhile, it keeps its step (the meeting does not jump back)
    expect(round("manual", meeting({ stepKey: "p:p5" })).map((s) => s.key)).toContain("p:p5");
    expect(round("manual", meeting({ stepKey: "qa:p:p5" })).map((s) => s.key)).toContain("p:p5");
    // The host presents it anyway, for this session
    expect(round("manual", meeting({ projectsAdded: ["p5"] })).map((s) => s.key)).toEqual(["p:p1", "p:p2", "p:p4", "p:p5", "end"]);
    // Added on the fly, it comes after the projects with something written, whatever its usual place
    expect(round("manual", meeting({ projectsAdded: ["p3"] })).map((s) => s.key)).toEqual(["p:p1", "p:p2", "p:p4", "p:p3", "end"]);
    expect(round("manual")[0]).toMatchObject({ speakers: ["a", "c"], limitMs: 120_000 });
    expect(round("manual", meeting(), 300)[0]!.limitMs).toBe(300_000);
  });

  it("orders the projects by theme, by health (the ones in trouble first), or as the host chose this session", () => {
    expect(round("theme").map((s) => s.key)).toEqual(["p:p2", "p:p1", "p:p4", "end"]);
    expect(round("health").map((s) => s.key)).toEqual(["p:p2", "p:p1", "p:p4", "end"]);
    expect(round("manual", meeting({ projectOrder: ["p4", "p2"] })).map((s) => s.key)).toEqual(["p:p4", "p:p2", "p:p1", "end"]);
  });

  it("follows a project with its questions, and finds the project of a step", () => {
    const ag = buildAgenda(meeting(), members, [hand("p:p2")], "en", [{ id: "projects", type: "projects", order: "manual" }], data);
    expect(ag.map((s) => s.key)).toEqual(["p:p1", "p:p2", "qa:p:p2", "p:p4", "end"]);
    expect(projectOfKey("qa:p:p2")).toBe("p2");
    expect(projectOfKey("p:p1")).toBe("p1");
    expect(projectOfKey("a")).toBeNull();
    expect(baseKeyOf("qa:p:p2")).toBe("p:p2");
  });

  it("starts the timer of a project like a turn", () => {
    const step = round("manual")[0]!;
    expect(transition(meeting(), step, 1000, false).timer.running).toBe(false);
    expect(transition(meeting(), step, 1000, true).timer.running).toBe(true);
  });

  it("keeps one project round per agenda, next to the round table", () => {
    const base = [
      { id: "round", type: "round" },
      { id: "projects", type: "projects" },
    ];
    expect(agendaSchema.safeParse(base).success).toBe(true);
    expect(agendaSchema.parse(base)[1]).toEqual({ id: "projects", type: "projects", order: "manual" });
    expect(agendaSchema.safeParse([...base, { id: "projects2", type: "projects" }]).success).toBe(false);
    expect(agendaSchema.safeParse([{ id: "projects", type: "projects", perProjectSec: 5 }]).success).toBe(false);
  });
});
