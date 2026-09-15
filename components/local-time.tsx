"use client";
import { useSyncExternalStore } from "react";
import { useLocale } from "next-intl";
import { formatDateTime } from "@/lib/format";

const noop = () => () => {};

/**
 * Renders a timestamp in the viewer's timezone instead of the server's.
 * The server-formatted `fallback` is what hydrates; the client value replaces it right after.
 */
export function LocalTime({ iso, fallback, className }: { iso: string; fallback: string; className?: string }) {
  const locale = useLocale();
  const hydrated = useSyncExternalStore(noop, () => true, () => false);
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {hydrated ? formatDateTime(new Date(iso), locale) : fallback}
    </time>
  );
}
