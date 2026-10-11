import "server-only";
import { createHash } from "node:crypto";
import { outboundFetch } from "./outbound";

// BigBlueButton API: every call is signed with the server's shared secret (checksum = sha1(call + query + secret))

/** API base of a BigBlueButton server, whether it was entered with or without "/api" */
const apiBase = (url: string) => `${url.replace(/\/+$/, "").replace(/\/api$/, "")}/api`;

/** A signed BigBlueButton API URL */
export function bbbCall(server: string, secret: string, call: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString();
  const checksum = createHash("sha1").update(`${call}${query}${secret}`).digest("hex");
  return `${apiBase(server)}/${call}?${query}&checksum=${checksum}`;
}

/**
 * Opens the room (BigBlueButton answers "duplicate" when it is already open, which is fine) and returns the
 * signed link that brings the person in, as a moderator for the hosts.
 */
export async function bbbJoin(
  o: { server: string; secret: string; room: string; name: string; person: string; moderator: boolean },
  fetcher: typeof fetch = outboundFetch,
): Promise<string> {
  const meetingID = `ronde-${o.room}`;
  const res = await fetcher(bbbCall(o.server, o.secret, "create", { name: o.name, meetingID, record: "false" }), {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const xml = await res.text();
  if (!res.ok || !/<returncode>SUCCESS<\/returncode>/.test(xml))
    throw new Error(`BigBlueButton: ${/<messageKey>(.*?)<\/messageKey>/.exec(xml)?.[1] ?? res.status}`);
  return bbbCall(o.server, o.secret, "join", {
    fullName: o.person,
    meetingID,
    role: o.moderator ? "MODERATOR" : "VIEWER",
    redirect: "true",
  });
}
