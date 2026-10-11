import { getTranslations } from "next-intl/server";
import { KudosWallView } from "@/components/workspace/kudos-wall";
import { pageWorkspace } from "@/lib/server/authz";
import { kudosWall } from "@/lib/server/overview";

export async function generateMetadata() {
  const t = await getTranslations("kudosWall");
  return { title: `${t("title")} · Ronde` };
}

export default async function KudosPage({ params }: { params: Promise<{ ws: string }> }) {
  const ctx = await pageWorkspace((await params).ws);
  const wall = await kudosWall(ctx);
  return <KudosWallView slug={ctx.workspace.slug} wall={wall} today={new Date().toISOString().slice(0, 10)} />;
}
