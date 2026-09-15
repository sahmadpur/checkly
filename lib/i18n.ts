import { createTranslator, type NamespaceKeys, type NestedKeyOf } from "next-intl";
import en from "@/messages/en";
import az from "@/messages/az";
import ru from "@/messages/ru";

export const LOCALES = ["en", "az", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", az: "Azərbaycan", ru: "Русский" };

export const isLocale = (v: unknown): v is Locale => LOCALES.includes(v as Locale);

// Typed against `en`: a key missing from az/ru is a compile error.
export const MESSAGES: Record<Locale, typeof en> = { en, az, ru };
export const messagesFor = (locale: Locale) => MESSAGES[locale];

type Messages = typeof en;
type Namespace = NamespaceKeys<Messages, NestedKeyOf<Messages>>;

/** Pure translator for code that runs outside a request (cron tick, emails, tests). */
export const translatorFor = <N extends Namespace = never>(locale: string, namespace?: N) =>
  createTranslator<Messages, N>({ locale: isLocale(locale) ? locale : DEFAULT_LOCALE, messages: MESSAGES[isLocale(locale) ? locale : DEFAULT_LOCALE], namespace });
