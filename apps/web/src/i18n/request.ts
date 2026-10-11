import { messagesFor } from "@ronde/i18n";
import { getRequestConfig } from "next-intl/server";
import { requestLocale } from "@/lib/server/locale";

// Language of each request: the viewer's choice (cookie), then their browser, then DEFAULT_LOCALE
export default getRequestConfig(async () => {
  const locale = await requestLocale();
  return { locale, messages: messagesFor(locale) };
});
