"use client";
import { useState, useTransition } from "react";
import { updateProfileAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

export function ProfileForm({ name, phone }: { name: string; phone: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget);
      start(async () => {
        const phone = String(fd.get("phone") ?? "").trim();
        const r = await updateProfileAction({ name: String(fd.get("name")), phone: phone || undefined });
        if (r.ok) { setDone(true); setError(null); } else { setDone(false); setError(r.error); }
      }); }}
      className="max-w-md space-y-3">
      <h2 className="font-medium">Profile</h2>
      <div className="space-y-1"><Label htmlFor="name">Name</Label><Input id="name" name="name" defaultValue={name} required /></div>
      <div className="space-y-1"><Label htmlFor="phone">Phone</Label><Input id="phone" name="phone" defaultValue={phone ?? ""} /></div>
      <FormError message={error} />
      {done && <p className="text-sm text-muted-foreground">Profile updated.</p>}
      <SubmitButton pending={pending}>Save</SubmitButton>
    </form>
  );
}
