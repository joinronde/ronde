// URL prefix of the app (Next.js basePath): e.g. "/ronde" behind a reverse proxy, empty at the root.
// Baked in at build time, like every NEXT_PUBLIC_* variable.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Prefix an app path. Next.js does it for <Link> and redirect(), not for fetch, EventSource or <a>. */
export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}
