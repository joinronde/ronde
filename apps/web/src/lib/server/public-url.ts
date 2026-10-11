import "server-only";
import { headers } from "next/headers";
import { BASE_PATH } from "../shared/base-path";
import { env } from "./env";

/**
 * Absolute URL of an app path, for links in emails: APP_URL, otherwise the address of the current request.
 * Background jobs have no request: without APP_URL, their links point at localhost rather than failing.
 */
export async function publicUrl(path: string): Promise<string> {
  const configured = env.appUrl();
  if (configured) return `${configured}${path}`;
  let h: Awaited<ReturnType<typeof headers>>;
  try {
    h = await headers();
  } catch {
    return `http://localhost:3000${BASE_PATH}${path}`;
  }
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}${BASE_PATH}${path}`;
}
