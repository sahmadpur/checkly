"use client";
import { useState, useTransition } from "react";
import { acceptInviteExistingAction, acceptInviteNewUserAction } from "@/actions/invite";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

type Props = { token: string; orgName: string; email: string; role: string; mode: "new" | "signed-in" | "needs-login" };

export function AcceptForm({ token, orgName, email, role, mode }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const intro = <p className="text-sm">You&apos;ve been invited to <b>{orgName}</b> as {role.toLowerCase()} ({email}).</p>;

  if (mode === "needs-login") {
    return (
      <div className="space-y-4">
        {intro}
        <p className="text-sm text-muted-foreground">Sign in with {email} to accept.</p>
        <Button render={<a href={`/login?next=/invite/${token}`} />} className="w-full">Sign in</Button>
      </div>
    );
  }

  if (mode === "signed-in") {
    return (
      <div className="space-y-4">
        {intro}
        <FormError message={error} />
        <Button
          className="w-full"
          disabled={pending}
          onClick={() => start(async () => {
            const res = await acceptInviteExistingAction(token);
            if (res && !res.ok) setError(res.error);
          })}
        >
          Accept invitation
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
      {intro}
      <div className="space-y-1"><Label htmlFor="name">Your name</Label><Input id="name" name="name" required /></div>
      <div className="space-y-1"><Label htmlFor="phone">Phone (optional)</Label><Input id="phone" name="phone" type="tel" placeholder="+1 415 555 2671" /></div>
      <div className="space-y-1"><Label htmlFor="password">Password (8+ characters)</Label><Input id="password" name="password" type="password" minLength={8} required /></div>
      <FormError message={error} />
      <SubmitButton pending={pending}>Create account and join</SubmitButton>
    </form>
  );
}
