"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { setLocaleAction } from "@/actions/auth";
import { Select } from "@/components/ui/select";
import { LOCALES, LOCALE_NAMES } from "@/lib/i18n";

export function LanguageSelect({ id = "locale", className }: { id?: string; className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Select id={id} name="locale" aria-label={LOCALE_NAMES[locale]} defaultValue={locale} disabled={pending} className={className}
      onChange={(e) => { const v = e.target.value; start(async () => { await setLocaleAction(v); router.refresh(); }); }}>
      {LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
    </Select>
  );
}
