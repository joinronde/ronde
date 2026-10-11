import { RondeProvider } from "@/components/ronde-provider";
import { requestLocale } from "@/lib/server/locale";
import { type MeetingPageParams, pageMeeting } from "@/lib/server/meeting/page";
import { loadSnapshot } from "@/lib/server/meeting/state";

export const dynamic = "force-dynamic";

// Projection tab: no header, nothing but the stage
export default async function ScreenLayout({ children, ...props }: MeetingPageParams & { children: React.ReactNode }) {
  const initial = await loadSnapshot(await pageMeeting(props), await requestLocale());
  return <RondeProvider initial={initial}>{children}</RondeProvider>;
}
