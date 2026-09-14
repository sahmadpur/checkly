"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerItemAction, submitChecklistAction } from "@/actions/instance";
import type { InstanceDetail, InstanceItemRow } from "@/lib/services/instance";
import { isItemAnswered } from "@/lib/media";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { MediaItem } from "./media-item";

export function FillForm({ instance, mediaUrls }: { instance: InstanceDetail; mediaUrls: Record<string, string> }) {
  const router = useRouter();
  const [items, setItems] = useState<InstanceItemRow[]>(instance.items);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const patch = (id: string, p: Partial<InstanceItemRow>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  async function save(item: InstanceItemRow, value: Parameters<typeof answerItemAction>[2], local: Partial<InstanceItemRow>) {
    patch(item.id, local);
    setSaving((s) => ({ ...s, [item.id]: true }));
    const r = await answerItemAction(instance.id, item.id, value);
    setSaving((s) => ({ ...s, [item.id]: false }));
    setErrors((e) => ({ ...e, [item.id]: r.ok ? "" : r.error }));
    if (r.ok) patch(item.id, { answeredAt: new Date() });
  }

  const required = items.filter((i) => i.required);
  const done = required.filter(isItemAnswered).length;
  const complete = done === required.length;

  return (
    <div className="space-y-4 pb-24">
      <ol className="space-y-3">
        {items.map((i) => (
          <li key={i.id} className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{i.label}{i.required && <span className="text-destructive"> *</span>}</span>
              <span className="text-xs text-muted-foreground">{saving[i.id] ? "Saving…" : isItemAnswered(i) ? "Saved" : ""}</span>
            </div>
            {i.type === "CHECKBOX" && (
              <Button type="button" variant={i.checked ? "default" : "outline"} className="w-full justify-start"
                onClick={() => save(i, { type: "CHECKBOX", checked: !i.checked }, { checked: !i.checked })}>
                {i.checked ? "✓ Done" : "Mark done"}
              </Button>
            )}
            {i.type === "TEXT" && (
              <textarea className="w-full rounded-md border bg-background p-2 text-sm" rows={3} defaultValue={i.text ?? ""}
                onBlur={(e) => { if (e.target.value !== (i.text ?? "")) save(i, { type: "TEXT", text: e.target.value }, { text: e.target.value }); }} />
            )}
            {i.type === "NUMBER" && (
              <input type="number" inputMode="decimal" step="any" min={i.min ?? undefined} max={i.max ?? undefined} defaultValue={i.number ?? ""}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                onBlur={(e) => { if (e.target.value !== "") { const n = Number(e.target.value); save(i, { type: "NUMBER", number: n }, { number: n }); } }} />
            )}
            {i.type === "SELECT" && (
              <select className="w-full rounded-md border bg-background px-2 py-2 text-sm" value={i.choice ?? ""}
                onChange={(e) => save(i, { type: "SELECT", choice: e.target.value }, { choice: e.target.value })}>
                <option value="" disabled>Choose…</option>
                {i.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {(i.type === "PHOTO" || i.type === "VIDEO") && (
              <MediaItem instanceId={instance.id} itemId={i.id} type={i.type} existingUrl={mediaUrls[i.id]}
                onSaved={() => patch(i.id, { fileKey: "set", answeredAt: new Date() })} />
            )}
            <FormError message={errors[i.id]} />
          </li>
        ))}
      </ol>

      <div className="fixed inset-x-0 bottom-16 z-10 border-t bg-background p-3 md:bottom-0 md:left-56">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">{done} of {required.length} required done</span>
          <Button disabled={!complete || pending}
            onClick={() => start(async () => { const r = await submitChecklistAction(instance.id); if (!r.ok) setSubmitError(r.error); else router.refresh(); })}>
            Submit
          </Button>
        </div>
        <FormError message={submitError} />
      </div>
    </div>
  );
}
