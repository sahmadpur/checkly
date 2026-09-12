"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { loginAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await loginAction(
        { identifier: String(fd.get("identifier")), password: String(fd.get("password")) },
        next
      );
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      <div className="space-y-1">
        <Label htmlFor="identifier">Email or phone</Label>
        <Input id="identifier" name="identifier" autoComplete="username" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <FormError message={error} />
      <SubmitButton pending={pending}>Sign in</SubmitButton>
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/forgot" className="underline">Forgot password?</Link>
        {" · "}
        <Link href="/signup" className="underline">Create an organization</Link>
      </p>
    </form>
  );
}
