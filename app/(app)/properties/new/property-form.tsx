"use client";
import { useState, useTransition } from "react";
import { createPropertyAction, updatePropertyAction } from "@/actions/property";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { FormSuccess } from "@/components/form-success";
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
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="name">Name</Label><Input id="name" name="name" defaultValue={property?.name} placeholder="Villa Azul" required /></div>
        <div className="space-y-1.5"><Label htmlFor="address">Address</Label><Input id="address" name="address" defaultValue={property?.address ?? ""} placeholder="Optional" autoComplete="street-address" /></div>
      </div>
      <FormError message={error} />
      {saved && property && <FormSuccess message="Property saved" />}
      <SubmitButton pending={pending}>{property ? "Save details" : "Create property"}</SubmitButton>
    </form>
  );
}
