import { getTranslations } from "next-intl/server";
import { MeView } from "@/components/me";
import { hostWithoutCheckIn, type MeetingPageParams, pageMeeting } from "@/lib/server/meeting/page";

export async function generateMetadata() {
  const t = await getTranslations("pages");
  return { title: t("title", { page: t("me") }) };
}

export default async function Page(props: MeetingPageParams) {
  hostWithoutCheckIn(await pageMeeting(props));
  return <MeView />;
}
