import { getTranslations } from "next-intl/server";
import { DecisionLog } from "@/components/decision-log";
import { type MeetingPageParams, pageMeeting } from "@/lib/server/meeting/page";

export async function generateMetadata() {
  const t = await getTranslations("pages");
  return { title: t("title", { page: t("decisions") }) };
}

export default async function Page(props: MeetingPageParams) {
  await pageMeeting(props);
  return <DecisionLog />;
}
