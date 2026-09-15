"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { updateProfileAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { FormSuccess } from "@/components/form-success";
import { SubmitButton } from "@/components/submit-button";
import { Section } from "@/components/section";

export function ProfileForm({ name, phone }: { name: string; phone: string | null }) {
  const t = useTranslations("settings.profile");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Section title={t("title")} card>
      <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget);
        start(async () => {
          const phone = String(fd.get("phone") ?? "").trim();
          const r = await updateProfileAction({ name: String(fd.get("name")), phone: phone || undefined });
          if (r.ok) { setDone(true); setError(null); } else { setDone(false); setError(r.error); }
        }); }}
        className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="name">{t("name")}</Label><Input id="name" name="name" defaultValue={name} required autoComplete="name" /></div>
          <div className="space-y-1.5"><Label htmlFor="phone">{t("phone")}</Label><Input id="phone" name="phone" type="tel" defaultValue={phone ?? ""} placeholder={t("phonePlaceholder")} autoComplete="tel" /></div>
        </div>
        <FormError message={error} />
        {done && <FormSuccess message={t("saved")} />}
        <SubmitButton pending={pending}>{t("submit")}</SubmitButton>
      </form>
    </Section>
  );
}
