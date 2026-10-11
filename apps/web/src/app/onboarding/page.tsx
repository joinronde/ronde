import { splitName } from "@ronde/core/slug";
import { isBuiltinTemplate } from "@ronde/core/templates";
import { getTranslations } from "next-intl/server";
import { Onboarding } from "@/components/workspace/onboarding";
import { pageUser } from "@/lib/server/authz";
import { billingOn } from "@/lib/server/billing";
import { pendingInvitationsFor, userWorkspaces } from "@/lib/server/workspaces";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("onboarding");
  return { title: `${t("title")} · Ronde` };
}

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ plan?: string; template?: string }> }) {
  const user = await pageUser("/onboarding");
  const asked = await searchParams;
  const [invitations, workspaces] = await Promise.all([pendingInvitationsFor(user.email), userWorkspaces(user.id)]);
  return (
    <Onboarding
      firstName={splitName(user.name)[0] || user.email}
      invitations={invitations}
      workspaces={workspaces.map(({ slug, name }) => ({ slug, name }))}
      plan={billingOn() && asked.plan === "team" ? "team" : null}
      template={isBuiltinTemplate(asked.template) ? asked.template : null}
    />
  );
}
