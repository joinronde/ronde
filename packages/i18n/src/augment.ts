// Type-checked message keys for next-intl: import "@ronde/i18n/augment" once in any package using useTranslations().
import type { Locale } from "./index";
import type { Messages } from "./messages";

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
