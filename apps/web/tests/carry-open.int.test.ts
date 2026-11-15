import { isCheckInStale } from "@ronde/core/util";
import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { runOp } from "@/lib/server/meeting/ops";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { meetingStats } from "@/lib/server/meeting/stats";
import { type Fixture, meeting, workspace } from "./fixtures";

// A checklist followed until each item is done (a site meeting's punch list): the boxes a person leaves unticked
// are back in their next check-in, still unticked; the ticked ones stay with the session they were presented at

let f: Fixture;
const empty = { done: [] as string[], next: [] as string[], blockers: [] as string[], other: [] as string[] };

type SectionArg = {
  key: string;
  label: string;
  role: "achievement" | "plan" | "blocker" | "custom";
  input: "list" | "checklist";
  carryPlans?: boolean;
  carryOpen?: boolean;
};
const settings = (sections: SectionArg[]) =>
  ({
    op: "settings.save",
    teamName: "Site B",
    locale: "",
    hostLabel: "",
    speakSec: 60,
    autoStart: true,
    targetMin: 20,
    announcements: [],
    reminderEnabled: false,
    reminderWhen: "dayBefore",
    reminderTime: "15:00",
    sections,
  }) as const;

const SECTIONS: SectionArg[] = [
  { key: "done", label: "Work done", role: "achievement", input: "list" },
  { key: "next", label: "Work planned", role: "plan", input: "checklist" },
  { key: "blockers", label: "Safety", role: "blocker", input: "checklist", carryOpen: true },
  { key: "punch", label: "Punch list", role: "custom", input: "checklist", carryOpen: true },
];

/** The person's items of a section, in their current check-in or in a session */
const itemsIn = (sectionKey: string, sessionId: string | null = null) =>
  prisma.checkInItem.findMany({
    where: { meetingId: f.meetingId, personId: f.memberId, sectionKey, sessionId, projectId: null },
    orderBy: { position: "asc" },
  });

/** Ends the current session and archives it; `absent`: the people who did not come */
async function archive(absent: string[] = []) {
  const s = await prisma.session.findFirstOrThrow({ where: { meetingId: f.meetingId, status: "current" } });
  await prisma.session.update({ where: { id: s.id }, data: { stepKey: "end", endedAt: new Date(), absent } });
  await runOp(f.ctx, { op: "meeting.archive", summary: null, omit: [] });
  return s;
}

beforeAll(async () => {
  f = await meeting(await workspace("carry-open"), "Site B");
});

