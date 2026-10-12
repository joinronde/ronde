import "server-only";
import { lookup } from "node:dns";
import { lookup as lookupPromise } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";
import { env } from "./env";

// Requests to the addresses people configure: webhooks and chat connectors, GitLab, GitHub, issue trackers,
// calendars, video servers, a speech-to-text service, the audit stream. In the Ronde cloud they never reach a
// private, loopback or link-local address, checked when the connection opens: a name resolving to one, a
// redirect to one, an address written as such. A self-hosted instance reaches its own network (its GitLab, its
// chat server) unless RONDE_BLOCK_PRIVATE_URLS=1. RONDE_OUTBOUND_ALLOW lets named hosts through (an internal
// service of the instance itself); the instance's own speech-to-text address always is.

const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
] as const)
  PRIVATE.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  PRIVATE.addSubnet(net, prefix, "ipv6");

/** An address of a private, loopback, link-local or reserved network (an IPv4 in IPv6 clothing included) */
export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return PRIVATE.check(ip, "ipv4");
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    return mapped ? PRIVATE.check(mapped[1]!, "ipv4") : PRIVATE.check(ip, "ipv6");
  }
  return true;
}

export class OutboundBlocked extends Error {
  constructor(host: string) {
    super(`${host} is on a private network, out of reach from here`);
  }
}

const guarded = () =>
  (process.env.RONDE_CLOUD === "1" || process.env.RONDE_BLOCK_PRIVATE_URLS === "1") && process.env.RONDE_ALLOW_PRIVATE_URLS !== "1";

function allowedHosts(): Set<string> {
  const hosts = (process.env.RONDE_OUTBOUND_ALLOW ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  try {
    if (env.transcriptionUrl()) hosts.push(new URL(env.transcriptionUrl()).hostname.toLowerCase());
  } catch {}
  return new Set(hosts);
}

const connect = buildConnector({});

const agent = new Agent({
  connect: (opts, callback) => {
    const host = opts.hostname.replace(/^\[|\]$/g, "");
    if (allowedHosts().has(host.toLowerCase())) return connect(opts, callback);
    if (isIP(host)) return isPrivateAddress(host) ? callback(new OutboundBlocked(host), null) : connect(opts, callback);
    // Every address of the name must be public; the connection goes to one of those checked, not to a new answer
    lookup(host, { all: true }, (err, addresses) => {
      if (err) return callback(err, null);
      const first = addresses[0];
      if (!first || addresses.some((a) => isPrivateAddress(a.address))) return callback(new OutboundBlocked(host), null);
      connect({ ...opts, hostname: first.address, servername: opts.servername || host }, callback);
    });
  },
});

/**
 * For an address a library fetches on its own (an identity provider's discovery): https, and when guarded a
 * name whose every address is public. Throws OutboundBlocked otherwise.
 */
export async function assertPublicUrl(value: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw new OutboundBlocked(value);
  }
  if (!guarded()) return;
  if (u.protocol !== "https:") throw new OutboundBlocked(u.host);
  await assertPublicHost(u.hostname);
}

/** A server reached another way than fetch (an LDAP directory): when guarded, every address of it is public */
export async function assertPublicHost(name: string): Promise<void> {
  if (!guarded()) return;
  const host = name.replace(/^\[|\]$/g, "");
  if (allowedHosts().has(host.toLowerCase())) return;
  const addresses = isIP(host) ? [{ address: host }] : await lookupAll(host).catch(() => []);
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) throw new OutboundBlocked(host);
}

const lookupAll = (host: string) => lookupPromise(host, { all: true });

/** fetch for configured addresses: when guarded, the check above on every connection, redirects included */
export const outboundFetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
  guarded()
    ? undiciFetch(input as Parameters<typeof undiciFetch>[0], { ...(init as object), dispatcher: agent })
    : globalThis.fetch(input, init)) as unknown as typeof fetch;
