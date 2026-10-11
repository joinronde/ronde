import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { RondeProvider } from "@/components/ronde-provider";
import { ScreenView } from "@/components/screen";
import { guestContext } from "@/lib/server/guest-links";
import { requestLocale } from "@/lib/server/locale";
import { loadSnapshot } from "@/lib/server/meeting/state";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("pages");
  return { title: t("title", { page: t("screen") }), robots: { index: false, follow: false } };
}

// A guest link: the meeting's shared screen, without an account, until the link expires
export default async function GuestScreenPage({ params }: { params: Promise<{ token: string }> }) {
  const ctx = await guestContext((await params).token);
  if (!ctx) notFound();
  const initial = await loadSnapshot(ctx, await requestLocale());
  return (
    <RondeProvider initial={initial}>
      <ScreenView />
    </RondeProvider>
  );
}
