import { buildMinutes, minutesToMarkdown } from "@ronde/core/minutes";
import { parseRecord } from "@ronde/core/record";
import { prisma } from "@ronde/db";
import { beforeAll, describe, expect, it } from "vitest";
import { runOp } from "@/lib/server/meeting/ops";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { meetingStats } from "@/lib/server/meeting/stats";
import { type Fixture, meeting, workspace } from "./fixtures";

// Check-in items as rows: ids kept across saves, planned → done links, archived sessions and their stats

let f: Fixture;
const empty = { done: [] as string[], next: [] as string[], blockers: [] as string[], other: [] as string[] };

/** Ends the current session and archives it */
async function archive(summary: string | null = null, omit: ("kudos" | "mood")[] = []) {
  const s = await prisma.session.findFirstOrThrow({ where: { meetingId: f.meetingId, status: "current" } });
  await prisma.session.update({
    where: { id: s.id },
    data: { stepKey: "end", startedAt: new Date(Date.now() - 20 * 60_000), endedAt: new Date(), spent: { [f.memberId]: 150_000 } },
  });
  await runOp(f.ctx, { op: "meeting.archive", summary, omit });
  return prisma.session.findUniqueOrThrow({ where: { id: s.id } });
}

const drafts = () =>
  prisma.checkInItem.findMany({
    where: { meetingId: f.meetingId, personId: f.memberId, sessionId: null, projectId: null },
    orderBy: { position: "asc" },
  });

beforeAll(async () => {
  f = await meeting(await workspace("records"), "Records weekly");
});

describe("check-in items", () => {
  it("keeps the id of an item that stays, so its comments stay too", async () => {
    const shipped = (await drafts()).find((i) => i.text === "shipped")!;
    await runOp(f.ctx, {
      op: "checkIn.save",
      memberId: f.memberId,
      ...empty,
      done: ["shipped", "Fixed the login"],
      next: ["Write the docs", "Ship the API"],
      blockers: ["No staging access"],
    });
    const items = await drafts();
    expect(items.map((i) => [i.sectionKey, i.role, i.text])).toEqual([
      ["done", "achievement", "shipped"],
      ["next", "plan", "Write the docs"],
      ["blockers", "blocker", "No staging access"],
      ["done", "achievement", "Fixed the login"],
      ["next", "plan", "Ship the API"],
    ]);
    expect(items.find((i) => i.text === "shipped")!.id).toBe(shipped.id);
    expect(await prisma.checkInComment.count({ where: { itemId: shipped.id } })).toBe(1);
    // Comments name the item by its field and text; the server finds it
    await runOp(f.ctx, { op: "comment.add", ownerId: f.memberId, section: "next", itemText: "Ship the API", text: "Big one" });
    const snapshot = await loadSnapshot(f.ctx);
    expect(snapshot.comments.map((c) => [c.section, c.itemText, c.text])).toContainEqual(["next", "Ship the API", "Big one"]);
    expect(snapshot.checkIns[f.memberId]?.next).toEqual(["Write the docs", "Ship the API"]);
  });

  it("archives a versioned record and moves the presented items to the session", async () => {
    const s = await archive("A good week", ["kudos"]);
    expect(s.summary).toBe("A good week");
    const record = parseRecord(s.record)!;
    expect(record).toMatchObject({ v: 1, omit: ["kudos"] });
    expect(record.checkIns[f.memberId]!.items.filter((i) => !i.projectId).map((i) => i.text)).toEqual([
      "shipped",
      "Fixed the login",
      "Write the docs",
      "Ship the API",
      "No staging access",
    ]);
    const shipped = record.checkIns[f.memberId]!.items.find((i) => i.text === "shipped")!;
    expect(record.comments.map((c) => c.itemId)).toContain(shipped.id);
    expect(await drafts()).toEqual([]);
    expect(await prisma.checkInItem.count({ where: { sessionId: s.id, personId: f.memberId, projectId: null } })).toBe(5);
    // What was planned shows up for the next check-in
    expect((await loadSnapshot(f.ctx)).lastWeek[f.memberId]).toEqual({ date: s.date, next: ["Write the docs", "Ship the API"] });
    // Minutes from the record, with the summary first, in any language
    const md = minutesToMarkdown(buildMinutes(record, "fr", { summary: s.summary }));
    expect(md).toContain("## Synthèse\nA good week");
    expect(md).toContain("**Fait cette semaine**\n- shipped\n  - Person 1: nice");
  });

  it("links an achievement to the item planned last time", async () => {
    await runOp(f.ctx, {
      op: "checkIn.save",
      memberId: f.memberId,
      ...empty,
      done: ["Wrote the docs", "Unplanned fix"],
      blockers: ["No staging access"],
    });
    const plans = await prisma.checkInItem.findMany({ where: { meetingId: f.meetingId, role: "plan", sessionId: { not: null } } });
    const docs = plans.find((p) => p.text === "Write the docs")!;
    const items = await drafts();
    expect(items.find((i) => i.text === "Wrote the docs")!.sourceItemId).toBe(docs.id);
    expect(items.find((i) => i.text === "Unplanned fix")!.sourceItemId).toBeNull();
    // Saved again: the link stays, nothing is duplicated
    await runOp(f.ctx, {
      op: "checkIn.save",
      memberId: f.memberId,
      ...empty,
      done: ["Wrote the docs", "Unplanned fix"],
      blockers: ["No staging access"],
    });
    expect((await drafts()).map((i) => i.sourceItemId)).toEqual([docs.id, null, null]);
  });
});

describe("stats", () => {
  it("counts in SQL what was planned and done, blockers, speaking time and actions", async () => {
    await archive();
    const stats = await meetingStats(f.ctx);
    expect(stats.sessions.map((s) => [s.planned, s.done, s.blockers, s.present])).toEqual([
      [0, 0, 1, 2],
      [2, 1, 1, 2],
    ]);
    expect(stats.sessions[0]!.durationMs).toBeGreaterThan(19 * 60_000);
    expect(stats.speaking.find((p) => p.id === f.memberId)).toMatchObject({ avgMs: 150_000, turns: 2 });
    // 150 s against the 120 s default: both turns over, by 30 s
    expect(stats.onTime).toEqual({ ok: 0, total: 2, overMs: 30_000 });
    expect(stats.actions).toMatchObject({ open: 1, resolved: 0, medianDays: null });
    expect(stats.recurring).toEqual([
      expect.objectContaining({ personId: f.memberId, text: "No staging access", dates: expect.any(Array) }),
    ]);
    expect(stats.recurring[0]!.dates).toHaveLength(2);
  });

  it("only reads its own meeting", async () => {
    const other = await meeting(await workspace("records-other"), "Other weekly");
    const stats = await meetingStats(other.ctx);
    expect(stats.sessions).toEqual([]);
    expect(stats.speaking).toEqual([]);
  });
});
