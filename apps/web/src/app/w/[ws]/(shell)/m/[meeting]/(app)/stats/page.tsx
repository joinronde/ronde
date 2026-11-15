import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { StatsView } from "@/components/stats";
import { type MeetingPageParams, pageMeeting } from "@/lib/server/meeting/page";

export async function generateMetadata() {
  const t = await getTranslations("pages");
  return { title: t("title", { page: t("stats") }) };
}

export default async function Page(props: MeetingPageParams) {
  // Whoever reads the statistics: the hosts, and a custom role that grants them (an "Auditor")
  const ctx = await pageMeeting(props);
  if (!ctx.can("stats.read")) redirect(`${ctx.links.path}/me`);
  return <StatsView />;
}
