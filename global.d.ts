import type en from "@/messages/en";
import type { Locale as AppLocale } from "@/lib/i18n";

declare module "next-intl" {
  interface AppConfig {
    Locale: AppLocale;
    Messages: typeof en;
  }
}
