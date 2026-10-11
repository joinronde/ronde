import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { enterprise } from "@/ee-bridge";
import { type Fixture, meeting, workspace } from "./fixtures";

// Workspace insights: attendance, follow-through of plans, participation and actions over a period

let f: Fixture;

const record = (date: string, present: string[], absent: string[], extra: object = {}) => ({
  v: 1,
  date,
  teamName: "Weekly",
  hostLabel: "",
  startedAt: 0,
  endedAt: 1_200_000,
  durationMs: 1_200_000,
  spent: {},
  participants: present.map((id) => ({ id, name: id, jobCategory: "" })),
  absent: absent.map((id) => ({ id, name: id })),
  sections: [],
  checkIns: {},
  notes: {},
  interactions: [],
  topics: [],
  actions: [],
  names: {},
  ...extra,
});

beforeAll(async () => {
  f = await meeting(await workspace(`insights-${Date.now().toString(36)}`), "Weekly");
  await prisma.meeting.update({ where: { id: f.meetingId }, data: { targetMin: 30 } });
  const a = f.ctx.ws.member.personId;
  const b = f.memberId;
  const s1 = await prisma.session.create({
    data: {
      workspaceId: f.workspaceId,
      meetingId: f.meetingId,
      date: "2026-09-07",
      status: "archived",
      record: record("2026-09-07", [a, b], [], { kudos: [{ fromId: a, toId: b, text: "x" }], mood: { counts: [0, 0, 0, 2, 0], avg: 4 } }),
    },
  });
  const s2 = await prisma.session.create({
    data: {
      workspaceId: f.workspaceId,
      meetingId: f.meetingId,
      date: "2026-09-14",
      status: "archived",
      record: record("2026-09-14", [a], [b], { durationMs: 2_400_000 }),
    },
  });
  // Two items planned at the first session, one reported done at the second
  const [p1] = await Promise.all([
    prisma.checkInItem.create({
      data: {
        workspaceId: f.workspaceId,
        meetingId: f.meetingId,
        personId: a,
        sessionId: s1.id,
        sectionKey: "next",
        role: "plan",
        text: "Ship",
      },
    }),
    prisma.checkInItem.create({
      data: {
        workspaceId: f.workspaceId,
        meetingId: f.meetingId,
        personId: a,
        sessionId: s1.id,
        sectionKey: "next",
        role: "plan",
        text: "Test",
      },
    }),
  ]);
  await prisma.checkInItem.create({
    data: {
      workspaceId: f.workspaceId,
      meetingId: f.meetingId,
      personId: a,
      sessionId: s2.id,
      sectionKey: "done",
      role: "achievement",
      text: "Ship",
      sourceItemId: p1.id,
    },
  });
});

describe("workspace insights", () => {
  it("sums up each meeting over the period", async () => {
    const data = await enterprise.insights.compute(f.ctx.ws.db, { from: "2026-09-01", to: "2026-09-30" });
    const m = data.meetings.find((x) => x.id === f.meetingId)!;
    expect(m).toMatchObject({ sessions: 2, attendance: 3 / 4, onTime: 1 / 2, followThrough: 1 / 2, mood: 4 });
    // One kudo for three people present
    expect(m.participation).toBeCloseTo(1 / 3);
    expect(m.engagement).toBeGreaterThan(0);
    expect(m.trend).toHaveLength(2);
    expect(data.totals).toMatchObject({ sessions: 2, meetings: 1, followThrough: 1 / 2 });
    expect(data.weeks.find((w) => w.week === "2026-09-07")).toMatchObject({ sessions: 1, attendance: 1 });
  });

  it("only counts the period asked", async () => {
    const data = await enterprise.insights.compute(f.ctx.ws.db, { from: "2026-09-10", to: "2026-09-30" });
    expect(data.meetings.find((x) => x.id === f.meetingId)).toMatchObject({ sessions: 1, followThrough: null });
  });
});
