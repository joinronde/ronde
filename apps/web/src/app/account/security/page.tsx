import { getAuthenticatorName } from "@better-auth/passkey";
import { prisma } from "@ronde/db";
import { getTranslations } from "next-intl/server";
import { AccountSecurityView } from "@/components/workspace/account";
import { pageUser } from "@/lib/server/authz";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("account");
  return { title: `${t("tabs.security")} · ${t("title")} · Ronde` };
}

/** How the person signs in: password, passkeys, two-step verification, sessions */
export default async function AccountSecurityPage() {
  const user = await pageUser("/account/security");
  const [accounts, extra, passkeys] = await Promise.all([
    prisma.account.findMany({ where: { userId: user.id }, select: { providerId: true } }),
    prisma.user.findUnique({ where: { id: user.id }, select: { twoFactorEnabled: true } }),
    prisma.passkey.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
  ]);
  return (
    <AccountSecurityView
      hasPassword={accounts.some((a) => a.providerId === "credential")}
      twoFactorEnabled={!!extra?.twoFactorEnabled}
      passkeys={passkeys.map((p) => ({
        id: p.id,
        name: p.name ?? "",
        provider: getAuthenticatorName(p.aaguid ?? undefined) ?? null,
        synced: p.backedUp,
        createdAt: p.createdAt?.toISOString().slice(0, 10) ?? null,
      }))}
    />
  );
}
