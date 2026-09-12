"use client";
import { useState, useTransition } from "react";
import { renameOrgAction } from "@/actions/org";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

export function OrgForm({ name }: { name: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget);
      start(async () => { const r = await renameOrgAction({ name: String(fd.get("name")) }); setError(r.ok ? null : r.error); }); }}
      className="max-w-md space-y-3">
      <h2 className="font-medium">Organization</h2>
      <div className="space-y-1"><Label htmlFor="orgName">Name</Label><Input id="orgName" name="name" defaultValue={name} required /></div>
      <FormError message={error} />
      <SubmitButton pending={pending}>Save</SubmitButton>
    </form>
  );
}
