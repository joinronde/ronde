import { roundTableFaces } from "@ronde/ui/faces";
import { Logo } from "@ronde/ui/logo";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { RoundTableArt } from "@/components/auth/round-table-art";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Icon } from "@/components/shell/icons";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { env } from "@/lib/server/env";
import { isCloud } from "@/lib/server/license";

export const dynamic = "force-dynamic";

// Sign-in, sign-up, invitations, password reset: the round table on one side, the form on the other
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("authBrand");
  // In the cloud, a way back to the public site, for someone who came to look rather than to sign in
  const site = isCloud() ? env.siteUrl() : null;
  return (
    <div className="auth-shell">
      <aside className="auth-brand">
        <Link href="/" className="auth-logo">
          <Logo motion="loop" />
          <span>Ronde</span>
        </Link>
        <RoundTableArt faces={roundTableFaces()} />
        <div className="auth-pitch">
          <p className="auth-headline">{t("headline")}</p>
          <p className="auth-lead">{t("lead")}</p>
        </div>
      </aside>
      <main className="auth-main" id="main">
        <div className="auth-panel">{children}</div>
        <footer className="auth-footer">
          {site && (
            <a className="auth-back" href={`${site}/${await getLocale()}`}>
              <Icon name="chevronLeft" size={16} />
              {t("backToSite", { site: new URL(site).host })}
            </a>
          )}
          <LocaleSwitcher up />
          <ThemeSwitcher />
        </footer>
      </main>
    </div>
  );
}
