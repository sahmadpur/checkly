"use client";
import { useState, useTransition } from "react";
import { forgotPasswordAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";
import { Notice } from "@/components/notice";
import Link from "next/link";

export function ForgotForm() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  if (done) return <Notice tone="success">If that account has an email address, a reset link is on its way. Check your inbox.</Notice>;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await forgotPasswordAction({ identifier: String(fd.get("identifier")) });
          if (res.ok) setDone(true); else setError(res.error);
        });
      }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <Label htmlFor="identifier">Email or phone</Label>
        <Input id="identifier" name="identifier" required />
      </div>
      <FormError message={error} />
      <SubmitButton pending={pending} className="w-full">Send reset link</SubmitButton>
      <p className="pt-2 text-center text-sm text-muted-foreground"><Link href="/login" className="underline underline-offset-4 hover:text-foreground">Back to sign in</Link></p>
    </form>
  );
}
