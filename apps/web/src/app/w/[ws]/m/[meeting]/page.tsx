import { redirect } from "next/navigation";
import { homeOf, type MeetingPageParams, pageMeeting } from "@/lib/server/meeting/page";

export const dynamic = "force-dynamic";

export default async function MeetingHome(props: MeetingPageParams) {
  redirect(homeOf(await pageMeeting(props)));
}
