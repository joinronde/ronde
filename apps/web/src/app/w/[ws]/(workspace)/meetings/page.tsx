import type { Locale } from "@ronde/i18n";
import { getLocale, getTranslations } from "next-intl/server";
import { MeetingsView } from "@/components/workspace/meetings";
import { pageWorkspace } from "@/lib/server/authz";
import { meetingsOverview } from "@/lib/server/overview";

export async function generateMetadata() {
  const t = await getTranslations("meetingsPage");
  return { title: `${t("title")} · Ronde` };
}

export default async function MeetingsPage({ params }: { params: Promise<{ ws: string }> }) {
  const ctx = await pageWorkspace((await params).ws);
  const meetings = await meetingsOverview(ctx, (await getLocale()) as Locale);
  return <MeetingsView slug={ctx.workspace.slug} meetings={meetings} canCreate={ctx.can("meeting.create")} />;
}
