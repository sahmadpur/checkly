"use client";
import { useState, useTransition } from "react";
import { createTemplateAction, updateTemplateAction } from "@/actions/template";
import type { TemplateFormInput } from "@/actions/template.schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

type Item = Omit<TemplateFormInput["items"][number], "options" | "min" | "max"> & {
  options: string[];
  min: number | null;
  max: number | null;
};
const TYPES: { value: Item["type"]; label: string }[] = [
  { value: "CHECKBOX", label: "Checkbox" }, { value: "TEXT", label: "Text" }, { value: "NUMBER", label: "Number" },
  { value: "SELECT", label: "Choice" }, { value: "PHOTO", label: "Photo" }, { value: "VIDEO", label: "Video" },
];
const blank = (type: Item["type"]): Item => ({ type, label: "", required: true, options: [], min: null, max: null });

export function TemplateBuilder({ template }: { template?: { id: string; name: string; description: string | null; items: Item[] } }) {
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [items, setItems] = useState<Item[]>(template?.items ?? [blank("CHECKBOX")]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const update = (i: number, patch: Partial<Item>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, dir: -1 | 1) => setItems((xs) => {
    const j = i + dir; if (j < 0 || j >= xs.length) return xs;
    const copy = [...xs]; [copy[i], copy[j]] = [copy[j], copy[i]]; return copy;
  });
  const remove = (i: number) => setItems((xs) => xs.filter((_, j) => j !== i));

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input: TemplateFormInput = { name, description, items };
    start(async () => {
      const res = template ? await updateTemplateAction(template.id, input) : await createTemplateAction(input);
      if (res && !res.ok) { setError(res.error); setSaved(false); } else { setError(null); setSaved(true); }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="name">Name</Label><Input id="name" value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div className="space-y-1"><Label htmlFor="description">Description</Label><Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      </div>

      <ol className="space-y-3">
        {items.map((it, i) => (
          <li key={i} className="space-y-2 rounded-md border p-3" data-testid="item-row">
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Item type" className="rounded-md border bg-background px-2 py-1 text-sm" value={it.type}
                onChange={(e) => update(i, { ...blank(e.target.value as Item["type"]), label: it.label, required: it.required })}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <Input aria-label="Item label" placeholder="Label" value={it.label} onChange={(e) => update(i, { label: e.target.value })} className="min-w-40 flex-1" required />
              <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={it.required} onChange={(e) => update(i, { required: e.target.checked })} /> Required</label>
              <div className="ml-auto flex gap-1">
                <Button type="button" variant="ghost" size="sm" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>↑</Button>
                <Button type="button" variant="ghost" size="sm" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === items.length - 1}>↓</Button>
                <Button type="button" variant="ghost" size="sm" aria-label="Remove item" onClick={() => remove(i)}>✕</Button>
              </div>
            </div>
            {it.type === "SELECT" && (
              <textarea aria-label="Options, one per line" className="w-full rounded-md border bg-background p-2 text-sm" rows={3} placeholder="One option per line"
                value={it.options.join("\n")} onChange={(e) => update(i, { options: e.target.value.split("\n") })} />
            )}
            {it.type === "NUMBER" && (
              <div className="flex gap-2">
                <Input aria-label="Min" type="number" placeholder="Min" value={it.min ?? ""} onChange={(e) => update(i, { min: e.target.value === "" ? null : Number(e.target.value) })} className="w-28" />
                <Input aria-label="Max" type="number" placeholder="Max" value={it.max ?? ""} onChange={(e) => update(i, { max: e.target.value === "" ? null : Number(e.target.value) })} className="w-28" />
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <Button key={t.value} type="button" variant="outline" size="sm" onClick={() => setItems((xs) => [...xs, blank(t.value)])}>+ {t.label}</Button>
        ))}
      </div>

      <FormError message={error} />
      {saved && template && <p className="text-sm text-muted-foreground">Saved.</p>}
      <div className="max-w-xs"><SubmitButton pending={pending}>{template ? "Save" : "Create template"}</SubmitButton></div>
    </form>
  );
}
