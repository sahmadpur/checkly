"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { setTimezoneAction } from "@/actions/org";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/form-error";
import { FormSuccess } from "@/components/form-success";
import { SubmitButton } from "@/components/submit-button";
import { Section } from "@/components/section";
import { Notice } from "@/components/notice";

export function TimezoneForm({ timezone, options, unset }: { timezone: string; options: string[]; unset: boolean }) {
  const t = useTranslations("settings.timezone");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Section title={t("title")} description={t("description")} card>
      <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget);
        start(async () => { const r = await setTimezoneAction({ timezone: String(fd.get("timezone")) }); setError(r.ok ? null : r.error); setSaved(r.ok); }); }}
        className="space-y-4">
        {unset && <Notice tone="warning">{t("unset")}</Notice>}
        <div className="space-y-1.5">
          <Label htmlFor="timezone">{t("label")}</Label>
          <Select id="timezone" name="timezone" defaultValue={timezone}>
            {options.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </Select>
        </div>
        <FormError message={error} />
        {saved && <FormSuccess message={t("saved")} />}
        <SubmitButton pending={pending}>{t("submit")}</SubmitButton>
      </form>
    </Section>
  );
}
