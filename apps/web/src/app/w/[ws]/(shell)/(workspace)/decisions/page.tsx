import { localDate } from "@ronde/core/schedule";
import type { Locale } from "@ronde/i18n";
import { getLocale, getTranslations } from "next-intl/server";
import { DecisionsView } from "@/components/workspace/decisions";
import { pageWorkspace } from "@/lib/server/authz";
import { workspaceDecisions } from "@/lib/server/overview";

export async function generateMetadata() {
  const t = await getTranslations("decisionsPage");
  return { title: `${t("title")} · Ronde` };
}

export default async function DecisionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ ws: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const ctx = await pageWorkspace((await params).ws);
  const q = ((await searchParams).q ?? "").slice(0, 100);
  const decisions = await workspaceDecisions(ctx, (await getLocale()) as Locale, q);
  // Today where the person is, for the periods ("the last 30 days")
  const today = localDate(Date.now(), ctx.user.timezone ?? ctx.workspace.timezone);
  return <DecisionsView slug={ctx.workspace.slug} query={q} decisions={decisions} today={today} />;
}
