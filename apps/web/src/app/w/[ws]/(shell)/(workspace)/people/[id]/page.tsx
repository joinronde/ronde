import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PersonProfile } from "@/components/workspace/profile";
import { pageWorkspace } from "@/lib/server/authz";
import { personProfile } from "@/lib/server/profile";

export async function generateMetadata() {
  const t = await getTranslations("people");
  return { title: `${t("title")} · Ronde` };
}

export default async function PersonPage({ params }: { params: Promise<{ ws: string; id: string }> }) {
  const { ws, id } = await params;
  const ctx = await pageWorkspace(ws, "people.read");
  const profile = await personProfile(ctx, id);
  if (!profile) notFound();
  return <PersonProfile slug={ctx.workspace.slug} profile={profile} />;
}
