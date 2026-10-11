// SPDX-License-Identifier: LicenseRef-Ronde-EE
// Copyright (c) Ronde. Use requires a valid Ronde license key: see ee/LICENSE.

import type { EnterpriseEdition, TeamsApp, TeamsPackage } from "@ronde/editions/ee";
import { strToU8, zipSync } from "fflate";
import { decodeProtectedHeader, importJWK, type JWK, jwtVerify } from "jose";

// The Microsoft Teams app: a bot of the Bot Framework. Its requests to Ronde carry a token signed by Microsoft,
// checked here; Ronde answers and writes to Teams through the Bot Connector, with a token of the app's own
// Microsoft Entra registration. No SDK: the protocol is a few HTTPS calls.

export class TeamsError extends Error {}

const OPENID = "https://login.botframework.com/v1/.well-known/openidconfiguration";
const ISSUER = "https://api.botframework.com";
const SCOPE = "https://api.botframework.com/.default";
/** Microsoft asks bots to refresh the signing keys at least once a day */
const KEYS_TTL_MS = 24 * 3600_000;
/** Clock skew Microsoft accepts */
const SKEW_S = 300;

/** The services that send activities and receive the bot's answers: Teams' own, in every cloud */
const SERVICE_HOSTS = /(^|\.)(trafficmanager\.net|botframework\.com|botframework\.azure\.us|teams\.microsoft\.com|teams\.microsoft\.us)$/;

const trim = (url: string) => url.trim().replace(/\/+$/, "");

/** A service address the bot may send its token to: https, on Microsoft's Teams services */
export function isServiceUrl(value: string | undefined): boolean {
  try {
    const u = new URL(value ?? "");
    return u.protocol === "https:" && SERVICE_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

type BotKey = JWK & { kid?: string; endorsements?: string[] };
let keyCache: { at: number; keys: BotKey[] } | null = null;

async function signingKeys(fetcher: typeof fetch, fresh = false): Promise<BotKey[]> {
  if (!fresh && keyCache && Date.now() - keyCache.at < KEYS_TTL_MS) return keyCache.keys;
  const meta = (await (await fetcher(OPENID, { signal: AbortSignal.timeout(10_000) })).json()) as { jwks_uri?: string };
  if (!meta.jwks_uri) throw new TeamsError("no signing keys");
  const doc = (await (await fetcher(meta.jwks_uri, { signal: AbortSignal.timeout(10_000) })).json()) as { keys?: BotKey[] };
  keyCache = { at: Date.now(), keys: doc.keys ?? [] };
  return keyCache.keys;
}

/** For tests: forget the signing keys and tokens kept in memory */
export function resetTeamsCache() {
  keyCache = null;
  tokens.clear();
}

/**
 * A request of the Bot Connector: "Bearer <token>", the token signed with one of Microsoft's keys, issued by
 * the Bot Framework for this app, still valid, naming the service the activity comes from, and signed by a key
 * endorsed for the activity's channel (msteams).
 */
export async function verify(
  authorization: string,
  activity: { serviceUrl?: string; channelId?: string },
  app: TeamsApp,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const token = /^Bearer\s+(\S+)$/i.exec(authorization.trim())?.[1];
  if (!token || !app.appId) return false;
  try {
    const { kid, alg } = decodeProtectedHeader(token);
    if (alg !== "RS256") return false;
    let key = (await signingKeys(fetcher)).find((k) => k.kid === kid);
    // A key added since the last refresh
    if (!key) key = (await signingKeys(fetcher, true)).find((k) => k.kid === kid);
    if (!key) return false;
    if (activity.channelId && !(key.endorsements ?? []).includes(activity.channelId)) return false;
    const { endorsements: _e, ...jwk } = key;
    const { payload } = await jwtVerify(token, await importJWK(jwk, "RS256"), {
      issuer: ISSUER,
      audience: app.appId,
      algorithms: ["RS256"],
      clockTolerance: SKEW_S,
    });
    return typeof payload.serviceUrl === "string" && !!activity.serviceUrl && trim(payload.serviceUrl) === trim(activity.serviceUrl);
  } catch {
    return false;
  }
}

const tokens = new Map<string, { value: string; until: number }>();

/** The app's token for the Bot Connector, kept until a few minutes before it expires */
async function botToken(app: TeamsApp, fetcher: typeof fetch): Promise<string> {
  const kept = tokens.get(app.appId);
  if (kept && kept.until > Date.now()) return kept.value;
  // A single-tenant bot asks its own tenant; an older multi-tenant one, the Bot Framework's
  const tenant = app.tenantId || "botframework.com";
  const res = await fetcher(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: app.appId, client_secret: app.password, scope: SCOPE }),
    signal: AbortSignal.timeout(10_000),
  });
  const out = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !out.access_token) throw new TeamsError(`token: ${out.error ?? res.status}`);
  tokens.set(app.appId, { value: out.access_token, until: Date.now() + Math.max(60, (out.expires_in ?? 3600) - 300) * 1000 });
  return out.access_token;
}

