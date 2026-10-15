import type { Step } from "@ronde/core/meeting";
import { MINUTES_PARTS } from "@ronde/core/minutes";
import type { ActionDTO, CheckInDTO, Section, Snapshot } from "@ronde/core/types";
import { afterEach, describe, expect, it } from "vitest";
import {
  blockersOf,
  canPlace,
  filledCount,
  isTracked,
  localToday,
  memberOfStep,
  minutesCheck,
  minutesPartsOf,
  nextLabel,
  parseOmit,
  projectOrderOf,
  serializeOmit,
  shuffleProjects,
  sortActions,
  startOp,
  stepTitle,
} from "@/lib/shared/control-room";
import { projectEntries, projectsWithTurn } from "@/lib/shared/stage";

// What the control room computes from the meeting's state: the step titles, the blockers to follow up, the check
// before archiving, the order of the project round

const speaker = (id: string, label = `${id[0]!.toUpperCase()}${id.slice(1)} Doe`): Step => ({ type: "speaker", key: id, id, label });
const project = (projectId: string, speakers: string[] = [], label = projectId): Step => ({
  type: "project",
  key: `p:${projectId}`,
  projectId,
  speakers,
  label,
});
const intro: Step = { type: "intro", key: "intro", label: "Intro" };
const misc: Step = { type: "misc", key: "misc", label: "Topics" };
const end: Step = { type: "end", key: "end", label: "End" };

const fields = (patch: Partial<CheckInDTO> = {}): CheckInDTO => ({
  done: [],
  next: [],
  blockers: [],
  other: [],
  extra: {},
  byProject: {},
  updatedAt: 1,
  ...patch,
});
const tab = (blockers: string[]) => ({ done: [], next: [], blockers, other: [], extra: {} });

const blockersSec: Section = { k: "blockers", label: "Blockers", kind: "blockers" };
const doneSec: Section = { k: "done", label: "Done", kind: "done" };

let n = 0;
const action = (patch: Partial<ActionDTO> = {}): ActionDTO => ({
  id: `a${++n}`,
  text: "Something to do",
  ownerId: "alice",
  status: "open",
  progress: null,
  progressAt: null,
  originDate: null,
  originText: null,
  projectId: null,
  createdAt: n,
  doneAt: null,
  ...patch,
});

describe("today on this device", () => {
  const tz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = tz;
  });

  it("is written YYYY-MM-DD with leading zeros", () => {
    process.env.TZ = "UTC";
    expect(localToday(new Date(Date.UTC(2026, 0, 5, 12)))).toBe("2026-01-05");
  });

  it("is the local calendar day, not the UTC one", () => {
    // 23:30 UTC on 31 December: already the new year in Kiribati, still the old one in American Samoa
    const instant = new Date(Date.UTC(2026, 11, 31, 23, 30));
    process.env.TZ = "Pacific/Kiritimati";
    expect(localToday(instant)).toBe("2027-01-01");
    process.env.TZ = "Pacific/Pago_Pago";
    expect(localToday(instant)).toBe("2026-12-31");
  });

  it("turns at local midnight", () => {
    process.env.TZ = "Europe/Paris";
    expect(localToday(new Date(2026, 9, 13, 23, 59, 59, 999))).toBe("2026-10-13");
    expect(localToday(new Date(2026, 9, 14, 0, 0, 0, 0))).toBe("2026-10-14");
  });

  it("keeps the day across a daylight saving change", () => {
    process.env.TZ = "Europe/Paris";
    // Clocks go back at 03:00 on 25 October 2026: that night has 25 hours, the day is the same throughout
    expect(localToday(new Date(Date.UTC(2026, 9, 24, 22, 30)))).toBe("2026-10-25");
    expect(localToday(new Date(Date.UTC(2026, 9, 25, 22, 59)))).toBe("2026-10-25");
    expect(localToday(new Date(Date.UTC(2026, 9, 25, 23, 0)))).toBe("2026-10-26");
  });
});

