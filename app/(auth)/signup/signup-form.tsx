"use client";
import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { signupAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

const noop = () => () => {};

export function SignupForm() {
  const t = useTranslations("auth");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // Server has no timezone; client value replaces it right after hydration (same pattern as components/local-time.tsx).
  const tz = useSyncExternalStore(noop, () => Intl.DateTimeFormat().resolvedOptions().timeZone, () => "");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await signupAction({
        name: String(fd.get("name")),
        email: String(fd.get("email")),
        phone: String(fd.get("phone") ?? "") || undefined,
        password: String(fd.get("password")),
        orgName: String(fd.get("orgName")),
        timezone: String(fd.get("timezone") || ""),
      });
      if (res && !res.ok) setError(res.error);
    });
  }

  const field = (id: string, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} {...props} />
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {field("orgName", t("fields.orgName"), { required: true })}
      {field("name", t("fields.name"), { required: true, autoComplete: "name" })}
      {field("email", t("fields.email"), { type: "email", required: true, autoComplete: "email" })}
      {field("phone", t("fields.phoneOptional"), { type: "tel", placeholder: t("fields.phonePlaceholder"), autoComplete: "tel" })}
      {field("password", t("fields.password8"), { type: "password", required: true, minLength: 8, autoComplete: "new-password" })}
      <input type="hidden" name="timezone" value={tz} readOnly />
      <FormError message={error} />
      <SubmitButton pending={pending} className="w-full">{t("signup.submit")}</SubmitButton>
      <p className="pt-2 text-center text-sm text-muted-foreground">
        {t("signup.haveAccount")} <Link href="/login" className="font-medium text-primary underline underline-offset-4">{t("signup.signIn")}</Link>
      </p>
    </form>
  );
}
