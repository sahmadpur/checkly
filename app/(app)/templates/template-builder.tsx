"use client";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { createTemplateAction, updateTemplateAction } from "@/actions/template";
import type { TemplateFormInput } from "@/actions/template.schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormError } from "@/components/form-error";
import { FormSuccess } from "@/components/form-success";
import { SubmitButton } from "@/components/submit-button";
import { Section } from "@/components/section";

type Item = Omit<TemplateFormInput["items"][number], "options" | "min" | "max"> & {
  options: string[];
  min: number | null;
  max: number | null;
};
const TYPES: Item["type"][] = ["CHECKBOX", "TEXT", "NUMBER", "SELECT", "PHOTO", "VIDEO"];
const blank = (type: Item["type"]): Item => ({ type, label: "", required: true, options: [], min: null, max: null });

export function TemplateBuilder({ template }: { template?: { id: string; name: string; description: string | null; items: Item[] } }) {
  const t = useTranslations("templates.builder");
  const te = useTranslations("enums");
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
    <form onSubmit={onSubmit} className="space-y-8">
      <Section title={t("details")} card>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="name">{t("name")}</Label><Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("namePlaceholder")} required /></div>
          <div className="space-y-1.5"><Label htmlFor="description">{t("description")}</Label><Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("descriptionPlaceholder")} /></div>
        </div>
      </Section>

      <Section title={t("items")} description={t("itemsDescription")}>
        <ol className="space-y-3">
          {items.map((it, i) => (
            <li key={i} className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-border" data-testid="item-row">
              <div className="flex items-start gap-2">
                <span className="mt-2.5 w-5 shrink-0 text-right text-sm text-muted-foreground tabular-nums">{i + 1}</span>
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[8.5rem_1fr]">
                  <Select aria-label={t("itemType")} value={it.type}
                    onChange={(e) => update(i, { ...blank(e.target.value as Item["type"]), label: it.label, required: it.required })}>
                    {TYPES.map((v) => <option key={v} value={v}>{te(`itemType.${v}`)}</option>)}
                  </Select>
                  <Input aria-label={t("itemLabel")} placeholder={t("itemLabelPlaceholder")} value={it.label} onChange={(e) => update(i, { label: e.target.value })} required />
                </div>
              </div>
              {it.type === "SELECT" && (
                <Textarea aria-label={t("options")} className="ml-7 w-auto" rows={3} placeholder={t("optionsPlaceholder")}
                  value={it.options.join("\n")} onChange={(e) => update(i, { options: e.target.value.split("\n") })} />
              )}
              {it.type === "NUMBER" && (
                <div className="ml-7 flex gap-2">
                  <Input aria-label={t("min")} type="number" inputMode="decimal" placeholder={t("min")} value={it.min ?? ""} onChange={(e) => update(i, { min: e.target.value === "" ? null : Number(e.target.value) })} className="w-28" />
                  <Input aria-label={t("max")} type="number" inputMode="decimal" placeholder={t("max")} value={it.max ?? ""} onChange={(e) => update(i, { max: e.target.value === "" ? null : Number(e.target.value) })} className="w-28" />
                </div>
              )}
              <div className="ml-7 flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={it.required} onChange={(e) => update(i, { required: e.target.checked })} /> {t("required")}</label>
                <div className="flex gap-1">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("moveUp")} onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp /></Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("moveDown")} onClick={() => move(i, 1)} disabled={i === items.length - 1}><ArrowDown /></Button>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("removeItem")} onClick={() => remove(i)} disabled={items.length === 1}><X /></Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          {TYPES.map((v) => (
            <Button key={v} type="button" variant="outline" size="sm" onClick={() => setItems((xs) => [...xs, blank(v)])}><Plus aria-hidden /> {te(`itemType.${v}`)}</Button>
          ))}
        </div>
      </Section>

      <FormError message={error} />
      {saved && template && <FormSuccess message={t("saved")} />}
      <SubmitButton pending={pending}>{template ? t("save") : t("create")}</SubmitButton>
    </form>
  );
}