describe("bringing back the open items of a checklist", () => {
  it("is an option of a checklist whose role brings nothing back already", async () => {
    await runOp(
      f.ctx,
      settings([
        { key: "done", label: "Work done", role: "achievement", input: "checklist", carryPlans: true, carryOpen: true },
        { key: "next", label: "Work planned", role: "plan", input: "checklist", carryOpen: true },
        { key: "blockers", label: "Safety", role: "blocker", input: "list", carryOpen: true },
        { key: "punch", label: "Punch list", role: "custom", input: "checklist", carryOpen: true },
      ]),
    );
    expect((await loadSnapshot(f.ctx)).settings.sections).toEqual([
      { key: "done", label: "Work done", role: "achievement", input: "checklist", carryPlans: true },
      { key: "next", label: "Work planned", role: "plan", input: "checklist" },
      { key: "blockers", label: "Safety", role: "blocker", input: "list" },
      { key: "punch", label: "Punch list", role: "custom", input: "checklist", carryOpen: true },
    ]);
    await runOp(f.ctx, settings(SECTIONS));
    expect((await loadSnapshot(f.ctx)).settings.sections.filter((s) => s.carryOpen).map((s) => s.key)).toEqual(["blockers", "punch"]);
  });

  it("starts the next check-in with the boxes left unticked, still unticked", async () => {
    await runOp(f.ctx, {
      op: "checkIn.save",
      memberId: f.memberId,
      ...empty,
      extra: { punch: ["[ ] Fix the railing", "[x] Clean the site", "[ ] Seal the window"] },
    });
    const first = await archive();
    const snapshot = await loadSnapshot(f.ctx);
    const mine = snapshot.checkIns[f.memberId]!;
    expect(mine.extra.punch).toEqual(["[ ] Fix the railing", "[ ] Seal the window"]);
    // Brought back, not written: the check-in still waits for the person, who was there (not "kept during an absence")
    expect(mine.updatedAt).toBeLessThan(snapshot.lastArchivedAt!);
    expect(mine.carriedAt).toBeGreaterThanOrEqual(snapshot.lastArchivedAt!);
    expect(isCheckInStale(mine, snapshot.lastArchivedAt)).toBe(false);
    // The session keeps the three items as they were presented
    expect((await itemsIn("punch", first.id)).map((i) => i.text)).toEqual([
      "[ ] Fix the railing",
      "[x] Clean the site",
      "[ ] Seal the window",
    ]);
    const record = (await prisma.session.findUniqueOrThrow({ where: { id: first.id } })).record as {
      checkIns: Record<string, { items: { text: string; section: string }[] }>;
    };
    expect(record.checkIns[f.memberId]!.items.filter((i) => i.section === "punch").map((i) => i.text)).toHaveLength(3);
  });

  it("edits this week's copy when a brought back item is changed", async () => {
    const first = await prisma.session.findFirstOrThrow({ where: { meetingId: f.meetingId, status: "archived" } });
    await runOp(f.ctx, {
      op: "checkIn.save",
      memberId: f.memberId,
      ...empty,
      extra: { punch: ["[ ] Fix the railing on level 2", "[x] Seal the window"] },
    });
    expect((await itemsIn("punch")).map((i) => i.text)).toEqual(["[ ] Fix the railing on level 2", "[x] Seal the window"]);
    expect((await itemsIn("punch", first.id)).map((i) => i.text)).toEqual([
      "[ ] Fix the railing",
      "[x] Clean the site",
      "[ ] Seal the window",
    ]);
  });

  it("keeps bringing them back to an absent person, and lets the ticked ones go", async () => {
    // Absent: nothing of theirs is presented, their check-in waits as it is
    await archive([f.memberId]);
    expect((await itemsIn("punch")).map((i) => i.text)).toEqual(["[ ] Fix the railing on level 2", "[x] Seal the window"]);
    await archive();
    expect((await itemsIn("punch")).map((i) => i.text)).toEqual(["[ ] Fix the railing on level 2"]);
    // Absent again with nothing written since: what came back stays
    await archive([f.memberId]);
    expect((await itemsIn("punch")).map((i) => i.text)).toEqual(["[ ] Fix the railing on level 2"]);
    await runOp(f.ctx, { op: "checkIn.save", memberId: f.memberId, ...empty, extra: { punch: ["[x] Fix the railing on level 2"] } });
    await archive();
    expect(await itemsIn("punch")).toEqual([]);
  });

  it("counts a blocker brought back once in the stats", async () => {
    await runOp(f.ctx, { op: "checkIn.save", memberId: f.memberId, ...empty, blockers: ["[ ] Scaffolding without guardrail"] });
    await archive();
    expect((await itemsIn("blockers")).map((i) => i.text)).toEqual(["[ ] Scaffolding without guardrail"]);
    // Presented again as it came back, then ticked (the row changes with its box: it is still the item brought back)
    await archive();
    await runOp(f.ctx, { op: "checkIn.save", memberId: f.memberId, ...empty, blockers: ["[x] Scaffolding without guardrail"] });
    await archive();
    const stats = await meetingStats(f.ctx);
    expect(stats.sessions.slice(-3).map((s) => s.blockers)).toEqual([1, 0, 0]);
    expect(stats.recurring).toEqual([]);
  });
});

describe("bringing back the open items of a project's tab", () => {
  let g: Fixture;
  const tab = (personId: string, projectId: string, sessionId: string | null = null) =>
    prisma.checkInItem.findMany({ where: { meetingId: g.meetingId, personId, projectId, sectionKey: "done", sessionId } });
  async function close() {
    const s = await prisma.session.findFirstOrThrow({ where: { meetingId: g.meetingId, status: "current" } });
    await prisma.session.update({ where: { id: s.id }, data: { stepKey: "end", endedAt: new Date() } });
    await runOp(g.ctx, { op: "meeting.archive", summary: null, omit: [] });
  }

  beforeAll(async () => {
    g = await meeting(await workspace("carry-open-projects"), "Site C");
    await runOp(g.ctx, {
      ...settings([
        { key: "done", label: "Work done", role: "achievement", input: "checklist", carryOpen: true },
        { key: "next", label: "Work planned", role: "plan", input: "list" },
      ]),
      teamName: "Site C",
    });
  });

  it("brings them back in the same tab, and counts a project's work done once ticked", async () => {
    await prisma.checkInItem.deleteMany({ where: { meetingId: g.meetingId, sessionId: null } });
    await runOp(g.ctx, {
      op: "checkIn.save",
      memberId: g.memberId,
      ...empty,
      byProject: { [g.projectId]: { ...empty, extra: {}, done: ["[ ] Pour the slab", "[x] Formwork"] } },
    });
    await close();
    expect((await tab(g.memberId, g.projectId)).map((i) => i.text)).toEqual(["[ ] Pour the slab"]);
    await runOp(g.ctx, {
      op: "checkIn.save",
      memberId: g.memberId,
      ...empty,
      byProject: { [g.projectId]: { ...empty, extra: {}, done: ["[x] Pour the slab"] } },
    });
    await close();
    // The slab counts at the session it was ticked, never while it was open
    const progress = (await meetingStats(g.ctx)).projects.find((p) => p.id === g.projectId)!;
    expect(progress.perSession.slice(-2)).toEqual([1, 1]);
    expect(await tab(g.memberId, g.projectId)).toEqual([]);
  });
});