describe("the Start button", () => {
  it("starts the timer of a session dated today", () => {
    expect(startOp("2026-10-13", "2026-10-13")).toBe("meeting.togglePlay");
  });

  it("dates today a session prepared for another day, earlier or later", () => {
    expect(startOp("2026-10-12", "2026-10-13")).toBe("session.now");
    expect(startOp("2026-10-14", "2026-10-13")).toBe("session.now");
  });

  it("compares with the device's own day at midnight", () => {
    const tz = process.env.TZ;
    try {
      process.env.TZ = "Asia/Tokyo";
      // 15:00 UTC is midnight in Tokyo: a session dated the 13th is now yesterday's
      expect(startOp("2026-10-13", localToday(new Date(Date.UTC(2026, 9, 13, 14, 59))))).toBe("meeting.togglePlay");
      expect(startOp("2026-10-13", localToday(new Date(Date.UTC(2026, 9, 13, 15, 0))))).toBe("session.now");
    } finally {
      process.env.TZ = tz;
    }
  });

  it("dates today a session whose date is empty or malformed", () => {
    expect(startOp("", "2026-10-13")).toBe("session.now");
    expect(startOp("2026-10-13T00:00", "2026-10-13")).toBe("session.now");
  });

  it("reads the device's clock when no day is given", () => {
    expect(startOp(localToday())).toBe("meeting.togglePlay");
  });
});

describe("the member a step is about", () => {
  it("is the speaker of a turn", () => {
    expect(memberOfStep("alice")).toBe("alice");
  });

  it("is the speaker whose questions are handled", () => {
    expect(memberOfStep("qa:alice")).toBe("alice");
  });

  it("strips one prefix only, and only at the start", () => {
    expect(memberOfStep("qa:qa:alice")).toBe("qa:alice");
    expect(memberOfStep("alice:qa:")).toBe("alice:qa:");
    expect(memberOfStep("QA:alice")).toBe("QA:alice");
  });

  it("is empty for an empty key or the prefix alone", () => {
    expect(memberOfStep("")).toBe("");
    expect(memberOfStep("qa:")).toBe("");
  });

  it("keeps ids with odd characters as they are", () => {
    expect(memberOfStep("qa:ü-ñ_é:42")).toBe("ü-ñ_é:42");
    expect(memberOfStep("intro")).toBe("intro");
  });
});

describe("check-ins filled", () => {
  const state = (checkIns: Record<string, CheckInDTO>, lastArchivedAt: number | null = null) => ({ checkIns, lastArchivedAt });

  it("are none in an empty agenda", () => {
    expect(filledCount([], state({ alice: fields({ done: ["x"] }) }))).toBe(0);
  });

  it("count each speaker with something written", () => {
    const agenda = [intro, speaker("alice"), speaker("bruno"), speaker("chloe"), end];
    const s = state({ alice: fields({ done: ["Invoices"] }), bruno: fields() });
    expect(filledCount(agenda, s)).toBe(1);
  });

  it("count a check-in written only in a project's tab", () => {
    const s = state({ alice: fields({ byProject: { billing: tab(["Waiting on legal"]) } }) });
    expect(filledCount([speaker("alice")], s)).toBe(1);
  });

  it("leave out a check-in kept from before the last meeting", () => {
    const s = state({ alice: fields({ done: ["Old"], updatedAt: 10 }), bruno: fields({ done: ["New"], updatedAt: 30 }) }, 20);
    expect(filledCount([speaker("alice"), speaker("bruno")], s)).toBe(1);
  });

  it("only count the speakers of the round", () => {
    // Olivia observes: her check-in is not waited for
    const s = state({ olivia: fields({ done: ["Notes"] }) });
    expect(filledCount([intro, project("billing", ["olivia"]), misc], s)).toBe(0);
  });

  it("count many speakers", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `p${i}`);
    const checkIns = Object.fromEntries(ids.filter((_, i) => i % 2).map((id) => [id, fields({ next: ["Plan"] })]));
    expect(
      filledCount(
        ids.map((id) => speaker(id)),
        state(checkIns),
      ),
    ).toBe(25);
  });
});

