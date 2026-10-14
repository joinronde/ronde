import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BillingView } from "@/components/workspace/billing";
import { pageWorkspace } from "@/lib/server/authz";
import { billingOn, billingView } from "@/lib/server/billing";
import { env } from "@/lib/server/env";

export async function generateMetadata() {
  const t = await getTranslations("billing");
  return { title: `${t("title")} · Ronde` };
}

export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const ctx = await pageWorkspace((await params).ws, "workspace.billing");
  if (!billingOn()) notFound();
  return (
    <BillingView
      slug={ctx.workspace.slug}
      billing={await billingView(ctx)}
      checkout={(await searchParams).checkout ?? null}
      siteUrl={env.siteUrl()}
    />
  );
}
