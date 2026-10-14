import { getTranslations } from "next-intl/server";
import { SettingsView } from "@/components/settings";
import { type MeetingPageParams, pageMeeting, requireHostPage } from "@/lib/server/meeting/page";

export async function generateMetadata() {
  const t = await getTranslations("pages");
  return { title: t("title", { page: t("settings") }) };
}

export default async function Page(props: MeetingPageParams) {
  requireHostPage(await pageMeeting(props));
  return <SettingsView />;
}