describe("the title of the current step", () => {
  const t = (k: string) => `[${k}]`;

  it("names a turn, a block or a project by its label", () => {
    expect(stepTitle(speaker("alice"), t)).toBe("Alice Doe");
    expect(stepTitle({ type: "block", key: "b1", label: "Retrospective", block: "retro" }, t)).toBe("Retrospective");
    expect(stepTitle(project("billing", [], "Billing"), t)).toBe("Billing");
  });

  it("names the questions and the other steps by their kind", () => {
    expect(stepTitle({ type: "qa", key: "qa:alice", label: "Alice Doe", of: "alice" }, t)).toBe("[qaTitle]");
    expect(stepTitle(intro, t)).toBe("[stepTitles.intro]");
    expect(stepTitle(misc, t)).toBe("[stepTitles.misc]");
    expect(stepTitle(end, t)).toBe("[stepTitles.end]");
  });

  it("keeps a right-to-left label as written", () => {
    expect(stepTitle(speaker("sara", "سارة أحمد"), t)).toBe("سارة أحمد");
  });
});

describe("the label of the Next button", () => {
  const questions = (count: number) => `Questions (${count})`;

  it("is empty after the last step", () => {
    expect(nextLabel(undefined, questions)).toBe("");
  });

  it("names a speaker by first name", () => {
    expect(nextLabel(speaker("alice", "Alice Marie Doe"), questions)).toBe("Alice");
    expect(nextLabel(speaker("sara", "سارة أحمد"), questions)).toBe("سارة");
    expect(nextLabel(speaker("mei", "王芳"), questions)).toBe("王芳");
  });

  it("names a project or block by its whole label", () => {
    expect(nextLabel(project("billing", [], "Billing v2"), questions)).toBe("Billing v2");
    expect(nextLabel(misc, questions)).toBe("Topics");
  });

  it("counts the questions waiting, or all of them, or none", () => {
    const qa = (pending?: number, total?: number): Step => ({ type: "qa", key: "qa:alice", label: "Alice", pending, total });
    expect(nextLabel(qa(2, 5), questions)).toBe("Questions (2)");
    expect(nextLabel(qa(0, 5), questions)).toBe("Questions (5)");
    expect(nextLabel(qa(), questions)).toBe("Questions (0)");
  });
});

describe("blockers to follow up", () => {
  const run = (s: Pick<Snapshot, "checkIns">, agenda: Step[], sections: Section[] = [doneSec, blockersSec]) =>
    blockersOf(s, agenda, sections, projectsWithTurn(agenda), projectEntries);

  it("are none in an empty meeting", () => {
    expect(run({ checkIns: {} }, [])).toEqual([]);
    expect(run({ checkIns: {} }, [intro, speaker("alice"), end])).toEqual([]);
  });

  it("are listed per turn, without their checkbox", () => {
    const s = { checkIns: { alice: fields({ blockers: ["[ ] Waiting on legal", "[x] VPN"] }) } };
    expect(run(s, [speaker("alice")])).toEqual([
      { id: "alice", b: "Waiting on legal", projectId: null },
      { id: "alice", b: "VPN", projectId: null },
    ]);
  });

  it("leave out an emptied box, also one saved twice by an older version", () => {
    const s = { checkIns: { alice: fields({ blockers: ["[ ] ", "[ ] [ ]", "[x] [x]", "Real"] }) } };
    expect(run(s, [speaker("alice")]).map((x) => x.b)).toEqual(["Real"]);
  });

  it("take in the turn the blockers of a project that has no step of its own", () => {
    const s = { checkIns: { alice: fields({ byProject: { billing: tab(["API keys"]) } }) } };
    expect(run(s, [speaker("alice")])).toEqual([{ id: "alice", b: "API keys", projectId: "billing" }]);
  });

  it("list the blockers of a project with its own step under it, once", () => {
    const s = { checkIns: { alice: fields({ blockers: ["Own"], byProject: { billing: tab(["API keys"]) } }) } };
    expect(run(s, [speaker("alice"), project("billing", ["alice"])])).toEqual([
      { id: "alice", b: "Own", projectId: null },
      { id: "alice", b: "API keys", projectId: "billing" },
    ]);
  });

  it("include the project blockers of people outside the round", () => {
    // Olivia has no turn, but what she wrote about the project is presented with it
    const s = { checkIns: { olivia: fields({ blockers: ["Not shown"], byProject: { billing: tab(["Budget"]) } }) } };
    expect(run(s, [project("billing", [])])).toEqual([{ id: "olivia", b: "Budget", projectId: "billing" }]);
  });

  it("follow the agenda: the turns first, then the projects, their speakers first", () => {
    const s = {
      checkIns: {
        alice: fields({ blockers: ["A1"], byProject: { billing: tab(["A-billing"]) } }),
        bruno: fields({ blockers: ["B1"], byProject: { billing: tab(["B-billing"]) } }),
      },
    };
    const agenda = [intro, speaker("bruno"), speaker("alice"), project("billing", ["bruno"]), end];
    expect(run(s, agenda).map((x) => x.b)).toEqual(["B1", "A1", "B-billing", "A-billing"]);
  });

  it("leave out the project steps when the meeting has no blockers section", () => {
    const s = { checkIns: { alice: fields({ blockers: ["Own"], byProject: { billing: tab(["API keys"]) } }) } };
    expect(run(s, [speaker("alice"), project("billing", ["alice"])], [doneSec])).toEqual([{ id: "alice", b: "Own", projectId: null }]);
  });

  it("keep duplicates, one row each, and odd or right-to-left text as written", () => {
    const s = {
      checkIns: {
        alice: fields({ blockers: ["Same", "Same"] }),
        sara: fields({ blockers: ["بانتظار الموافقة", '<b>& "quotes"</b> 🚧'] }),
      },
    };
    expect(run(s, [speaker("alice"), speaker("sara")]).map((x) => x.b)).toEqual([
      "Same",
      "Same",
      "بانتظار الموافقة",
      '<b>& "quotes"</b> 🚧',
    ]);
  });

  it("leave out blank lines, which have nothing to follow up", () => {
    const s = {
      checkIns: { alice: fields({ blockers: ["", "  ", "[ ] ", "Real"], byProject: { billing: tab([" "]) } }) },
    };
    expect(run(s, [speaker("alice")]).map((x) => x.b)).toEqual(["Real"]);
    expect(run(s, [speaker("alice"), project("billing", ["alice"])]).map((x) => x.b)).toEqual(["Real"]);
  });

  it("hold many people and projects", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `p${i}`);
    const checkIns = Object.fromEntries(ids.map((id) => [id, fields({ blockers: [`${id} own`], byProject: { x: tab([`${id} x`]) } })]));
    const out = run({ checkIns }, [...ids.map((id) => speaker(id)), project("x")]);
    expect(out).toHaveLength(100);
    expect(out.slice(0, 50).every((x) => x.projectId === null)).toBe(true);
    expect(out.slice(50).every((x) => x.projectId === "x")).toBe(true);
  });
});

