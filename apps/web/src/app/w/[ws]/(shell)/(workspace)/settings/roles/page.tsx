import { getTranslations } from "next-intl/server";
import { PlanNotice } from "@/components/plan-notice";
import { RolesView } from "@/components/workspace/roles";
import { enterprise } from "@/ee-bridge";
import { pageWorkspace } from "@/lib/server/authz";
import { plansUrl } from "@/lib/server/plans";
import { customRolesOn, customRolesReadable } from "@/lib/server/roles";

export async function generateMetadata() {
  const t = await getTranslations("roles");
  return { title: `${t("title")} · Ronde` };
}

export default async function RolesPage({ params }: { params: Promise<{ ws: string }> }) {
  const ctx = await pageWorkspace((await params).ws, "members.manage");
  if (!customRolesReadable(ctx.workspace)) return <PlanNotice feature="permissions.customRoles" plansUrl={await plansUrl(ctx)} />;
  return <RolesView slug={ctx.workspace.slug} roles={await enterprise.roles.list(ctx.db)} editable={customRolesOn(ctx.workspace)} />;
}
