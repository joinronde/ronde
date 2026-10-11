import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { runOp } from "@/lib/server/meeting/ops";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { type Fixture, meeting, workspace } from "./fixtures";

// An achievement section that brings back last time's plans: an option kept with the section, and a box not
// ticked yet that does not count as done

let f: Fixture;
const empty = { done: [] as string[], next: [] as string[], blockers: [] as string[], other: [] as string[] };

type SectionArg = { key: string; label: string; role: "achievement" | "plan"; input: "list" | "checklist"; carryPlans?: boolean };
const settings = (sections: SectionArg[]) =>
  ({
    op: "settings.save",
    teamName: "Carry weekly",
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

const drafts = () =>
  prisma.checkInItem.findMany({
    where: { meetingId: f.meetingId, personId: f.memberId, sessionId: null, projectId: null },
    orderBy: { position: "asc" },
  });

beforeAll(async () => {
  f = await meeting(await workspace("carry-plans"), "Carry weekly");
});

describe("carrying last time's plans", () => {
  it("is an option of an achievement section in checklist form only", async () => {
    await runOp(
      f.ctx,
      settings([
        { key: "done", label: "Progress", role: "achievement", input: "checklist", carryPlans: true },
        { key: "next", label: "Next milestones", role: "plan", input: "list", carryPlans: true },
      ]),
    );
    expect((await loadSnapshot(f.ctx)).settings.sections).toEqual([
      { key: "done", label: "Progress", role: "achievement", input: "checklist", carryPlans: true },
      { key: "next", label: "Next milestones", role: "plan", input: "list" },
    ]);
    // A plain list has no boxes to tick: the option goes
    await runOp(
      f.ctx,
      settings([
        { key: "done", label: "Progress", role: "achievement", input: "list", carryPlans: true },
        { key: "next", label: "Next milestones", role: "plan", input: "list" },
      ]),
    );
    expect((await loadSnapshot(f.ctx)).settings.sections[0]).toEqual({
      key: "done",
      label: "Progress",
      role: "achievement",
      input: "list",
    });
    await runOp(
      f.ctx,
      settings([
        { key: "done", label: "Progress", role: "achievement", input: "checklist", carryPlans: true },
        { key: "next", label: "Next milestones", role: "plan", input: "list" },
      ]),
    );
  });

  it("counts a carried plan as done once its box is ticked", async () => {
    await runOp(f.ctx, { op: "checkIn.save", memberId: f.memberId, ...empty, next: ["Ship the API", "Write the docs"] });
    const s = await prisma.session.findFirstOrThrow({ where: { meetingId: f.meetingId, status: "current" } });
    await prisma.session.update({ where: { id: s.id }, data: { stepKey: "end", endedAt: new Date() } });
    await runOp(f.ctx, { op: "meeting.archive", summary: null, omit: [] });
    const snapshot = await loadSnapshot(f.ctx);
    expect(snapshot.lastWeek[f.memberId]).toEqual({ date: s.date, next: ["Ship the API", "Write the docs"] });
    expect(snapshot.settings.sections[0]?.carryPlans).toBe(true);

    // Brought back as boxes to tick: one done, one still in progress
    await runOp(f.ctx, { op: "checkIn.save", memberId: f.memberId, ...empty, done: ["[x] Ship the API", "[ ] Write the docs"] });
    const plans = await prisma.checkInItem.findMany({ where: { meetingId: f.meetingId, role: "plan", sessionId: s.id } });
    const byText = (text: string) => plans.find((p) => p.text === text)!.id;
    expect((await drafts()).map((i) => [i.text, i.sourceItemId])).toEqual([
      ["[x] Ship the API", byText("Ship the API")],
      ["[ ] Write the docs", null],
    ]);
    // Ticked later: now it reports on the plan
    await runOp(f.ctx, { op: "checkIn.save", memberId: f.memberId, ...empty, done: ["[x] Ship the API", "[x] Write the docs"] });
    expect((await drafts()).map((i) => i.sourceItemId)).toEqual([byText("Ship the API"), byText("Write the docs")]);
  });
});
