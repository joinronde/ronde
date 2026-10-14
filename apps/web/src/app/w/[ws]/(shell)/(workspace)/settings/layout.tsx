import { getTranslations } from "next-intl/server";
import { type SettingsTab, WorkspaceSettingsTabs } from "@/components/workspace/settings-tabs";
import { pageWorkspace } from "@/lib/server/authz";
import { billingOn } from "@/lib/server/billing";
import { lockedEdition, plansUrl } from "@/lib/server/plans";

export default async function WorkspaceSettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ ws: string }>;
}) {
  const ctx = await pageWorkspace((await params).ws);
  const t = await getTranslations("workspace.settings");
  // A tab of a paid plan the workspace lacks: shown to the administrators who see the suggestions, marked with
  // the plan (its page presents what the plan brings), hidden otherwise
  const tPlans = await getTranslations("modules.editions");
  const hints = (await plansUrl(ctx)) !== null;
  const paid: Partial<Record<SettingsTab, "team" | "enterprise" | null>> = {
    security: lockedEdition(ctx.workspace, "identity.domainCapture"),
    roles: lockedEdition(ctx.workspace, "permissions.customRoles"),
    audit: lockedEdition(ctx.workspace, "compliance.auditLog"),
  };
  const shown = (tab: SettingsTab) => !paid[tab] || hints;
  const tabs: SettingsTab[] = [
    "general",
    ...(ctx.can("workspace.manage") && shown("security") ? (["security"] as const) : []),
    ...(ctx.can("members.manage") && shown("roles") ? (["roles"] as const) : []),
    ...(ctx.can("audit.read") && shown("audit") ? (["audit"] as const) : []),
    ...(billingOn() && ctx.can("workspace.billing") ? (["billing"] as const) : []),
    ...(!billingOn() && hints ? (["plans"] as const) : []),
  ];
  const locked = Object.fromEntries(Object.entries(paid).flatMap(([tab, plan]) => (plan ? [[tab, tPlans(plan)]] : [])));
  return (
    <div className="page">
      <header className="page-head">
        <h1>{t("title")}</h1>
      </header>
      {tabs.length > 1 && <WorkspaceSettingsTabs slug={ctx.workspace.slug} tabs={tabs} locked={locked} />}
      {children}
    </div>
  );
}
