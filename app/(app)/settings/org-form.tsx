"use client";
import { useState, useTransition } from "react";
import { renameOrgAction } from "@/actions/org";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { FormSuccess } from "@/components/form-success";
import { SubmitButton } from "@/components/submit-button";
import { Section } from "@/components/section";

export function OrgForm({ name }: { name: string }) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Section title="Organization" card>
      <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget);
        start(async () => { const r = await renameOrgAction({ name: String(fd.get("name")) }); setError(r.ok ? null : r.error); setSaved(r.ok); }); }}
        className="space-y-4">
        <div className="space-y-1.5"><Label htmlFor="orgName">Name</Label><Input id="orgName" name="name" defaultValue={name} required /></div>
        <FormError message={error} />
        {saved && <FormSuccess message="Name saved" />}
        <SubmitButton pending={pending}>Save name</SubmitButton>
      </form>
    </Section>
  );
}
