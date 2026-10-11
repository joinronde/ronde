/**
 * Only same-app paths are followed after sign-in (no open redirect): one leading slash, then neither a slash
 * nor a backslash, and no control character anywhere (a browser drops tabs and line breaks from an address,
 * so "/\t/evil.example" would become "//evil.example")
 */
export const safeNext = (next: string | null | undefined, fallback = "/") =>
  next && /^\/(?![/\\])/.test(next) && !/[\u0000-\u001f\u007f]/.test(next) ? next : fallback;
