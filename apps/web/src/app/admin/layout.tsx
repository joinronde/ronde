import { getTranslations } from "next-intl/server";
import { AppShell, TopBar } from "@/components/shell/app-shell";
import { pageUser } from "@/lib/server/authz";
import { shellData } from "@/lib/server/shell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await pageUser("/admin");
  const t = await getTranslations("shell");
  return (
    <AppShell data={await shellData(user)}>
      <TopBar crumbs={[{ label: t("admin") }]} />
      <main id="main" className="page-main">
        {children}
      </main>
    </AppShell>
  );
}
