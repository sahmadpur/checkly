"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { signupAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

export function SignupForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [tz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);

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
      {field("orgName", "Organization name", { required: true })}
      {field("name", "Your name", { required: true, autoComplete: "name" })}
      {field("email", "Email", { type: "email", required: true, autoComplete: "email" })}
      {field("phone", "Phone (optional, with country code)", { type: "tel", placeholder: "+1 415 555 2671", autoComplete: "tel" })}
      {field("password", "Password (8+ characters)", { type: "password", required: true, minLength: 8, autoComplete: "new-password" })}
      <input type="hidden" name="timezone" value={tz} />
      <FormError message={error} />
      <SubmitButton pending={pending}>Create account</SubmitButton>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account? <Link href="/login" className="underline">Sign in</Link>
      </p>
    </form>
  );
}
