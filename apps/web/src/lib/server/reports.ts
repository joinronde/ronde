import "server-only";
import { prisma, scoped } from "@ronde/db";
import { resolveLocale } from "@ronde/i18n";
import { enterprise } from "@/ee-bridge";
import type { WorkspaceSettings } from "./authz";
import { emailBrand } from "./branding";
import { env } from "./env";
import { featureOn, loadLicense, type PlanScope } from "./license";
import { sendEmail } from "./mailer";
import { zonedClock } from "./reminders";

// Insights by email (Team): checked every hour, sent once per period whatever the number of replicas

export const reportsOn = (ws: PlanScope) => featureOn("reporting.scheduled", ws);

type Workspace = { id: string; slug: string; name: string; locale: string; settings: unknown; plan?: string | null };

async function recipients(w: Workspace, report: NonNullable<WorkspaceSettings["reports"]>): Promise<string[]> {
  if (report.recipients === "custom") return report.emails;
  const admins = await prisma.workspaceMember.findMany({
    where: { workspaceId: w.id, status: "active", role: { in: ["owner", "admin"] } },
    select: { user: { select: { email: true } } },
  });
  return admins.map((a) => a.user.email);
}

/** Builds the report of a period and sends it; returns the number of emails sent */
export async function sendReport(w: Workspace, period: { from: string; to: string }, to: string[]): Promise<number> {
  const db = scoped(prisma, w.id);
  const data = await enterprise.insights.compute(db, period);
  // The portfolio joins the report when the plan has its dashboard and the workspace has projects
  if (featureOn("reporting.portfolio", w) && (await db.project.count({ where: { archivedAt: null } })))
    // Projects seen by their members only stay out of a report that may go to other people
    data.portfolio = await enterprise.portfolio.compute(
      db,
      period,
      null,
      new Set((await db.project.findMany({ where: { archivedAt: null, visibility: "workspace" }, select: { id: true } })).map((p) => p.id)),
    );
  const locale = resolveLocale(w.locale);
  const base = env.appUrl();
  const brand = await emailBrand(w.id);
  const mail = enterprise.reports.email(data, {
    locale,
    workspace: w.name,
    url: base ? `${base}/w/${w.slug}/insights` : "",
    ...(brand ? { logo: brand.logo } : {}),
  });
  let sent = 0;
  for (const address of to) {
    try {
      await sendEmail({ to: address, ...mail });
      sent++;
    } catch (e) {
      console.error(`[reports] sending the report of workspace ${w.id} failed`, e);
    }
  }
  return sent;
}

/** Job: sends the reports that are due; returns the number of emails sent */
export async function checkReports(now = new Date()): Promise<number> {
  await loadLicense();
  const workspaces = await prisma.workspace.findMany({
    where: { deletedAt: null },
    select: { id: true, slug: true, name: true, locale: true, timezone: true, plan: true, settings: true },
  });
  let sent = 0;
  for (const w of workspaces) {
    if (!reportsOn(w)) continue;
    const report = ((w.settings ?? {}) as WorkspaceSettings).reports;
    if (!report) continue;
    const due = enterprise.reports.due(report.frequency, zonedClock(now, w.timezone || "UTC"));
    if (!due || report.lastSentFor === due.key) continue;
    // Taken once: the replica whose update changes the row sends it
    const taken = await prisma.$executeRaw`
      UPDATE "Workspace" SET "settings" = jsonb_set("settings", '{reports,lastSentFor}', to_jsonb(${due.key}::text))
      WHERE "id" = ${w.id} AND ("settings" #>> '{reports,lastSentFor}') IS DISTINCT FROM ${due.key}`;
    if (!taken) continue;
    sent += await sendReport(w, due, await recipients(w, report));
  }
  return sent;
}