describe("a blocker already tracked", () => {
  it("is not tracked without actions", () => {
    expect(isTracked([], "alice", "Waiting on legal")).toBe(false);
  });

  it("is tracked by the open action made from it, whoever owns it", () => {
    expect(isTracked([action({ originText: "Waiting on legal", ownerId: "bruno" })], "alice", "Waiting on legal")).toBe(true);
  });

  it("is tracked by an open action of its author that says much the same", () => {
    const a = action({ ownerId: "alice", text: "Chase legal about the contract" });
    expect(isTracked([a], "alice", "Waiting for legal on the contract")).toBe(true);
  });

  it("is not tracked by a similar action of someone else", () => {
    const a = action({ ownerId: "bruno", text: "Chase legal about the contract" });
    expect(isTracked([a], "alice", "Waiting for legal on the contract")).toBe(false);
  });

  it("compares with the text the action was made from before its own", () => {
    const a = action({ ownerId: "alice", text: "Renamed later", originText: "Waiting on legal contract" });
    expect(isTracked([a], "alice", "Legal contract still waiting")).toBe(true);
  });

  it("is no longer tracked once the action is done", () => {
    expect(isTracked([action({ originText: "Waiting on legal", status: "done" })], "alice", "Waiting on legal")).toBe(false);
  });

  it("is tracked by an action in progress", () => {
    expect(isTracked([action({ originText: "X", status: "doing" })], "alice", "X")).toBe(true);
  });

  it("is not tracked by an action with few words in common", () => {
    const a = action({ ownerId: "alice", text: "Prepare the quarterly report" });
    expect(isTracked([a], "alice", "Waiting on legal contract")).toBe(false);
  });

  it("matches across accents", () => {
    const a = action({ ownerId: "alice", text: "Relancer le service juridique" });
    expect(isTracked([a], "alice", "Relancer le sérvice juridiqué")).toBe(true);
  });

  // Words of every script count, and Chinese, written without spaces, by pairs of characters
  it("recognises a reworded blocker written in a non-Latin script", () => {
    const a = action({ ownerId: "sara", text: "متابعة الموافقة القانونية للعقد" });
    expect(isTracked([a], "sara", "بانتظار الموافقة القانونية للعقد")).toBe(true);
    expect(isTracked([action({ ownerId: "ivan", text: "Получить ответ юристов" })], "ivan", "Ждём ответ юристов")).toBe(true);
    expect(isTracked([action({ ownerId: "li", text: "跟进法务审批合同" })], "li", "等待法务审批合同")).toBe(true);
    expect(isTracked([action({ ownerId: "li", text: "准备季度预算" })], "li", "等待法务审批合同")).toBe(false);
  });

  it("is tracked by the exact text in any script", () => {
    expect(isTracked([action({ originText: "Ждём юристов" })], "ivan", "Ждём юристов")).toBe(true);
  });
});

