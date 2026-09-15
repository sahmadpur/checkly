"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { answerItemAction, submitChecklistAction } from "@/actions/instance";
import type { InstanceDetail, InstanceItemRow } from "@/lib/services/instance";
import { isItemAnswered } from "@/lib/media";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { FormError } from "@/components/form-error";
import { MediaItem } from "./media-item";
import { cn } from "cn";

export function FillForm({ instance, mediaUrls }: { instance: InstanceDetail; mediaUrls: Record<string, string> }) {
  const router = useRouter();
  const [items, setItems] = useState<InstanceItemRow[]>(instance.items);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const patch = (id: string, p: Partial<InstanceItemRow>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  async function save(item: InstanceItemRow, value: Parameters<typeof answerItemAction>[2], local: Partial<InstanceItemRow>) {
    const prev = items.find((x) => x.id === item.id);
    patch(item.id, local);
    setSaving((s) => ({ ...s, [item.id]: true }));
    const r = await answerItemAction(instance.id, item.id, value);
    setSaving((s) => ({ ...s, [item.id]: false }));
    setErrors((e) => ({ ...e, [item.id]: r.ok ? "" : r.error }));
    if (r.ok) patch(item.id, { answeredAt: new Date() });
    else if (prev) patch(item.id, prev);
  }

  const required = items.filter((i) => i.required);
  const done = required.filter(isItemAnswered).length;
  const complete = done === required.length;

  return (
    <div className="space-y-4">
      <ol className="space-y-3">
        {items.map((i) => {
          const answered = isItemAnswered(i);
          return (
            <li key={i.id} className={cn("space-y-3 rounded-xl bg-card p-4 ring-1 ring-border transition-colors", answered && "ring-primary/30")}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{i.label}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{saving[i.id] ? "Saving…" : answered ? "Saved" : i.required ? "Required" : "Optional"}</span>
              </div>
              {i.type === "CHECKBOX" && (
                <button type="button" aria-pressed={!!i.checked}
                  className={cn("flex h-14 w-full items-center gap-3 rounded-lg border-2 px-4 text-base font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px",
                    i.checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:bg-muted")}
                  onClick={() => save(i, { type: "CHECKBOX", checked: !i.checked }, { checked: !i.checked })}>
                  <span className={cn("flex size-7 items-center justify-center rounded-full border-2", i.checked ? "border-white/80 bg-white/15" : "border-input")}>
                    {i.checked && <Check className="size-4" strokeWidth={3} aria-hidden />}
                  </span>
                  {i.checked ? "Done" : "Mark done"}
                </button>
              )}
              {i.type === "TEXT" && (
                <Textarea rows={3} defaultValue={i.text ?? ""} placeholder="Type your answer"
                  onBlur={(e) => { if (e.target.value !== (i.text ?? "")) save(i, { type: "TEXT", text: e.target.value }, { text: e.target.value }); }} />
              )}
              {i.type === "NUMBER" && (
                <Input type="number" inputMode="decimal" step="any" min={i.min ?? undefined} max={i.max ?? undefined} defaultValue={i.number ?? ""}
                  placeholder={i.min !== null || i.max !== null ? `${i.min ?? ""} to ${i.max ?? ""}`.trim() : undefined}
                  onBlur={(e) => { if (e.target.value !== "") { const n = Number(e.target.value); save(i, { type: "NUMBER", number: n }, { number: n }); } }} />
              )}
              {i.type === "SELECT" && (
                <Select value={i.choice ?? ""} onChange={(e) => save(i, { type: "SELECT", choice: e.target.value }, { choice: e.target.value })}>
                  <option value="" disabled>Choose…</option>
                  {i.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </Select>
              )}
              {(i.type === "PHOTO" || i.type === "VIDEO") && (
                <MediaItem instanceId={instance.id} itemId={i.id} type={i.type} existingUrl={mediaUrls[i.id]}
                  onSaved={() => patch(i.id, { fileKey: "set", answeredAt: new Date() })} />
              )}
              <FormError message={errors[i.id]} />
            </li>
          );
        })}
      </ol>

      <div className="sticky bottom-24 z-10 -mx-4 rounded-t-2xl border-t bg-card/95 px-4 pt-3 pb-3 shadow-[0_-8px_24px_-12px_rgba(27,38,36,0.25)] backdrop-blur md:bottom-0 md:-mx-8 md:rounded-none md:px-8">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{done} of {required.length} required done</p>
            <div className="mt-1.5 h-1.5 w-32 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${required.length ? (done / required.length) * 100 : 100}%` }} /></div>
          </div>
          <Button size="lg" disabled={!complete || pending}
            onClick={() => start(async () => { const r = await submitChecklistAction(instance.id); if (!r.ok) setSubmitError(r.error); else router.refresh(); })}>
            Submit
          </Button>
        </div>
        <FormError message={submitError} />
      </div>
    </div>
  );
}
