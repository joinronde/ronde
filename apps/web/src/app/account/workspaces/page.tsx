import { getTranslations } from "next-intl/server";
import { AccountWorkspacesView } from "@/components/workspace/account";
import { pageUser } from "@/lib/server/authz";
import { userWorkspaces } from "@/lib/server/workspaces";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("account");
  return { title: `${t("tabs.workspaces")} · ${t("title")} · Ronde` };
}

/** The workspaces the person belongs to */
export default async function AccountWorkspacesPage() {
  const user = await pageUser("/account/workspaces");
  const workspaces = await userWorkspaces(user.id);
  return (
    <AccountWorkspacesView workspaces={workspaces.map((w) => ({ slug: w.slug, name: w.name, role: w.members[0]?.role ?? "member" }))} />
  );
}
