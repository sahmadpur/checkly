import { unstable_rethrow } from "next/navigation";
import { getLocale } from "next-intl/server";
import { z, ZodError } from "zod";
import { AppError } from "@/lib/errors";
import { DEFAULT_LOCALE, isLocale, translatorFor, type Locale } from "@/lib/i18n";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function currentLocale(): Promise<Locale> {
  try {
    const l = await getLocale();
    return isLocale(l) ? l : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE; // outside a request (tests)
  }
}

function zodMessage(e: ZodError, locale: Locale) {
  const issue = e.issues[0];
  if (!issue) return null;
  if (locale === "en") return issue.message;
  const m = z.locales[locale]().localeError(issue as never);
  return typeof m === "string" ? m : m?.message ?? issue.message;
}

export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    unstable_rethrow(e);
    const locale = await currentLocale();
    const t = translatorFor(locale, "errors");
    if (e instanceof AppError) return { ok: false, error: t(e.key, e.params) };
    if (e instanceof ZodError) return { ok: false, error: zodMessage(e, locale) ?? t("invalidInput") };
    console.error(e);
    return { ok: false, error: t("generic") };
  }
}
