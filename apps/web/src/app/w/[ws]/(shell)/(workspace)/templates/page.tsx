import type { Locale } from "@ronde/i18n";
import { getLocale, getTranslations } from "next-intl/server";
import { TemplateGallery } from "@/components/workspace/gallery";
import { pageWorkspace } from "@/lib/server/authz";
import { listTemplates } from "@/lib/server/templates";

export async function generateMetadata() {
  const t = await getTranslations("gallery");
  return { title: `${t("title")} · Ronde` };
}

export default async function TemplatesPage({ params }: { params: Promise<{ ws: string }> }) {
  const ctx = await pageWorkspace((await params).ws);
  const templates = await listTemplates(ctx, (await getLocale()) as Locale);
  return <TemplateGallery slug={ctx.workspace.slug} templates={templates} canCreate={ctx.can("meeting.create")} />;
}
