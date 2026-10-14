// SPDX-License-Identifier: LicenseRef-Ronde-EE
// Sign-in against a company directory (LDAP, Active Directory): a service account finds the person by
// address, then their own password is checked by binding as them. Nothing of the password is kept.

import { directoryProfile } from "@ronde/core/directory";
import type { IdentityHost, LdapSettings } from "@ronde/editions/ee";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { Client } from "ldapts";
import { z } from "zod";

const TIMEOUT_MS = 8000;

/** Escapes a value for an LDAP search filter (RFC 4515) */
export const escapeFilter = (value: string) => value.replace(/[\\*()\0]/g, (c) => `\\${c.charCodeAt(0).toString(16).padStart(2, "0")}`);

const first = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? "") : v === undefined || v === null ? "" : String(v));

async function connect(s: LdapSettings): Promise<Client> {
  const client = new Client({ url: s.url, timeout: TIMEOUT_MS, connectTimeout: TIMEOUT_MS });
  if (s.startTls) await client.startTLS({ servername: new URL(s.url).hostname });
  return client;
}

/** The directory entries matching an address, found with the service account */
async function find(s: LdapSettings, email: string) {
  const client = await connect(s);
  try {
    await client.bind(s.bindDn, s.bindPassword);
    const filter = s.userFilter.replaceAll("{{email}}", escapeFilter(email));
    const { searchEntries } = await client.search(s.baseDn, {
      scope: "sub",
      filter,
      // Attribute names match whatever their case: asked in lower case, which every directory understands
      attributes: [
        s.emailAttribute,
        s.nameAttribute,
        ...[s.phoneAttribute, s.teamAttribute, s.birthdayAttribute].map((x) => x?.toLowerCase()),
      ].filter((a): a is string => !!a),
      sizeLimit: 2,
    });
    return searchEntries;
  } finally {
    await client.unbind().catch(() => {});
  }
}

export async function ldapAuthenticate(s: LdapSettings, rawEmail: string, password: string) {
  const email = rawEmail.trim().toLowerCase();
  // An empty password would be an anonymous bind, which many directories accept
  if (!email || !password) return null;
  const entries = await find(s, email);
  // Exactly one person, holding exactly this address
  if (entries.length !== 1) return null;
  const entry = entries[0]!;
  if (first(entry[s.emailAttribute]).toLowerCase() !== email) return null;
  const client = await connect(s);
  try {
    await client.bind(entry.dn, password);
  } catch {
    return null;
  } finally {
    await client.unbind().catch(() => {});
  }
  // Attribute names are case-insensitive in LDAP: "telephoneNumber" may come back as "telephonenumber"
  const read = (attribute: string | undefined) => {
    if (!attribute) return undefined;
    const key = Object.keys(entry).find((k) => k.toLowerCase() === attribute.toLowerCase());
    return key ? first(entry[key]) : undefined;
  };
  return {
    email,
    name: first(entry[s.nameAttribute]) || email.split("@")[0]!,
    profile: directoryProfile({ phone: read(s.phoneAttribute), team: read(s.teamAttribute), birthday: read(s.birthdayAttribute) }),
  };
}

export async function ldapTest(s: LdapSettings, sampleEmail: string) {
  try {
    return { ok: true as const, found: (await find(s, sampleEmail.trim().toLowerCase())).length };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

/** POST /sign-in/ldap: an address and its directory password open a Ronde session */
export function ldapPlugin(host: IdentityHost) {
  return {
    id: "ronde-ldap",
    endpoints: {
      signInLdap: createAuthEndpoint(
        "/sign-in/ldap",
        {
          method: "POST",
          body: z.object({ email: z.string().email(), password: z.string().min(1).max(500), rememberMe: z.boolean().optional() }),
        },
        async (ctx) => {
          const { email, password, rememberMe } = ctx.body;
          // No directory for this address (or not in the license): the client falls back to the Ronde password
          // Only directories of workspaces that may use them (the host checks the plan or the license)
          const directory = await host.ldapDirectoryFor(email);
          if (!directory) throw new APIError("NOT_FOUND", { code: "NO_DIRECTORY", message: "NO_DIRECTORY" });
          const person = await ldapAuthenticate(directory, email, password).catch(() => null);
          if (!person) throw new APIError("UNAUTHORIZED", { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" });
          const found = await ctx.context.internalAdapter.findUserByEmail(person.email);
          // The directory vouches for the address: a new account is created verified
          const user =
            found?.user ??
            (await ctx.context.internalAdapter.createUser(
              { email: person.email, name: person.name, emailVerified: true },
              { method: "ldap" },
            ));
          await host.joinWorkspace({ id: user.id, email: user.email, name: user.name }, directory.workspaceId, person.profile);
          const session = await ctx.context.internalAdapter.createSession(user.id, rememberMe === false);
          await setSessionCookie(ctx, { session, user }, rememberMe === false);
          return ctx.json({ user: { id: user.id, email: user.email, name: user.name }, redirect: false });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
