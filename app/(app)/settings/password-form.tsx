"use client";
import { useState, useTransition } from "react";
import { changePasswordAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

export function PasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const fd = new FormData(form);
      start(async () => {
        const r = await changePasswordAction({ current: String(fd.get("current")), next: String(fd.get("next")) });
        if (r.ok) { setDone(true); setError(null); form.reset(); } else { setDone(false); setError(r.error); }
      }); }}
      className="max-w-md space-y-3">
      <h2 className="font-medium">Change password</h2>
      <div className="space-y-1"><Label htmlFor="current">Current password</Label><Input id="current" name="current" type="password" required autoComplete="current-password" /></div>
      <div className="space-y-1"><Label htmlFor="next">New password (8+ characters)</Label><Input id="next" name="next" type="password" minLength={8} required autoComplete="new-password" /></div>
      <FormError message={error} />
      {done && <p className="text-sm text-muted-foreground">Password updated.</p>}
      <SubmitButton pending={pending}>Update password</SubmitButton>
    </form>
  );
}
