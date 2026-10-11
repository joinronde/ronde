import "server-only";
import { env } from "./env";

// Events sent by the server to the instance's Umami (UMAMI_*), for what no browser sees: a paid invoice, with its
// amount (Umami's revenue). Without Umami, nothing happens; a failure never blocks the caller.

/** What Umami takes for a visitor's browser: a request without one is dropped as a robot's */
const AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

export async function umamiEvent(name: string, data: Record<string, string | number>, url = "/") {
  const { src, websiteId, domains } = env.umami();
  if (!src || !websiteId) return;
  const hostname = domains.split(",")[0]?.trim() || new URL(env.appUrl() || "http://localhost").hostname;
  try {
    await fetch(new URL("/api/send", src), {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": AGENT },
      body: JSON.stringify({ type: "event", payload: { website: websiteId, hostname, url, title: "Ronde", language: "en", name, data } }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    console.error(`[umami] ${name}`, e);
  }
}
