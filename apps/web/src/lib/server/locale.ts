import "server-only";
import { isLocale, LOCALE_COOKIE, type Locale, negotiateLocale } from "@ronde/i18n";
import { cookies, headers } from "next/headers";
import { currentUser } from "./authz";
import { instanceSettings } from "./instance";

/**
 * Language of the current request: the signed-in user's preference, then the choice made on the public
 * pages (cookie), then the browser's languages, then the instance default.
 */
export async function requestLocale(): Promise<Locale> {
  const [user, c, h] = await Promise.all([currentUser().catch(() => null), cookies(), headers()]);
  if (isLocale(user?.locale)) return user.locale;
  const chosen = c.get(LOCALE_COOKIE)?.value;
  if (isLocale(chosen)) return chosen;
  return negotiateLocale(h.get("accept-language"), (await instanceSettings()).defaultLocale);
}
