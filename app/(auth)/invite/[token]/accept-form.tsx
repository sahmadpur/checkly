"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { acceptInviteExistingAction, acceptInviteNewUserAction } from "@/actions/invite";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

type Props = { token: string; orgName: string; email: string; role: string; mode: "new" | "signed-in" | "needs-login" };

export function AcceptForm({ token, email, mode }: Props) {
  const t = useTranslations("auth");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (mode === "needs-login") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("invite.needsLogin", { email })}</p>
        <Button render={<a href={`/login?next=/invite/${token}`} />} className="w-full">{t("invite.signIn")}</Button>
      </div>
    );
  }

  if (mode === "signed-in") {
    return (
      <div className="space-y-4">
        <FormError message={error} />
        <Button
          className="w-full"
          disabled={pending}
          onClick={() => start(async () => {
            const res = await acceptInviteExistingAction(token);
            if (res && !res.ok) setError(res.error);
          })}
        >
          {t("invite.accept")}
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await acceptInviteNewUserAction({
            token,
            name: String(fd.get("name")),
            password: String(fd.get("password")),
            phone: String(fd.get("phone") ?? "") || undefined,
          });
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-4"
    >
      <div className="space-y-1"><Label htmlFor="name">{t("fields.name")}</Label><Input id="name" name="name" required /></div>
      <div className="space-y-1"><Label htmlFor="phone">{t("fields.phoneOptional")}</Label><Input id="phone" name="phone" type="tel" placeholder={t("fields.phonePlaceholder")} /></div>
      <div className="space-y-1"><Label htmlFor="password">{t("fields.password8")}</Label><Input id="password" name="password" type="password" minLength={8} required /></div>
      <FormError message={error} />
      <SubmitButton pending={pending} className="w-full">{t("invite.submit")}</SubmitButton>
    </form>
  );
}
