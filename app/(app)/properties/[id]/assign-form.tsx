"use client";
import { useState, useTransition } from "react";
import { assignChecklistAction } from "@/actions/instance";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";
import { toLocalInputValue } from "@/lib/format";

type Opt = { id: string; name: string };

export function AssignForm({ propertyId, templates, workers }: { propertyId: string; templates: Opt[]; workers: Opt[] }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [defaultDue] = useState(() => toLocalInputValue(new Date(Date.now() + 24 * 3600_000)));
  if (templates.length === 0) return <p className="text-sm text-muted-foreground">Create a template first.</p>;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        const local = String(fd.get("dueAt"));
        start(async () => {
          const r = await assignChecklistAction({
            templateId: String(fd.get("templateId")), propertyId,
            assigneeIds: fd.getAll("assigneeIds").map(String),
            dueAt: new Date(local).toISOString(),
          });
          if (!r.ok) { setError(r.error); setDone(null); } else { setError(null); setDone(`Assigned to ${r.data.ids.length} worker${r.data.ids.length === 1 ? "" : "s"}.`); form.reset(); }
        });
      }}
      className="max-w-md space-y-3 rounded-md border p-4"
    >
      <h3 className="font-medium">Assign checklist</h3>
      <div className="space-y-1">
        <Label htmlFor="templateId">Template</Label>
        <select id="templateId" name="templateId" className="w-full rounded-md border bg-background px-2 py-2 text-sm" required>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Workers</legend>
        {workers.length === 0 && <p className="text-sm text-muted-foreground">Add members to this property first.</p>}
        {workers.map((w) => (
          <label key={w.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="assigneeIds" value={w.id} /> {w.name}</label>
        ))}
      </fieldset>
      <div className="space-y-1">
        <Label htmlFor="dueAt">Due</Label>
        <input id="dueAt" name="dueAt" type="datetime-local" defaultValue={defaultDue} required className="w-full rounded-md border bg-background px-2 py-2 text-sm" />
      </div>
      <FormError message={error} />
      {done && <p className="text-sm text-muted-foreground">{done}</p>}
      <SubmitButton pending={pending}>Assign</SubmitButton>
    </form>
  );
}
