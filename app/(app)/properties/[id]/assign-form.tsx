"use client";
import { useState, useTransition } from "react";
import { assignChecklistAction } from "@/actions/instance";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/form-error";
import { FormSuccess } from "@/components/form-success";
import { SubmitButton } from "@/components/submit-button";
import { Section } from "@/components/section";
import { toLocalInputValue } from "@/lib/format";

type Opt = { id: string; name: string };

export function AssignForm({ propertyId, templates, workers }: { propertyId: string; templates: Opt[]; workers: Opt[] }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [defaultDue] = useState(() => toLocalInputValue(new Date(Date.now() + 24 * 3600_000)));
  return (
    <Section title="Assign a checklist" description="Each worker gets their own copy." card>
      {templates.length === 0 ? <p className="text-sm text-muted-foreground">Create a template first.</p> : (
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
          className="space-y-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="templateId">Template</Label>
              <Select id="templateId" name="templateId" required>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dueAt">Due</Label>
              <Input id="dueAt" name="dueAt" type="datetime-local" defaultValue={defaultDue} required />
            </div>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">Workers</legend>
            {workers.length === 0 && <p className="text-sm text-muted-foreground">Add members to this property first.</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {workers.map((w) => (
                <label key={w.id} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-accent/50"><input type="checkbox" name="assigneeIds" value={w.id} /> {w.name}</label>
              ))}
            </div>
          </fieldset>
          <FormError message={error} />
          {done && <FormSuccess message={done} />}
          <SubmitButton pending={pending}>Assign</SubmitButton>
        </form>
      )}
    </Section>
  );
}
