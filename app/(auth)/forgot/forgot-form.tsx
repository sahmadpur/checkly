"use client";
import { useState, useTransition } from "react";
import { forgotPasswordAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

export function ForgotForm() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  if (done) return <p className="text-sm">If an account with an email exists for that identifier, a reset link has been sent.</p>;

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
      <SubmitButton pending={pending}>Send reset link</SubmitButton>
    </form>
  );
}
