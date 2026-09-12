"use client";
import { useState, useTransition } from "react";
import { createInviteAction } from "@/actions/invite";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

export function InviteForm({ properties, canInviteOwner }: { properties: { id: string; name: string }[]; canInviteOwner: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        start(async () => {
          const res = await createInviteAction({
            email: String(fd.get("email")),
            role: String(fd.get("role")) as "OWNER" | "MANAGER" | "WORKER",
            propertyIds: fd.getAll("propertyIds").map(String),
          });
          if (!res.ok) { setError(res.error); setSent(false); } else { setError(null); setSent(true); form.reset(); }
        });
      }}
      className="max-w-md space-y-4 rounded-md border p-4"
    >
      <h2 className="font-medium">Invite someone</h2>
      <div className="space-y-1"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required /></div>
      <div className="space-y-1">
        <Label htmlFor="role">Role</Label>
        <select id="role" name="role" defaultValue="WORKER" className="w-full rounded-md border bg-background px-2 py-2 text-sm">
          <option value="WORKER">Worker</option>
          <option value="MANAGER">Manager</option>
          {canInviteOwner && <option value="OWNER">Owner</option>}
        </select>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Properties</legend>
        {properties.length === 0 && <p className="text-sm text-muted-foreground">No properties yet.</p>}
        {properties.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="propertyIds" value={p.id} /> {p.name}
          </label>
        ))}
      </fieldset>
      <FormError message={error} />
      {sent && <p className="text-sm text-muted-foreground">Invitation sent.</p>}
      <SubmitButton pending={pending}>Send invitation</SubmitButton>
    </form>
  );
}
