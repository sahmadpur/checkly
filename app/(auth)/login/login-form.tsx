"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { loginAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";
import { Notice } from "@/components/notice";

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
      {notice && <Notice tone="success">{notice}</Notice>}
      <div className="space-y-1">
        <Label htmlFor="identifier">Email or phone</Label>
        <Input id="identifier" name="identifier" autoComplete="username" inputMode="email" autoCapitalize="none" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <FormError message={error} />
      <SubmitButton pending={pending} className="w-full">Sign in</SubmitButton>
      <div className="flex flex-col items-center gap-2 pt-2 text-sm text-muted-foreground">
        <Link href="/forgot" className="underline underline-offset-4 hover:text-foreground">Forgot your password?</Link>
        <span>New here? <Link href="/signup" className="font-medium text-primary underline underline-offset-4">Create an organization</Link></span>
      </div>
    </form>
  );
}
