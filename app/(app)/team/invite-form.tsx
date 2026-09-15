"use client";
import { useState, useTransition } from "react";
import { createInviteAction } from "@/actions/invite";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/form-error";
import { FormSuccess } from "@/components/form-success";
import { SubmitButton } from "@/components/submit-button";
import { Section } from "@/components/section";

export function InviteForm({ properties, canInviteOwner }: { properties: { id: string; name: string }[]; canInviteOwner: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  return (
    <Section title="Invite someone" description="They get an email with a link to join." card>
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
        className="space-y-4"
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
          <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required autoComplete="off" /></div>
          <div className="space-y-1.5">
            <Label htmlFor="role">Role</Label>
            <Select id="role" name="role" defaultValue="WORKER">
              <option value="WORKER">Worker</option>
              <option value="MANAGER">Manager</option>
              {canInviteOwner && <option value="OWNER">Owner</option>}
            </Select>
          </div>
        </div>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Properties they work at</legend>
          {properties.length === 0 && <p className="text-sm text-muted-foreground">No properties yet. You can add them to properties later.</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            {properties.map((p) => (
              <label key={p.id} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-accent/50">
                <input type="checkbox" name="propertyIds" value={p.id} /> {p.name}
              </label>
            ))}
          </div>
        </fieldset>
        <FormError message={error} />
        {sent && <FormSuccess message="Invitation sent." />}
        <SubmitButton pending={pending}>Send invitation</SubmitButton>
      </form>
    </Section>
  );
}
