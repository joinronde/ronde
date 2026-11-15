import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PlansOverview } from "@/components/plans-overview";
import { pageWorkspace } from "@/lib/server/authz";
import { billingOn } from "@/lib/server/billing";
import { editionOf } from "@/lib/server/license";
import { plansUrl } from "@/lib/server/plans";

export async function generateMetadata() {
  const t = await getTranslations("plansPage");
  return { title: `${t("title")} · Ronde` };
}

/** The paid plans, in one place: what Team and Enterprise add to the Community Edition, and where to get them */
export default async function PlansPage({ params }: { params: Promise<{ ws: string }> }) {
  const ctx = await pageWorkspace((await params).ws);
  // The administrators, and whoever pays (the "billing" role, which sees the plans' tab)
  if (!ctx.can("workspace.manage") && !ctx.can("workspace.billing")) redirect(`/w/${ctx.workspace.slug}`);
  // In the cloud, a workspace changes its plan from its billing page
  if (billingOn()) redirect(`/w/${ctx.workspace.slug}/settings/billing`);
  const url = await plansUrl(ctx);
  if (!url) notFound();
  return <PlansOverview edition={editionOf(ctx.workspace)} plansUrl={url} />;
}
