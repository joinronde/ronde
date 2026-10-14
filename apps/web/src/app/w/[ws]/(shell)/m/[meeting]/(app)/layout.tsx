import { MeetingFrame } from "@/components/header";
import { RondeProvider } from "@/components/ronde-provider";
import { SampleBanner } from "@/components/sample-banner";
import { requestLocale } from "@/lib/server/locale";
import { type MeetingPageParams, pageMeeting } from "@/lib/server/meeting/page";
import { loadSnapshot } from "@/lib/server/meeting/state";

export const dynamic = "force-dynamic";

export default async function MeetingLayout({ children, ...props }: MeetingPageParams & { children: React.ReactNode }) {
  const ctx = await pageMeeting(props);
  const initial = await loadSnapshot(ctx, await requestLocale());
  return (
    <RondeProvider initial={initial}>
      <MeetingFrame />
      <main id="main" className="page-main wide">
        <SampleBanner />
        {children}
      </main>
    </RondeProvider>
  );
}
