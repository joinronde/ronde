import "server-only";
import { prisma } from "@ronde/db";
import { canEncrypt, decryptSecret, encryptSecret } from "./secrets";

// Better Auth's SSO plugin keeps an OpenID Connect provider's settings as JSON, its client secret included. The
// database client it is given encrypts that secret on the way in and decrypts it on the way out, with the same
// key as every other token (SECRET_KEY): the plugin reads it as it wrote it, the table never holds it in clear.

const PREFIX = "v1:";

/** The provider's settings with their client secret encrypted (as they are when no key is configured) */
export function sealSsoConfig(raw: unknown): unknown {
  if (typeof raw !== "string" || !canEncrypt()) return raw;
  try {
    const config = JSON.parse(raw) as { clientSecret?: unknown };
    if (typeof config.clientSecret !== "string" || !config.clientSecret || config.clientSecret.startsWith(PREFIX)) return raw;
    return JSON.stringify({ ...config, clientSecret: encryptSecret(config.clientSecret) });
  } catch {
    return raw;
  }
}

/** The provider's settings with their client secret readable again */
export function openSsoConfig(raw: unknown): unknown {
  if (typeof raw !== "string" || !raw.includes(`"${PREFIX}`)) return raw;
  try {
    const config = JSON.parse(raw) as { clientSecret?: unknown };
    if (typeof config.clientSecret !== "string" || !config.clientSecret.startsWith(PREFIX)) return raw;
    return JSON.stringify({ ...config, clientSecret: decryptSecret(config.clientSecret) });
  } catch {
    // The key changed: the provider fails to sign in, and its settings have to be saved again
    return raw;
  }
}

const seal = (data: unknown): unknown =>
  data && typeof data === "object" && "oidcConfig" in data
    ? { ...data, oidcConfig: sealSsoConfig((data as { oidcConfig: unknown }).oidcConfig) }
    : data;
const open = (row: unknown): unknown =>
  row && typeof row === "object" && "oidcConfig" in row
    ? { ...row, oidcConfig: openSsoConfig((row as { oidcConfig: unknown }).oidcConfig) }
    : row;

/** The SSO providers' settings, sealed and opened on their way to and from the table */
const extend = () =>
  prisma.$extends({
    query: {
      ssoProvider: {
        async $allOperations({ args, query }) {
          const a = args as Record<string, unknown>;
          const sealed = {
            ...a,
            ...("data" in a ? { data: Array.isArray(a.data) ? a.data.map(seal) : seal(a.data) } : {}),
            ...("create" in a ? { create: seal(a.create) } : {}),
            ...("update" in a ? { update: seal(a.update) } : {}),
          };
          const result = await query(sealed as typeof args);
          return (Array.isArray(result) ? result.map(open) : open(result)) as typeof result;
        },
      },
    },
  });

let client: ReturnType<typeof extend> | undefined;

/**
 * The database client Better Auth works with. Made on first use, like the one it extends: nothing reaches the
 * database while the app is being built (no DATABASE_URL then)
 */
export const authPrisma = new Proxy({} as ReturnType<typeof extend>, {
  get(_target, prop) {
    client ??= extend();
    const value = Reflect.get(client, prop, client) as unknown;
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});