describe("the actions list", () => {
  it("is empty without actions", () => {
    expect(sortActions([])).toEqual([]);
  });

  it("shows the open actions first, each group oldest first", () => {
    const list = [
      action({ id: "d2", status: "done", createdAt: 2 }),
      action({ id: "t3", status: "open", createdAt: 3 }),
      action({ id: "d1", status: "done", createdAt: 1 }),
      action({ id: "b4", status: "doing", createdAt: 4 }),
      action({ id: "t1", status: "open", createdAt: 1 }),
    ];
    expect(sortActions(list).map((a) => a.id)).toEqual(["t1", "t3", "b4", "d1", "d2"]);
  });

  it("keeps the given order for actions created at the same time", () => {
    const list = [action({ id: "x", createdAt: 5 }), action({ id: "y", createdAt: 5 }), action({ id: "z", createdAt: 5 })];
    expect(sortActions(list).map((a) => a.id)).toEqual(["x", "y", "z"]);
  });

  it("leaves the meeting's list untouched", () => {
    const list = [action({ id: "b", createdAt: 2 }), action({ id: "a", createdAt: 1 })];
    sortActions(list);
    expect(list.map((a) => a.id)).toEqual(["b", "a"]);
  });
});

describe("the check before archiving", () => {
  const check = (notes: Record<string, string>, actions: ActionDTO[], startedAt: number | null, agenda: Step[]) =>
    minutesCheck({ notes, actions }, startedAt, agenda);

  it("is all zero for an empty meeting", () => {
    expect(check({}, [], null, [])).toEqual({ decisions: 0, created: 0, silent: [] });
  });

  it("counts the decisions of every note, bold, bulleted or numbered", () => {
    const notes = {
      intro: "Decision: ship on Friday\nNothing else",
      alice: "- **Decision:** hire\n1. decision: keep the budget",
      misc: "Decided nothing: not a decision line",
    };
    expect(check(notes, [], null, []).decisions).toBe(3);
  });

  it("counts decisions written in the meeting's languages, right-to-left ones included", () => {
    const notes = { a: "Décision : on garde", b: "قرار: نؤجل الإطلاق", c: "Entscheidung: ja", d: "Решение: да", e: "निर्णय: हाँ" };
    expect(check(notes, [], null, []).decisions).toBe(5);
  });

  // The full-width colon is the one Chinese keyboards type
  it("counts a Chinese decision written with a full-width colon", () => {
    expect(check({ a: "决定：下周发布" }, [], null, []).decisions).toBe(1);
  });

  it("does not count a decision with nothing after it", () => {
    expect(check({ a: "Decision:", b: "Decision:   " }, [], null, []).decisions).toBe(0);
  });

  it("counts the actions created since the start, the start included", () => {
    const actions = [action({ createdAt: 99 }), action({ createdAt: 100 }), action({ createdAt: 150, status: "done" })];
    expect(check({}, actions, 100, []).created).toBe(2);
  });

  it("counts no action before the meeting has started", () => {
    expect(check({}, [action({ createdAt: 5 })], null, []).created).toBe(0);
  });

  it("lists the turns without notes, on the turn or on its questions", () => {
    const agenda = [intro, speaker("alice"), speaker("bruno"), speaker("chloe"), speaker("sara"), project("billing"), end];
    const notes = { alice: "Said things", "qa:bruno": "Asked about X", chloe: "   \n ", sara: "ملاحظة", "p:billing": "" };
    expect(check(notes, [], null, agenda).silent.map((x) => x.key)).toEqual(["chloe"]);
  });

  it("only lists the turns, not the other steps without notes", () => {
    expect(check({}, [], null, [intro, project("billing"), misc, end]).silent).toEqual([]);
  });

  it("lists each of many silent turns in agenda order", () => {
    const agenda = Array.from({ length: 50 }, (_, i) => speaker(`p${String(i).padStart(2, "0")}`));
    const silent = check({ p10: "x" }, [], null, agenda).silent;
    expect(silent).toHaveLength(49);
    expect(silent[0]!.key).toBe("p00");
    expect(silent.at(-1)!.key).toBe("p49");
  });
});

