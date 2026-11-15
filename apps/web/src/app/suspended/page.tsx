import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { pageUser, suspendedFor } from "@/lib/server/authz";
import { userWorkspaces } from "@/lib/server/workspaces";

export async function generateMetadata() {
  const t = await getTranslations("states");
  return { title: `${t("suspendedTitle")} · Ronde` };
}

// Where the pages of a workspace suspended by the Ronde team lead its members. Never a dead end: another
// workspace, a new one, or signing out (the home page passes suspended workspaces over)
export default async function Suspended({ searchParams }: { searchParams: Promise<{ w?: string }> }) {
  const { w = "" } = await searchParams;
  const user = await pageUser(`/w/${w}`);
  const workspace = await suspendedFor(w);
  if (!workspace) notFound();
  const [t, ta] = await Promise.all([getTranslations("states"), getTranslations("auth")]);
  const others = (await userWorkspaces(user.id)).some((o) => !o.suspendedAt);
  // Its owners and administrators are the ones who would know why: they are told who suspended it
  const runsIt = workspace.role === "owner" || workspace.role === "admin";
  return (
    <main id="main" className="state-page">
      <h1>{t("suspendedTitle")}</h1>
      <p className="muted">{t(runsIt ? "suspendedBodyOwner" : "suspendedBody", { workspace: workspace.name })}</p>
      <div className="state-actions">
        {others && (
          <Link href="/" className="btn primary">
            {t("suspendedBack")}
          </Link>
        )}
        <Link href="/onboarding" className={others ? "btn" : "btn primary"}>
          {t("suspendedCreate")}
        </Link>
        <SignOutButton label={ta("signOut")} />
      </div>
    </main>
  );
}
