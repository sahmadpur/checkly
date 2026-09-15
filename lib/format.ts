import { DEFAULT_LOCALE } from "@/lib/i18n";

export const formatDateTime = (d: Date, locale: string = DEFAULT_LOCALE) =>
  d.toLocaleString(locale, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export const formatInTz = (d: Date, tz: string, locale: string = DEFAULT_LOCALE) =>
  d.toLocaleString(locale, { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/** Value for <input type="datetime-local">, in the browser's local time. */
export function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Short weekday name for 0=Sun..6=Sat in the given locale. */
export const weekdayName = (d: number, locale: string = DEFAULT_LOCALE) =>
  new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2023, 0, 1 + d))); // 2023-01-01 is a Sunday
