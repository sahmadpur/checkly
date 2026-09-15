"use client";
import { useState, useTransition } from "react";
import { updateProfileAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { FormSuccess } from "@/components/form-success";
import { SubmitButton } from "@/components/submit-button";
import { Section } from "@/components/section";

export function ProfileForm({ name, phone }: { name: string; phone: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Section title="Profile" card>
      <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget);
        start(async () => {
          const phone = String(fd.get("phone") ?? "").trim();
          const r = await updateProfileAction({ name: String(fd.get("name")), phone: phone || undefined });
          if (r.ok) { setDone(true); setError(null); } else { setDone(false); setError(r.error); }
        }); }}
        className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="name">Name</Label><Input id="name" name="name" defaultValue={name} required autoComplete="name" /></div>
          <div className="space-y-1.5"><Label htmlFor="phone">Phone</Label><Input id="phone" name="phone" type="tel" defaultValue={phone ?? ""} placeholder="+1 415 555 2671" autoComplete="tel" /></div>
        </div>
        <FormError message={error} />
        {done && <FormSuccess message="Profile saved" />}
        <SubmitButton pending={pending}>Save profile</SubmitButton>
      </form>
    </Section>
  );
}
