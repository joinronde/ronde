import { getTranslations } from "next-intl/server";
import { PlanNotice } from "@/components/plan-notice";
import { SecurityView } from "@/components/workspace/security";
import { enterprise } from "@/ee-bridge";
import { SSO_PROVIDERS, signInProviders } from "@/lib/server/auth";
import { pageWorkspace } from "@/lib/server/authz";
import { domainsOn, ssoEnforcementOn } from "@/lib/server/domains";
import { identityHost } from "@/lib/server/identity";
import { plansUrl } from "@/lib/server/plans";
import { publicUrl } from "@/lib/server/public-url";

export async function generateMetadata() {
  const t = await getTranslations("security");
  return { title: `${t("title")} · Ronde` };
}

export default async function SecurityPage({ params }: { params: Promise<{ ws: string }> }) {
  const ctx = await pageWorkspace((await params).ws, "workspace.manage");
  if (!domainsOn(ctx.workspace)) return <PlanNotice feature="identity.domainCapture" plansUrl={await plansUrl(ctx)} />;
  const instanceSso = signInProviders().filter((p) => SSO_PROVIDERS.has(p.id));
  const providers = (await identityHost.allowed("identity.saml", ctx.workspace.id)) ? await enterprise.identity.listSso(ctx.db) : null;
  const auth = `${await publicUrl("")}/api/auth`;
  const scimTokens = (await identityHost.allowed("identity.scim", ctx.workspace.id))
    ? await ctx.db.scimToken.findMany({
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true },
      })
    : null;
  const directory = (await identityHost.allowed("identity.ldap", ctx.workspace.id)) ? await ctx.db.ldapDirectory.findFirst({}) : undefined;
  return (
    <SecurityView
      slug={ctx.workspace.slug}
      domains={await enterprise.domains.list(ctx.db)}
      enforcement={ssoEnforcementOn(ctx.workspace)}
      ssoProvider={instanceSso[0]?.name ?? providers?.[0]?.name ?? null}
      ldap={
        directory === undefined
          ? undefined
          : directory && {
              url: directory.url,
              startTls: directory.startTls,
              bindDn: directory.bindDn,
              baseDn: directory.baseDn,
              userFilter: directory.userFilter,
              emailAttribute: directory.emailAttribute,
              nameAttribute: directory.nameAttribute,
              enabled: directory.enabled,
              passwordSet: !!directory.bindPassword,
            }
      }
      scim={
        scimTokens
          ? {
              baseUrl: await publicUrl(`/api/scim/v2/${ctx.workspace.slug}`),
              tokens: scimTokens.map((x) => ({
                ...x,
                lastUsedAt: x.lastUsedAt?.toISOString() ?? null,
                createdAt: x.createdAt.toISOString(),
              })),
            }
          : undefined
      }
      providers={
        providers?.map((p) => ({
          ...p,
          callback: p.kind === "saml" ? `${auth}/sso/saml2/sp/acs/${p.providerId}` : `${auth}/sso/callback/${p.providerId}`,
          metadata: p.kind === "saml" ? `${auth}/sso/saml2/sp/metadata?providerId=${p.providerId}` : null,
        })) ?? null
      }
    />
  );
}