/** One call to the Bot Connector (a conversation's service), with the app's token */
export async function call<T = Record<string, unknown>>(
  app: TeamsApp,
  serviceUrl: string,
  path: string,
  init: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown } = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  // The token only ever goes to Teams' own services
  if (!isServiceUrl(serviceUrl)) throw new TeamsError("not a Teams service address");
  const res = await fetcher(`${trim(serviceUrl)}${path}`, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: {
      authorization: `Bearer ${await botToken(app, fetcher)}`,
      accept: "application/json",
      ...(init.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const said = ((await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null)?.error;
    throw new TeamsError(`${res.status}${said?.code ? ` ${said.code}` : ""}${said?.message ? `: ${said.message}` : ""}`);
  }
  return (res.status === 204 ? {} : await res.json().catch(() => ({}))) as T;
}

/** Teams' limits on the texts of a manifest */
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/**
 * The app package: manifest.json (the bot, in personal chats and teams, its commands), one translation file per
 * other language, and the two icons. An administrator uploads it to their organization's apps in Teams.
 */
export function appPackage(app: TeamsApp, o: TeamsPackage): Uint8Array {
  const [en, ...others] = o.texts;
  if (!en) throw new TeamsError("no texts");
  const texts = (t: typeof en) => ({
    name: { short: cut(t.shortName, 30), full: cut(t.fullName, 100) },
    description: { short: cut(t.shortDescription, 80), full: cut(t.fullDescription, 4000) },
    commands: t.commands.map((c) => ({ title: cut(c.title, 32), description: cut(c.description, 128) })),
  });
  const main = texts(en);
  const manifest = {
    $schema: "https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json",
    manifestVersion: "1.17",
    version: o.version,
    id: app.appId,
    developer: o.developer,
    name: main.name,
    description: main.description,
    icons: { color: "color.png", outline: "outline.png" },
    accentColor: o.accentColor,
    bots: [
      {
        botId: app.appId,
        scopes: ["personal", "team"],
        supportsFiles: false,
        isNotificationOnly: false,
        commandLists: [{ scopes: ["personal"], commands: main.commands }],
      },
    ],
    permissions: ["identity", "messageTeamMembers"],
    validDomains: [o.domain],
    ...(others.length
      ? {
          localizationInfo: {
            defaultLanguageTag: "en",
            additionalLanguages: others.map((t) => ({ languageTag: t.locale, file: `${t.locale}.json` })),
          },
        }
      : {}),
  };
  const files: Record<string, Uint8Array> = {
    "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
    "color.png": o.icons.color,
    "outline.png": o.icons.outline,
  };
  for (const t of others) {
    const x = texts(t);
    files[`${t.locale}.json`] = strToU8(
      JSON.stringify(
        {
          $schema: "https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.Localization.schema.json",
          "name.short": x.name.short,
          "name.full": x.name.full,
          "description.short": x.description.short,
          "description.full": x.description.full,
          ...Object.fromEntries(
            x.commands.flatMap((c, i) => [
              [`bots[0].commandLists[0].commands[${i}].title`, c.title],
              [`bots[0].commandLists[0].commands[${i}].description`, c.description],
            ]),
          ),
        },
        null,
        2,
      ),
    );
  }
  return zipSync(files, { level: 9 });
}

export const teams: EnterpriseEdition["teams"] = { verify, call, appPackage };
