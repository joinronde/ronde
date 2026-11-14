import { getTranslations } from "next-intl/server";
import { HistoryView } from "@/components/history";
import { type MeetingPageParams, pageMeeting, requirePagePermission } from "@/lib/server/meeting/page";

export async function generateMetadata() {
  const t = await getTranslations("pages");
  return { title: t("title", { page: t("history") }) };
}

export default async function Page(props: MeetingPageParams) {
  // Read by everyone of the meeting: the drafts, editing and publishing stay with the hosts (the server filters)
  requirePagePermission(await pageMeeting(props), "history.read");
  return <HistoryView />;
}
