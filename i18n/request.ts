import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, messagesFor } from "@/lib/i18n";

export default getRequestConfig(async () => {
  const cookie = (await cookies()).get("locale")?.value;
  // ponytail: ignores q-weights; use negotiator if it matters
  const header = ((await headers()).get("accept-language") ?? "").split(",").map((s) => s.trim().slice(0, 2).toLowerCase()).find(isLocale);
  const locale = isLocale(cookie) ? cookie : header ?? DEFAULT_LOCALE;
  return { locale, messages: messagesFor(locale) };
});
