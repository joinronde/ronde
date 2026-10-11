// SPDX-License-Identifier: LicenseRef-Ronde-EE
// Single sign-on per workspace (OIDC and SAML) on Better Auth's SSO plugin. A provider only signs in the
// addresses of the domains its workspace verified; an existing account of that address is linked to it.

import { sso } from "@better-auth/sso";
import { prisma, type ScopedClient, type ScopedTx } from "@ronde/db";
import type { IdentityHost, SsoProviderInput, SsoProviderView } from "@ronde/editions/ee";

type Db = ScopedClient | ScopedTx;

const domainOf = (email: string) => email.trim().toLowerCase().split("@")[1] ?? "";

/** The workspace and domains of a provider, as Ronde keeps them */
async function providerScope(providerId: string) {
  const row = await prisma.ssoProvider.findUnique({ where: { providerId }, select: { workspaceId: true, domain: true } });
  if (!row?.workspaceId) return null;
  return { workspaceId: row.workspaceId, domains: row.domain.split(",").map((d) => d.trim().toLowerCase()) };
}

/**
 * Who an SSO sign-in is: refused when the address is not of a domain the provider's workspace verified,
 * linked to the existing account of that address, otherwise a new account.
 */
export async function resolveSsoUser(
  host: IdentityHost,
  providerId: string,
  rawEmail: string | undefined,
): Promise<{ action: "continue" } | { action: "link"; userId: string; profile: "preserve" } | { action: "reject"; code: string }> {
  if (!(await host.allowed("identity.saml"))) return { action: "reject", code: "SSO_NOT_IN_PLAN" };
  const scope = await providerScope(providerId);
  const email = rawEmail?.trim().toLowerCase() ?? "";
  if (!scope || !scope.domains.includes(domainOf(email))) return { action: "reject", code: "SSO_DOMAIN_MISMATCH" };
  // The domain is still verified by this workspace (removing it stops its provider)
  const verified = await prisma.workspaceDomain.findFirst({
    where: { workspaceId: scope.workspaceId, domain: domainOf(email), verifiedAt: { not: null } },
    select: { id: true },
  });
  if (!verified) return { action: "reject", code: "SSO_DOMAIN_MISMATCH" };
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  return existing ? { action: "link", userId: existing.id, profile: "preserve" } : { action: "continue" };
}

export function ssoPlugin(host: IdentityHost) {
  return sso({
    // Organizations are not Ronde's model: workspaces are joined below
    organizationProvisioning: { disabled: true },
    provisionUserOnEveryLogin: true,
    resolveUser: (input) => resolveSsoUser(host, input.providerId, input.providerUser.email),
    provisionUser: async ({ user, provider }) => {
      const scope = await providerScope(provider.providerId);
      if (scope) await host.joinWorkspace({ id: user.id, email: user.email, name: user.name }, scope.workspaceId);
    },
  });
}

const pem = (cert: string) => {
  const body = cert.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
  return `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)?.join("\n") ?? body}\n-----END CERTIFICATE-----`;
};

export function ssoRegistration(input: SsoProviderInput, target: { appUrl: string; providerId: string }) {
  const base = `${target.appUrl}/api/auth`;
  const domain = input.domains.join(",");
  if (input.oidc) {
    const issuer = input.oidc.issuer.replace(/\/$/, "");
    return {
      body: {
        providerId: target.providerId,
        issuer,
        domain,
        oidcConfig: {
          clientId: input.oidc.clientId,
          clientSecret: input.oidc.clientSecret,
          discoveryEndpoint: input.oidc.discoveryUrl || `${issuer}/.well-known/openid-configuration`,
          scopes: ["openid", "email", "profile"],
          pkce: true,
        },
      },
      endpoints: { callback: `${base}/sso/callback/${target.providerId}` },
    };
  }
  const saml = input.saml!;
  const entityId = `${base}/sso/saml2/sp/metadata?providerId=${target.providerId}`;
  const callback = `${base}/sso/saml2/sp/acs/${target.providerId}`;
  return {
    body: {
      providerId: target.providerId,
      issuer: saml.idpEntityId,
      domain,
      samlConfig: {
        issuer: entityId,
        entryPoint: saml.entryPoint,
        cert: pem(saml.certificate),
        callbackUrl: callback,
        audience: entityId,
        wantAssertionsSigned: true,
        idpMetadata: {
          entityID: saml.idpEntityId,
          cert: pem(saml.certificate),
          singleSignOnService: [{ Binding: "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect", Location: saml.entryPoint }],
        },
        spMetadata: { entityID: entityId },
        identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
      },
    },
    endpoints: { callback, metadata: entityId, entityId },
  };
}

export async function listSso(db: Db): Promise<SsoProviderView[]> {
  const rows = await db.ssoProvider.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    providerId: r.providerId,
    name: r.name,
    kind: r.samlConfig ? "saml" : "oidc",
    issuer: r.issuer,
    domains: r.domain.split(",").filter(Boolean),
  }));
}
