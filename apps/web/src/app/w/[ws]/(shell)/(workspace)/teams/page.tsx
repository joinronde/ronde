import { getTranslations } from "next-intl/server";
import { TeamsBoard } from "@/components/workspace/teams-board";
import { pageWorkspace } from "@/lib/server/authz";
import { personName } from "@/lib/server/meeting/dto";

export async function generateMetadata() {
  const t = await getTranslations("orgTeams");
  return { title: `${t("title")} · Ronde` };
}

export default async function TeamsPage({ params }: { params: Promise<{ ws: string }> }) {
  const ctx = await pageWorkspace((await params).ws, "people.read");
  const [teams, people] = await Promise.all([
    ctx.db.jobCategory.findMany({
      orderBy: [{ position: "asc" }, { name: "asc" }],
      select: { id: true, name: true, color: true, icon: true, parentId: true },
    }),
    ctx.db.person.findMany({
      where: { deprovisionedAt: null, active: true },
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: { id: true, firstName: true, lastName: true, color: true, jobCategoryId: true, avatar: { select: { updatedAt: true } } },
    }),
  ]);
  return (
    <TeamsBoard
      slug={ctx.workspace.slug}
      teams={teams}
      people={people.map((p) => ({
        id: p.id,
        name: personName(p),
        color: p.color,
        avatar: p.avatar?.updatedAt.getTime() ?? null,
        teamId: p.jobCategoryId,
      }))}
      canManage={ctx.can("workspace.manage")}
    />
  );
}
