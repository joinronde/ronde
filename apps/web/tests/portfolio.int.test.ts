import { can, type Permission } from "@ronde/core/permissions";
import { prisma, scoped } from "@ronde/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { WorkspaceContext } from "@/lib/server/authz";
import { workspace } from "./fixtures";

// The portfolio dashboard (Team): each project's health week by week from the sheets presented in archived
// sessions, what was achieved for it, the projects gone quiet or overdue; its CSV export and its part of the
// scheduled report

let current: WorkspaceContext;
const mails: { to: string; subject: string; html: string }[] = [];
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/server/authz", async (original) => {
  const real = await original<typeof import("@/lib/server/authz")>();
  return { ...real, authorize: async () => current, currentUser: async () => current.user };
});
vi.mock("@/lib/server/mailer", async (original) => {
  const real = await original<typeof import("@/lib/server/mailer")>();
  return {
    ...real,
    sendEmail: async (m: { to: string; subject: string; html: string }) => {
      mails.push(m);
    },
  };
});

const { enterprise } = await import("@/ee-bridge");
const { GET: exportCsv } = await import("@/app/api/w/[ws]/projects/export/route");
const { sendReport } = await import("@/lib/server/reports");

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const today = iso(Date.now());
/** Monday of the week of a date, as the dashboard counts weeks */
const monday = (date: string) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return iso(d.getTime());
};
const twoWeeksAgo = iso(Date.now() - 14 * DAY);
const lastWeek = iso(Date.now() - 7 * DAY);

let ids: { mobile: string; help: string; billing: string };

/** The minimal record of an archived session that presented some projects */
const record = (date: string, projects: { id: string; name: string; health: "onTrack" | "atRisk" | "offTrack" }[]) => ({
  v: 1,
  date,
  teamName: "Weekly",
  startedAt: null,
  endedAt: null,
  durationMs: 0,
  spent: {},
  participants: [],
  absent: [],
  sections: [],
  checkIns: {},
  projects: projects.map((p) => ({ ...p, status: "active", presented: true })),
  notes: {},
  interactions: [],
  topics: [],
  actions: [],
  names: {},
});

beforeAll(async () => {
  process.env.RONDE_CLOUD = "1";
  const w = await workspace(`portfolio-${Date.now().toString(36)}`);
  await prisma.workspace.update({ where: { id: w.ws.id }, data: { plan: "team" } });
  const principal = { userId: w.user.id, personId: w.host.id, workspaceId: w.ws.id, workspaceRole: "owner" as const };
  current = {
    user: { id: w.user.id, name: w.user.name, email: w.user.email, image: null, locale: null, timezone: null, instanceRole: "user" },
    workspace: { id: w.ws.id, slug: w.ws.slug, name: w.ws.name, locale: "en", timezone: "UTC", plan: "team", settings: {} },
    member: { id: w.member.id, personId: w.host.id, role: "owner" },
    principal,
    db: scoped(prisma, w.ws.id),
    can: (p: Permission) => can(principal, p),
  };
  const workspaceId = w.ws.id;
  const past = iso(Date.now() - 3 * DAY);
  const [mobile, help, , billing] = await Promise.all([
    prisma.project.create({
      data: { workspaceId, slug: "mobile-app", name: "Mobile app", status: "active", targetDate: past, leadId: w.host.id },
    }),
    prisma.project.create({
      data: { workspaceId, slug: "help-center", name: "Help center", status: "active", createdAt: new Date(Date.now() - 60 * DAY) },
    }),
    prisma.project.create({ data: { workspaceId, slug: "new-api", name: "New API", status: "active" } }),
    prisma.project.create({ data: { workspaceId, slug: "billing", name: "Billing", status: "done", targetDate: past } }),
  ]);
  ids = { mobile: mobile.id, help: help.id, billing: billing.id };
  const meeting = await prisma.meeting.create({ data: { workspaceId, name: "Weekly" } });
  for (const [date, health] of [
    [twoWeeksAgo, "onTrack"],
    [lastWeek, "atRisk"],
  ] as const) {
    const s = await prisma.session.create({
      data: {
        workspaceId,
        meetingId: meeting.id,
        date,
        status: "archived",
        record: record(date, [{ id: mobile.id, name: "Mobile app", health }]),
      },
    });
    // Its sheet was presented that day
    await prisma.projectUpdate.create({ data: { workspaceId, meetingId: meeting.id, projectId: mobile.id, sessionId: s.id, health } });
    // Two things achieved for the project last week
    if (date === lastWeek)
      for (const text of ["Login screen", "Push notifications"])
        await prisma.checkInItem.create({
          data: {
            workspaceId,
            meetingId: meeting.id,
            personId: w.host.id,
            sessionId: s.id,
            projectId: mobile.id,
            sectionKey: "done",
            role: "achievement",
            text,
          },
        });
  }
});

afterAll(() => {
  delete process.env.RONDE_CLOUD;
});

describe("portfolio dashboard", () => {
  it("follows each project week by week, and marks the overdue and the quiet ones", async () => {
    const d = await enterprise.portfolio.compute(current.db, { from: iso(Date.now() - 28 * DAY), to: today });
    const week = (date: string) => d.weeks.indexOf(monday(date));
    const mobile = d.projects.find((p) => p.id === ids.mobile)!;
    expect(mobile.healthByWeek[week(twoWeeksAgo)]).toBe("onTrack");
    expect(mobile.healthByWeek[week(lastWeek)]).toBe("atRisk");
    expect(mobile.doneByWeek[week(lastWeek)]).toBe(2);
    expect(mobile).toMatchObject({ lastNews: lastWeek, overdue: true, quiet: false, lead: "Host" });
    // Nothing said about it for two months: quiet; created this week, not yet; finished: neither overdue nor quiet
    expect(d.projects.find((p) => p.name === "New API")).toMatchObject({ quiet: false });
    expect(d.projects.find((p) => p.id === ids.help)).toMatchObject({ quiet: true, overdue: false, lastNews: null });
    expect(d.projects.find((p) => p.id === ids.billing)).toMatchObject({ quiet: false, overdue: false });
  });

  it("exports it as a spreadsheet, one row per project", async () => {
    const res = await exportCsv(new Request(`http://x/api/w/${current.workspace.slug}/projects/export?weeks=4`), {
      params: Promise.resolve({ ws: current.workspace.slug }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/csv/);
    const lines = (await res.text()).replace(/^﻿/, "").trim().split(/\r?\n/);
    expect(lines).toHaveLength(5);
    expect(lines.find((l) => l.includes("Mobile app"))).toBeTruthy();
    expect(lines.find((l) => l.includes("Help center"))).toBeTruthy();
  });

  it("joins the scheduled report", async () => {
    const w = await prisma.workspace.findUniqueOrThrow({ where: { id: current.workspace.id } });
    await sendReport(w, { from: iso(Date.now() - 7 * DAY), to: today }, ["lead@example.test"]);
    const mail = mails.at(-1)!;
    expect(mail.to).toBe("lead@example.test");
    expect(mail.html).toContain("Mobile app");
    expect(mail.html).toContain("Help center");
  });
});
