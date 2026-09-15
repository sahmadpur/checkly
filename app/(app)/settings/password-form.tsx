"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { changePasswordAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { FormSuccess } from "@/components/form-success";
import { SubmitButton } from "@/components/submit-button";
import { Section } from "@/components/section";

export function PasswordForm() {
  const t = useTranslations("settings.password");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Section title={t("title")} card>
      <form onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const fd = new FormData(form);
        start(async () => {
          const r = await changePasswordAction({ current: String(fd.get("current")), next: String(fd.get("next")) });
          if (r.ok) { setDone(true); setError(null); form.reset(); } else { setDone(false); setError(r.error); }
        }); }}
        className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="current">{t("current")}</Label><Input id="current" name="current" type="password" required autoComplete="current-password" /></div>
          <div className="space-y-1.5"><Label htmlFor="next">{t("next")}</Label><Input id="next" name="next" type="password" minLength={8} required autoComplete="new-password" placeholder={t("placeholder")} /></div>
        </div>
        <FormError message={error} />
        {done && <FormSuccess message={t("saved")} />}
        <SubmitButton pending={pending}>{t("submit")}</SubmitButton>
      </form>
    </Section>
  );
}
