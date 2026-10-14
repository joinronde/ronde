import { hasFeature } from "@ronde/editions";
import { getTranslations } from "next-intl/server";
import { PlanNotice } from "@/components/plan-notice";
import { InsightsView } from "@/components/workspace/insights";
import { ReportSettings } from "@/components/workspace/report-settings";
import { enterprise } from "@/ee-bridge";
import { pageWorkspace } from "@/lib/server/authz";
import { readEditionOf } from "@/lib/server/license";
import { plansUrl } from "@/lib/server/plans";
import { reportsOn } from "@/lib/server/reports";

export async function generateMetadata() {
  const t = await getTranslations("insights");
  return { title: `${t("title")} · Ronde` };
}

const PERIODS = [4, 12, 26, 52] as const;

export default async function InsightsPage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<{ weeks?: string }>;
}) {
  const ctx = await pageWorkspace((await params).ws, "stats.read");
  if (!hasFeature(readEditionOf(ctx.workspace), "reporting.workspace"))
    return <PlanNotice feature="reporting.workspace" plansUrl={await plansUrl(ctx)} />;
  const asked = Number((await searchParams).weeks);
  const weeks = (PERIODS as readonly number[]).includes(asked) ? asked : 12;
  const to = new Date();
  const from = new Date(to.getTime() - weeks * 7 * 86_400_000);
  const data = await enterprise.insights.compute(ctx.db, { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) });
  const report = ctx.workspace.settings.reports;
  return (
    <InsightsView slug={ctx.workspace.slug} data={data} weeks={weeks} periods={[...PERIODS]}>
      {ctx.can("workspace.manage") && reportsOn(ctx.workspace) && (
        <ReportSettings
          slug={ctx.workspace.slug}
          initial={{
            frequency: report?.frequency ?? "off",
            recipients: report?.recipients ?? "admins",
            emails: (report?.emails ?? []).join("\n"),
          }}
        />
      )}
    </InsightsView>
  );
}
