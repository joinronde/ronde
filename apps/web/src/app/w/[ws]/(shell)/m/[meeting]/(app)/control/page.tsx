import { getTranslations } from "next-intl/server";
import { ControlRoomView } from "@/components/control-room";
import { type MeetingPageParams, pageMeeting, requireHostPage } from "@/lib/server/meeting/page";

export async function generateMetadata() {
  const t = await getTranslations("pages");
  return { title: t("title", { page: t("control") }) };
}

export default async function Page(props: MeetingPageParams) {
  requireHostPage(await pageMeeting(props));
  return <ControlRoomView />;
}
