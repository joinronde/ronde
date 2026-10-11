// SPDX-License-Identifier: LicenseRef-Ronde-EE
// Workspace insights: how every meeting is doing over a period, from the records of its archived sessions,
// its check-in items (planned → done) and its actions. One engagement score per meeting sums it up.

import { parseRecord, type RecordV1 } from "@ronde/core/record";
import { median } from "@ronde/core/stats";
import type { ScopedClient, ScopedTx } from "@ronde/db";
import type { EnterpriseEdition, InsightsDTO, MeetingInsight } from "@ronde/editions/ee";

type Db = ScopedClient | ScopedTx;

const ratio = (num: number, den: number) => (den > 0 ? num / den : null);
const mean = (v: (number | null)[]) => {
  const xs = v.filter((x): x is number => x !== null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};

/** Interactions that show people taking part: questions, raised hands, kudos, icebreaker answers */
const interactions = (r: RecordV1) => r.interactions.length + r.kudos.length + (r.icebreaker?.answers.length ?? 0);

/**
 * Engagement, 0..100. Weights: attendance 30, follow-through 25, participation 20 (two interactions per
 * person and session count as full), mood 15, punctuality 10. Missing parts are left out of the average.
 */
export function engagement(p: {
  attendance: number | null;
  followThrough: number | null;
  participation: number | null;
  mood: number | null;
  onTime: number | null;
}) {
  const parts: [number | null, number][] = [
    [p.attendance, 30],
    [p.followThrough, 25],
    [p.participation === null ? null : Math.min(1, p.participation / 2), 20],
    [p.mood === null ? null : (p.mood - 1) / 4, 15],
    [p.onTime, 10],
  ];
  const known = parts.filter((x): x is [number, number] => x[0] !== null);
  const weight = known.reduce((a, [, w]) => a + w, 0);
  return weight ? Math.round((known.reduce((a, [v, w]) => a + v * w, 0) / weight) * 100) : null;
}

/** Monday of the week of a date (YYYY-MM-DD) */
const weekOf = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

async function compute(db: Db, period: { from: string; to: string }): Promise<InsightsDTO> {
  const inPeriod = { gte: period.from, lte: period.to };
  // The sample meeting is make-believe: the workspace's numbers stay real
  const real = { meeting: { sample: false } };
  const [meetings, sessions, created, done] = await Promise.all([
    db.meeting.findMany({
      where: { archivedAt: null, sample: false },
      select: { id: true, name: true, targetMin: true },
      orderBy: { name: "asc" },
    }),
    db.session.findMany({
      where: { status: "archived", date: inPeriod, record: { not: { equals: null } } as never, ...real },
      select: { id: true, meetingId: true, date: true, record: true },
      orderBy: { date: "asc" },
    }),
    db.action.count({
      where: { createdAt: { gte: new Date(`${period.from}T00:00:00Z`), lte: new Date(`${period.to}T23:59:59Z`) }, ...real },
    }),
    db.action.findMany({
      where: { status: "done", doneAt: { gte: new Date(`${period.from}T00:00:00Z`), lte: new Date(`${period.to}T23:59:59Z`) }, ...real },
      select: { createdAt: true, doneAt: true },
    }),
  ]);
  const openByMeeting = await db.action.groupBy({ by: ["meetingId"], where: { status: { not: "done" }, ...real }, _count: { _all: true } });
  // Planned items of each session, and how many came back as done at the next one
  const sessionIds = sessions.map((s) => s.id);
  const [planned, followed] = await Promise.all([
    db.checkInItem.groupBy({ by: ["sessionId"], where: { sessionId: { in: sessionIds }, role: "plan" }, _count: { _all: true } }),
    db.checkInItem.findMany({
      where: { role: "achievement", source: { sessionId: { in: sessionIds }, role: "plan" } },
      select: { source: { select: { sessionId: true } } },
    }),
  ]);
  const plannedBy = new Map(planned.map((p) => [p.sessionId, p._count._all]));
  const followedBy = new Map<string, number>();
  for (const f of followed) if (f.source?.sessionId) followedBy.set(f.source.sessionId, (followedBy.get(f.source.sessionId) ?? 0) + 1);

  type Row = {
    date: string;
    present: number;
    expected: number;
    onTime: boolean | null;
    planned: number;
    followed: number;
    acts: number;
    mood: number | null;
    moodVotes: number;
  };
  const rows = new Map<string, Row[]>();
  for (const s of sessions) {
    const r = parseRecord(s.record);
    if (!r) continue;
    const meeting = meetings.find((m) => m.id === s.meetingId);
    if (!meeting) continue;
    const present = r.participants.length;
    const votes = r.mood?.counts.reduce((a, b) => a + b, 0) ?? 0;
    const list = rows.get(s.meetingId) ?? [];
    // The plan of the last session of the period is not due yet
    list.push({
      date: s.date,
      present,
      expected: present + r.absent.length,
      onTime: r.durationMs > 0 ? r.durationMs <= meeting.targetMin * 60_000 : null,
      planned: plannedBy.get(s.id) ?? 0,
      followed: followedBy.get(s.id) ?? 0,
      acts: interactions(r),
      mood: r.mood?.avg ?? null,
      moodVotes: votes,
    });
    rows.set(s.meetingId, list);
  }

  /** Figures of several meetings' sessions; the plan of each meeting's last session is not due yet */
  const aggregate = (lists: Row[][]) => {
    const list = lists.flat();
    const due = lists.flatMap((l) => l.slice(0, -1));
    const attendance = ratio(
      list.reduce((a, r) => a + r.present, 0),
      list.reduce((a, r) => a + r.expected, 0),
    );
    const timed = list.filter((r) => r.onTime !== null);
    const onTime = ratio(timed.filter((r) => r.onTime).length, timed.length);
    const followThrough = ratio(
      due.reduce((a, r) => a + r.followed, 0),
      due.reduce((a, r) => a + r.planned, 0),
    );
    const participation = ratio(
      list.reduce((a, r) => a + r.acts, 0),
      list.reduce((a, r) => a + r.present, 0),
    );
    const moodWeight = list.reduce((a, r) => a + (r.mood === null ? 0 : r.moodVotes), 0);
    const mood = moodWeight ? list.reduce((a, r) => a + (r.mood ?? 0) * r.moodVotes, 0) / moodWeight : null;
    return { attendance, onTime, followThrough, participation, mood };
  };

  const insights: MeetingInsight[] = meetings
    .map((m) => {
      const list = rows.get(m.id) ?? [];
      const figures = aggregate([list]);
      return {
        id: m.id,
        name: m.name,
        sessions: list.length,
        ...figures,
        openActions: openByMeeting.find((o) => o.meetingId === m.id)?._count._all ?? 0,
        engagement: list.length ? engagement(figures) : null,
        // A session alone: its plan is judged at the next one, so the trend leaves it out
        trend: list.map((r) => engagement({ ...aggregate([[r]]), followThrough: null })),
      };
    })
    .sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name));

  const all = [...rows.values()].flat();
  const weeks = new Map<string, Row[]>();
  for (const r of all) weeks.set(weekOf(r.date), [...(weeks.get(weekOf(r.date)) ?? []), r]);
  // Every week of the period, even an empty one
  const weekList: InsightsDTO["weeks"] = [];
  for (let w = weekOf(period.from); w <= period.to; ) {
    const list = weeks.get(w) ?? [];
    weekList.push({
      week: w,
      sessions: list.length,
      attendance: ratio(
        list.reduce((a, r) => a + r.present, 0),
        list.reduce((a, r) => a + r.expected, 0),
      ),
    });
    const d = new Date(`${w}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    w = d.toISOString().slice(0, 10);
  }
  const totals = aggregate([...rows.values()]);
  return {
    from: period.from,
    to: period.to,
    totals: {
      sessions: all.length,
      meetings: insights.filter((m) => m.sessions > 0).length,
      attendance: totals.attendance,
      onTime: totals.onTime,
      followThrough: totals.followThrough,
      mood: totals.mood,
      actionsCreated: created,
      actionsDone: done.length,
      // Never below zero: an action closed the day it was decided took no time, whatever the clocks say
      medianDays: median(done.filter((d) => d.doneAt).map((d) => Math.max(0, d.doneAt!.getTime() - d.createdAt.getTime()) / 86_400_000)),
      engagement: mean(insights.map((m) => m.engagement)) === null ? null : Math.round(mean(insights.map((m) => m.engagement))!),
    },
    weeks: weekList,
    meetings: insights,
  };
}

export const insights: EnterpriseEdition["insights"] = { compute };
