import { hasFeature } from "@ronde/editions";
import { getTranslations } from "next-intl/server";
import { PlanNotice } from "@/components/plan-notice";
import { PortfolioView } from "@/components/workspace/projects";
import { enterprise } from "@/ee-bridge";
import { pageWorkspace } from "@/lib/server/authz";
import { readEditionOf } from "@/lib/server/license";
import { plansUrl } from "@/lib/server/plans";
import { projectSyncOn, type SourceKind } from "@/lib/server/project-sources";
import { loadPortfolio, readableMeetings } from "@/lib/server/projects";
import { listTrackers, trackersOn } from "@/lib/server/trackers";

export async function generateMetadata() {
  const t = await getTranslations("projects");
  return { title: `${t("title")} · Ronde` };
}

const PERIODS = [4, 12, 26, 52] as const;

export default async function ProjectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<{ view?: string; weeks?: string; new?: string }>;
}) {
  const ctx = await pageWorkspace((await params).ws, "projects.read");
  const query = await searchParams;
  const portfolio = await loadPortfolio(ctx);
  const dashboardOn = hasFeature(readEditionOf(ctx.workspace), "reporting.portfolio");
  const view = query.view === "dashboard" ? "dashboard" : "board";
  const asked = Number(query.weeks);
  const weeks = (PERIODS as readonly number[]).includes(asked) ? asked : 12;
  let dashboard = null;
  if (view === "dashboard" && dashboardOn) {
    const to = new Date();
    const from = new Date(to.getTime() - weeks * 7 * 86_400_000);
    dashboard = await enterprise.portfolio.compute(
      ctx.db,
      { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
      await readableMeetings(ctx),
      new Set(portfolio.projects.map((p) => p.id)),
    );
  }
  // Where projects can be imported from: the workspace's saved issue trackers (Team), for the administrators
  // who saved them, then any tool
  const canManageTrackers = trackersOn(ctx.workspace) && ctx.can("connectors.manage");
  const trackers =
    portfolio.canCreate && canManageTrackers
      ? (await listTrackers(ctx)).map((tr) => ({
          id: tr.id,
          kind: tr.kind as SourceKind,
          name: tr.name,
          where: tr.config.repo ?? tr.config.project ?? tr.config.team ?? "",
        }))
      : [];
  return (
    <PortfolioView
      slug={ctx.workspace.slug}
      portfolio={portfolio}
      view={view}
      dashboard={dashboard}
      weeks={weeks}
      periods={[...PERIODS]}
      locked={dashboardOn || view !== "dashboard" ? null : <PlanNotice feature="reporting.portfolio" plansUrl={await plansUrl(ctx)} />}
      dashboardOn={dashboardOn}
      openNew={query.new === "1"}
      trackers={trackers}
      syncOn={projectSyncOn(ctx.workspace)}
      canManageTrackers={canManageTrackers}
    />
  );
}
