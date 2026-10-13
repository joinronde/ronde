import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

// Runs before every page and API call:
// - security headers: no framing by other sites (RONDE_FRAME_ANCESTORS widens it, e.g. for a digital signage
//   host), no MIME sniffing, the origin only in the referrer of a link leaving Ronde, https kept to;
// - a browser request coming from another site never changes anything through the API (on top of the
//   SameSite session cookie). The routes other servers call (Stripe, Slack, SCIM, identity providers' replies
//   to the sign-in) are left to their own checks;
// - optimistic check of the private pages: without a session cookie they go straight to sign-in (they still
//   verify the session themselves). Instances behind a trusted authenticating proxy skip it;
// - the public site shows "Open Ronde" instead of "Sign in" to someone signed in here (see `signedInHint`).

const PRIVATE = ["/w", "/account", "/onboarding"];
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Called by other servers, or by an identity provider's page posting its answer back */
const FROM_ELSEWHERE = ["/api/auth", "/api/billing/webhook", "/api/scim", "/api/slack", "/api/teams/messages", "/api/unsubscribe"];

function secured(res: NextResponse): NextResponse {
  const ancestors = process.env.RONDE_FRAME_ANCESTORS?.trim() || "'self'";
  res.headers.set("Content-Security-Policy", `frame-ancestors ${ancestors}`);
  if (ancestors === "'self'") res.headers.set("X-Frame-Options", "SAMEORIGIN");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  // Served over https: browsers keep to it for a year (never set for a plain http instance on a local network)
  if (process.env.APP_URL?.startsWith("https://")) res.headers.set("Strict-Transport-Security", "max-age=31536000");
  // No camera, microphone or location for other sites framing the app; the app itself asks for the microphone
  res.headers.set("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(), payment=()");
  return res;
}

/**
 * A cookie telling the public site that this browser is signed in to the app: "1", no personal data, on the
 * domain both share (app.joinronde.com and joinronde.com: joinronde.com), named after the app so a staging copy
 * has its own. No shared domain (a self-hosted instance, localhost): no cookie.
 */
let hint: { name: string; domain: string; secure: boolean } | null | undefined;
function signedInHint() {
  if (hint !== undefined) return hint;
  try {
    const app = new URL(process.env.APP_URL ?? "");
    const site = new URL(process.env.RONDE_SITE_URL || "https://joinronde.com");
    const a = app.hostname.split(".").reverse();
    const b = site.hostname.split(".").reverse();
    let n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n++;
    hint =
      n >= 2
        ? {
            name: `ronde_in_${app.hostname.replace(/[^a-z0-9]/gi, "_")}`,
            domain: a.slice(0, n).reverse().join("."),
            secure: app.protocol === "https:",
          }
        : null;
  } catch {
    hint = null;
  }
  return hint;
}

/** Sets the hint while a session cookie is there, removes it once it is gone (signed out, expired) */
function withHint(request: NextRequest, res: NextResponse): NextResponse {
  const h = signedInHint();
  if (!h) return res;
  const signedIn = !!getSessionCookie(request, { cookiePrefix: "ronde" });
  if (signedIn === request.cookies.has(h.name)) return res;
  res.cookies.set(h.name, signedIn ? "1" : "", {
    domain: h.domain,
    path: "/",
    maxAge: signedIn ? 30 * 86_400 : 0,
    sameSite: "lax",
    secure: h.secure,
  });
  return res;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    const site = request.headers.get("sec-fetch-site");
    if (
      !SAFE_METHODS.has(request.method) &&
      (site === "cross-site" || site === "same-site") &&
      // A whole path segment: "/api/teams/messagesX" is not the Teams endpoint
      !FROM_ELSEWHERE.some((p) => pathname === p || pathname.startsWith(`${p}/`))
    )
      return secured(NextResponse.json({ error: "crossSiteRequest" }, { status: 403 }));
    return secured(NextResponse.next());
  }
  const isPrivate = PRIVATE.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isPrivate && !process.env.AUTH_TRUSTED_EMAIL_HEADER && !getSessionCookie(request, { cookiePrefix: "ronde" })) {
    const url = request.nextUrl.clone();
    const next = `${pathname}${request.nextUrl.search}`;
    url.pathname = "/sign-in";
    url.search = `?next=${encodeURIComponent(next)}`;
    return withHint(request, secured(NextResponse.redirect(url)));
  }
  return withHint(request, secured(NextResponse.next()));
}

// Everything but the build's static files
export const config = { matcher: ["/((?!_next/static|_next/image|favicon\\.ico).*)"] };
