import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ProjectView } from "@/components/workspace/project";
import { pageWorkspace } from "@/lib/server/authz";
import { loadProject } from "@/lib/server/projects";

export async function generateMetadata({ params }: { params: Promise<{ ws: string; slug: string }> }) {
  const t = await getTranslations("projects");
  const { slug } = await params;
  return { title: `${decodeURIComponent(slug)} · ${t("title")} · Ronde` };
}

export default async function ProjectPage({ params }: { params: Promise<{ ws: string; slug: string }> }) {
  const { ws, slug } = await params;
  const ctx = await pageWorkspace(ws, "projects.read");
  const page = await loadProject(ctx, decodeURIComponent(slug));
  if (!page) notFound();
  return <ProjectView slug={ctx.workspace.slug} page={page} />;
}