describe("team inputs left out of the minutes", () => {
  it("are none when nothing is stored", () => {
    expect(parseOmit(null)).toEqual([]);
  });

  it("are none when the stored value is broken or not a list", () => {
    for (const raw of ["", "not json", "{", "null", "42", '"mood"', '{"0":"mood"}']) expect(parseOmit(raw)).toEqual([]);
  });

  it("keep only the known parts, each once, in their usual order", () => {
    expect(parseOmit('["mood","unknown","checkIns","mood",1,null,"MOOD"]')).toEqual(["checkIns", "mood"]);
  });

  it("read back what was stored", () => {
    expect(parseOmit(serializeOmit([]))).toEqual([]);
    expect(parseOmit(serializeOmit(["polls", "kudos"]))).toEqual(["kudos", "polls"]);
    expect(parseOmit(serializeOmit([...MINUTES_PARTS]))).toEqual([...MINUTES_PARTS]);
  });

  it("are stored as a JSON list", () => {
    expect(serializeOmit(["mood"])).toBe('["mood"]');
  });
});

describe("the order of the project round", () => {
  type List = NonNullable<Snapshot["blockData"]["projects"]>["list"];
  const listed = (entries: [id: string, filled: boolean][]): List =>
    entries.map(([id, filled], position) => ({
      id,
      name: id,
      health: null,
      themePosition: null,
      position,
      memberIds: [],
      authorIds: [],
      filled,
    }));
  const state = (
    list: List | null,
    meeting: { stepKey: string; projectsAdded: string[] } | null = { stepKey: "intro", projectsAdded: [] },
  ) => ({
    blockData: list ? { projects: { speakSec: 60, list } } : {},
    meeting,
  });

  it("shows nothing without a project round", () => {
    const o = projectOrderOf(state(null), [intro, speaker("alice"), end]);
    expect(o).toMatchObject({ steps: [], ids: [], skipped: [], showOrder: false });
  });

  it("has no order to show for a single project", () => {
    const o = projectOrderOf(state(listed([["billing", true]])), [intro, project("billing"), end]);
    expect(o.showOrder).toBe(false);
    expect(o.skipped).toEqual([]);
  });

  it("shows the order of two projects or more", () => {
    const o = projectOrderOf(
      state(
        listed([
          ["a", true],
          ["b", true],
        ]),
      ),
      [intro, project("a"), project("b"), end],
    );
    expect(o.showOrder).toBe(true);
    expect(o.ids).toEqual(["a", "b"]);
  });

  it("shows the order of a single project the host added, so it can be taken out", () => {
    const o = projectOrderOf(state(listed([["a", false]]), { stepKey: "intro", projectsAdded: ["a"] }), [project("a")]);
    expect(o.showOrder).toBe(true);
    expect(o.added.has("a")).toBe(true);
    expect(o.filled.has("a")).toBe(false);
    expect(o.skipped).toEqual([]);
  });

  it("names the projects nobody wrote about, which have no step", () => {
    const o = projectOrderOf(
      state(
        listed([
          ["a", true],
          ["empty", false],
          ["b", true],
          ["quiet", false],
        ]),
      ),
      [project("a"), project("b")],
    );
    expect(o.skipped.map((p) => p.id)).toEqual(["empty", "quiet"]);
    expect([...o.filled]).toEqual(["a", "b"]);
  });

  it("counts the steps passed up to the current one, included", () => {
    const agenda = [intro, project("a"), project("b"), project("c"), end];
    const o = projectOrderOf(state(listed([]), { stepKey: "p:b", projectsAdded: [] }), agenda);
    expect([...o.done]).toEqual(["intro", "p:a", "p:b"]);
  });

  it("counts no step passed when the current one is not in the agenda, or without a meeting", () => {
    const agenda = [intro, project("a"), project("b")];
    expect(projectOrderOf(state(listed([]), { stepKey: "gone", projectsAdded: [] }), agenda).done.size).toBe(0);
    expect(projectOrderOf(state(listed([]), null), agenda).done.size).toBe(0);
  });

  it("holds 50 projects", () => {
    const ids = Array.from({ length: 50 }, (_, i) => `p${i}`);
    const list = listed(ids.map((id, i) => [id, i < 40]));
    const o = projectOrderOf(
      state(list),
      ids.slice(0, 40).map((id) => project(id)),
    );
    expect(o.steps).toHaveLength(40);
    expect(o.skipped).toHaveLength(10);
    expect(o.showOrder).toBe(true);
  });

  describe("moving a project", () => {
    const steps = ["a", "b", "c", "d"].map((id) => project(id));

    it("is never possible above the first or below the last", () => {
      expect(canPlace(steps, new Set(), 0, -1)).toBe(false);
      expect(canPlace(steps, new Set(), 3, 4)).toBe(false);
      expect(canPlace(steps, new Set(), 0, 1)).toBe(true);
      expect(canPlace(steps, new Set(), 3, 2)).toBe(true);
    });

    it("is never possible for a single project", () => {
      expect(canPlace([project("a")], new Set(), 0, -1)).toBe(false);
      expect(canPlace([project("a")], new Set(), 0, 1)).toBe(false);
    });

    it("never takes a project above the step running or done, nor moves those", () => {
      const done = new Set(["intro", "p:a", "p:b"]);
      // b runs: a and b stay; c cannot go above b; c and d may swap
      expect([0, 1, 2, 3].map((i) => canPlace(steps, done, i, i - 1))).toEqual([false, false, false, true]);
      expect([0, 1, 2, 3].map((i) => canPlace(steps, done, i, i + 1))).toEqual([false, false, true, false]);
    });

    it("never goes out of bounds when allowed", () => {
      for (const d of [-1, 1] as const)
        for (let i = 0; i < steps.length; i++) if (canPlace(steps, new Set(), i, i + d)) expect(steps[i + d]).toBeDefined();
    });

    it("is dragged over several places, never over a step that ran", () => {
      const done = new Set(["intro", "p:a"]);
      expect(canPlace(steps, done, 3, 1)).toBe(true);
      expect(canPlace(steps, done, 3, 0)).toBe(false);
      expect(canPlace(steps, done, 0, 2)).toBe(false);
      expect(canPlace(steps, new Set(), 0, 3)).toBe(true);
      expect(canPlace(steps, new Set(), 1, 1)).toBe(false);
      expect(canPlace(steps, new Set(), 1, 4)).toBe(false);
    });
  });

  describe("drawing the order at random", () => {
    it("keeps an empty or single order as it is", () => {
      expect(shuffleProjects([], () => 0)).toEqual([]);
      expect(shuffleProjects(["a"], () => 0)).toEqual(["a"]);
    });

    it("follows the random draws", () => {
      expect(shuffleProjects(["a", "b", "c"], () => 0)).toEqual(["b", "c", "a"]);
      expect(shuffleProjects(["a", "b", "c"], () => 0.999)).toEqual(["a", "b", "c"]);
    });

    it("keeps every project once, leaving the order given untouched", () => {
      const ids = Array.from({ length: 50 }, (_, i) => `p${i}`);
      const out = shuffleProjects(ids);
      expect([...out].sort()).toEqual([...ids].sort());
      expect(ids[0]).toBe("p0");
    });
  });
});

describe("minutesPartsOf", () => {
  it("offers only what the meeting's modules can bring to the minutes", () => {
    const on = new Set(["polls", "kudos"]);
    const parts = minutesPartsOf((id) => on.has(id));
    expect(parts).toEqual(["checkIns", "comments", "topics", "kudos", "polls"]);
    expect(parts).not.toContain("mood");
    expect(minutesPartsOf(() => true)).toEqual([...MINUTES_PARTS]);
  });
});
