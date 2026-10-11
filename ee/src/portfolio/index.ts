// SPDX-License-Identifier: LicenseRef-Ronde-EE
// Portfolio dashboard: how each project of the workspace went over a period, week by week, from the sheets
// presented and the items written about it. Projects gone quiet and overdue ones stand out.

import { parseRecord } from "@ronde/core/record";
import type { ScopedClient, ScopedTx } from "@ronde/db";
import type { EnterpriseEdition, PortfolioDTO, ProjectHealthValue } from "@ronde/editions/ee";

type Db = ScopedClient | ScopedTx;

const DAY = 86_400_000;
/** Monday of the week of a date (YYYY-MM-DD) */
const weekOf = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const plusDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
/** A project is quiet when nothing was said about it for this long */
const QUIET_DAYS = 21;
/** How far before the period the last news of a project is looked for (older news reads as none) */
const LOOK_BACK_DAYS = 182;

export async function compute(
  db: Db,
  period: { from: string; to: string },
  readable: Set<string> | null = null,
  visible: Set<string> | null = null,
): Promise<PortfolioDTO> {
  const weeks: string[] = [];
  for (let w = weekOf(period.from); w <= period.to; w = plusDays(w, 7)) weeks.push(w);
  const index = new Map(weeks.map((w, i) => [w, i]));
  const [projects, sessions] = await Promise.all([
    db.project.findMany({
      where: { archivedAt: null, ...(visible ? { id: { in: [...visible] } } : {}) },
      orderBy: [{ position: "asc" }, { name: "asc" }],
      include: { theme: { select: { name: true } }, lead: { select: { firstName: true, lastName: true } } },
    }),
    // Archived sessions that spoke of a project: the period's, and those of the half-year before for the last news
    db.session.findMany({
      where: {
        status: "archived",
        date: { gte: plusDays(period.from, -LOOK_BACK_DAYS), lte: period.to },
        OR: [{ projectUpdates: { some: {} } }, { items: { some: { projectId: { not: null } } } }],
      },
      select: { id: true, date: true, meetingId: true, record: true },
      orderBy: { date: "asc" },
    }),
  ]);
  const seen = sessions.filter((s) => !readable || readable.has(s.meetingId));
  const done = await db.checkInItem.groupBy({
    by: ["projectId", "sessionId"],
    where: { sessionId: { in: seen.map((s) => s.id) }, projectId: { not: null }, role: "achievement" },
    _count: { _all: true },
  });
  const byProject = new Map(
    projects.map((p) => [
      p.id,
      {
        health: new Array<ProjectHealthValue | null>(weeks.length).fill(null),
        done: new Array<number>(weeks.length).fill(0),
        last: null as string | null,
      },
    ]),
  );
  for (const s of seen) {
    const record = parseRecord(s.record);
    const w = index.get(weekOf(s.date));
    for (const p of record?.projects ?? []) {
      const x = byProject.get(p.id);
      if (!x) continue;
      if (!x.last || s.date > x.last) x.last = s.date;
      if (w !== undefined && s.date >= period.from && p.health) x.health[w] = p.health;
    }
  }
  const dateOf = new Map(seen.map((s) => [s.id, s.date]));
  for (const d of done) {
    const date = d.sessionId ? dateOf.get(d.sessionId) : undefined;
    const x = d.projectId ? byProject.get(d.projectId) : undefined;
    const w = date && date >= period.from ? index.get(weekOf(date)) : undefined;
    if (x && w !== undefined) x.done[w]! += d._count._all;
  }
  return {
    ...period,
    weeks,
    projects: projects.map((p) => {
      const x = byProject.get(p.id)!;
      const quietSince = plusDays(period.to, -QUIET_DAYS);
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        theme: p.theme?.name ?? "",
        status: p.status,
        health: p.health,
        lead: p.lead ? `${p.lead.firstName} ${p.lead.lastName}`.trim() : "",
        startDate: p.startDate,
        targetDate: p.targetDate,
        healthByWeek: x.health,
        doneByWeek: x.done,
        lastNews: x.last,
        quiet: p.status === "active" && (!x.last || x.last < quietSince),
        overdue: !!p.targetDate && p.targetDate < period.to && !["done", "cancelled"].includes(p.status),
      };
    }),
  };
}

export const portfolio: EnterpriseEdition["portfolio"] = { compute };
