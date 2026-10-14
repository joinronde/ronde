import { redirect } from "next/navigation";
import { homeOf, type MeetingPageParams, pageMeeting } from "@/lib/server/meeting/page";

export const dynamic = "force-dynamic";

// A meeting's own address sends to its home page (the control room for its hosts, "my screen" for the others). It sits
// inside the shell, like the pages it sends to: outside it, opening a meeting from the sidebar took the whole frame
// down and up again on the way
export default async function MeetingHome(props: MeetingPageParams) {
  redirect(homeOf(await pageMeeting(props)));
}
