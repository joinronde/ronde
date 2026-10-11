import { isTheme } from "@ronde/core/appearance";
import { prisma } from "@ronde/db";
import { getTranslations } from "next-intl/server";
import { AccountProfileView } from "@/components/workspace/account";
import { accountPhoto } from "@/lib/server/account-photo";
import { pageUser } from "@/lib/server/authz";
import { env } from "@/lib/server/env";
import { userWorkspaces } from "@/lib/server/workspaces";
import { HIDE_UPGRADE_HINTS } from "@/lib/shared/prefs";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("account");
  return { title: `${t("tabs.profile")} · ${t("title")} · Ronde` };
}

/** The account's profile: photo, name, language, time zone, appearance */
export default async function AccountPage() {
  const user = await pageUser("/account");
  const [workspaces, themePref, hintsPref, photo] = await Promise.all([
    userWorkspaces(user.id),
    prisma.userPref.findUnique({ where: { userId_key: { userId: user.id, key: "theme" } } }),
    prisma.userPref.findUnique({ where: { userId_key: { userId: user.id, key: HIDE_UPGRADE_HINTS } } }),
    accountPhoto(user.id),
  ]);
  // The people who choose a plan see its suggestions: only they get the switch (unless the instance turned them off)
  const admin = workspaces.some((w) => ["owner", "admin", "billing"].includes(w.members[0]?.role ?? ""));
  return (
    <AccountProfileView
      user={{ name: user.name, email: user.email, locale: user.locale ?? "", timezone: user.timezone ?? "" }}
      photo={photo}
      theme={isTheme(themePref?.value) ? themePref.value : "system"}
      upgradeHints={admin && !env.hideUpgradeHints() ? !hintsPref : null}
    />
  );
}
