"use client";
import { useState, useTransition } from "react";
import { createPropertyAction, updatePropertyAction } from "@/actions/property";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

export function PropertyForm({ property }: { property?: { id: string; name: string; address: string | null } }) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const input = { name: String(fd.get("name")), address: String(fd.get("address") ?? "") };
        start(async () => {
          const res = property ? await updatePropertyAction(property.id, input) : await createPropertyAction(input);
          if (res && !res.ok) setError(res.error); else setSaved(true);
        });
      }}
      className="max-w-md space-y-4"
    >
      <div className="space-y-1"><Label htmlFor="name">Name</Label><Input id="name" name="name" defaultValue={property?.name} required /></div>
      <div className="space-y-1"><Label htmlFor="address">Address</Label><Input id="address" name="address" defaultValue={property?.address ?? ""} /></div>
      <FormError message={error} />
      {saved && property && <p className="text-sm text-muted-foreground">Saved.</p>}
      <SubmitButton pending={pending}>{property ? "Save" : "Create property"}</SubmitButton>
    </form>
  );
}
