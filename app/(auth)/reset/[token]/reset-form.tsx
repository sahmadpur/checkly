"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { resetPasswordAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

export function ResetForm({ token }: { token: string }) {
  const t = useTranslations("auth");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await resetPasswordAction({ token, password: String(fd.get("password")) });
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <Label htmlFor="password">{t("fields.newPassword")}</Label>
        <Input id="password" name="password" type="password" minLength={8} required autoComplete="new-password" />
      </div>
      <FormError message={error} />
      <SubmitButton pending={pending} className="w-full">{t("reset.submit")}</SubmitButton>
    </form>
  );
}
