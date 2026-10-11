import { MeetingFrame } from "@/components/header";
import { RondeProvider } from "@/components/ronde-provider";
import { SampleBanner } from "@/components/sample-banner";
import { AppShell } from "@/components/shell/app-shell";
import { requestLocale } from "@/lib/server/locale";
import { type MeetingPageParams, pageMeeting } from "@/lib/server/meeting/page";
import { loadSnapshot } from "@/lib/server/meeting/state";
import { shellData } from "@/lib/server/shell";

export const dynamic = "force-dynamic";

export default async function MeetingLayout({ children, ...props }: MeetingPageParams & { children: React.ReactNode }) {
  const ctx = await pageMeeting(props);
  const [initial, shell] = await Promise.all([loadSnapshot(ctx, await requestLocale()), shellData(ctx.ws.user, ctx.ws.workspace.slug)]);
  return (
    <AppShell data={shell}>
      <RondeProvider initial={initial}>
        <MeetingFrame />
        <main id="main" className="page-main wide">
          <SampleBanner />
          {children}
        </main>
      </RondeProvider>
    </AppShell>
  );
}
