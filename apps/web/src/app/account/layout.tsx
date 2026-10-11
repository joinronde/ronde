import { getTranslations } from "next-intl/server";
import { AppShell, TopBar } from "@/components/shell/app-shell";
import { AccountHeader } from "@/components/workspace/account";
import { accountPhoto } from "@/lib/server/account-photo";
import { pageUser } from "@/lib/server/authz";
import { shellData } from "@/lib/server/shell";

export const dynamic = "force-dynamic";

// The account's pages: who is signed in on top, then one page per tab (profile, security, notifications, workspaces)
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await pageUser("/account");
  const t = await getTranslations("shell");
  return (
    <AppShell data={await shellData(user)}>
      <TopBar crumbs={[{ label: t("account") }]} />
      <main id="main" className="page-main">
        <div className="page narrow settings-page account-page">
          <AccountHeader user={{ name: user.name, email: user.email }} photo={await accountPhoto(user.id)} />
          {children}
        </div>
      </main>
    </AppShell>
  );
}
