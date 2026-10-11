import { hasFeature } from "@ronde/editions";
import { translator } from "@ronde/i18n";
import { enterprise } from "@/ee-bridge";
import { authorize } from "@/lib/server/authz";
import { csvFile } from "@/lib/server/csv-file";
import { AccessError } from "@/lib/server/errors";
import { errorResponse } from "@/lib/server/http";
import { readEditionOf } from "@/lib/server/license";
import { requestLocale } from "@/lib/server/locale";
import { readableMeetings, visibleWhere } from "@/lib/server/projects";

export const dynamic = "force-dynamic";

// The portfolio dashboard as a spreadsheet (Team): one row per project, its health week by week

export async function GET(req: Request, { params }: { params: Promise<{ ws: string }> }) {
  try {
    const ctx = await authorize((await params).ws, "projects.read");
    if (!hasFeature(readEditionOf(ctx.workspace), "reporting.portfolio")) throw new AccessError(403, "accessDenied");
    const weeks = Math.min(52, Math.max(4, Number(new URL(req.url).searchParams.get("weeks")) || 12));
    const to = new Date();
    const from = new Date(to.getTime() - weeks * 7 * 86_400_000);
    const data = await enterprise.portfolio.compute(
      ctx.db,
      { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      await readableMeetings(ctx),
      new Set((await ctx.db.project.findMany({ where: visibleWhere(ctx), select: { id: true } })).map((p) => p.id)),
    );
    const locale = await requestLocale();
    const t = translator(locale, "projects");
    const status = (s: string) =>
      ["proposed", "active", "paused", "done", "cancelled"].includes(s) ? t(`status.${s}` as "status.active") : s;
    const health = (h: string | null) => (h ? t(`health.${h}` as "health.onTrack") : null);
    const yes = (on: boolean) => (on ? t("csv.yes") : null);
    return csvFile(
      [
        [
          t("dashboard.project"),
          t("theme"),
          t("statusLabel"),
          t("healthLabel"),
          t("lead"),
          t("start"),
          t("target"),
          t("csv.lastNews"),
          t("csv.quiet"),
          t("csv.overdue"),
          t("csv.done"),
          ...data.weeks.map((w) => t("csv.healthOf", { week: w })),
        ],
        ...data.projects.map((p) => [
          p.name,
          p.theme,
          status(p.status),
          health(p.health),
          p.lead,
          p.startDate,
          p.targetDate,
          p.lastNews,
          yes(p.quiet),
          yes(p.overdue),
          p.doneByWeek.reduce((a, b) => a + b, 0),
          ...p.healthByWeek.map(health),
        ]),
      ],
      locale,
      t("csv.fileName"),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
