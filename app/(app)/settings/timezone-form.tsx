"use client";
import { useState, useTransition } from "react";
import { setTimezoneAction } from "@/actions/org";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

export function TimezoneForm({ timezone, options, unset }: { timezone: string; options: string[]; unset: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget);
      start(async () => { const r = await setTimezoneAction({ timezone: String(fd.get("timezone")) }); setError(r.ok ? null : r.error); setSaved(r.ok); }); }}
      className="max-w-md space-y-3">
      <h2 className="font-medium">Timezone</h2>
      {unset && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm">Schedules use this timezone. Confirm it for your organization.</p>}
      <div className="space-y-1">
        <Label htmlFor="timezone">Organization timezone</Label>
        <select id="timezone" name="timezone" defaultValue={timezone} className="w-full rounded-md border bg-background px-2 py-2 text-sm">
          {options.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
        </select>
      </div>
      <FormError message={error} />
      {saved && <p className="text-sm text-muted-foreground">Saved.</p>}
      <SubmitButton pending={pending}>Save timezone</SubmitButton>
    </form>
  );
}
