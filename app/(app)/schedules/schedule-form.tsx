"use client";
import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { createScheduleAction, updateScheduleAction } from "@/actions/schedule";
import type { ScheduleFormInput } from "@/actions/schedule.schemas";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError } from "@/components/form-error";
import { FormSuccess } from "@/components/form-success";
import { SubmitButton } from "@/components/submit-button";
import { Section } from "@/components/section";
import { Notice } from "@/components/notice";
import { cn } from "cn";
import { weekdayName } from "@/lib/format";

type Opt = { id: string; name: string };
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const segment = "flex-1 rounded-md px-3 py-2 text-center text-sm font-medium transition-colors has-checked:bg-card has-checked:shadow-sm has-checked:text-foreground text-muted-foreground cursor-pointer";

export function ScheduleForm({ propertyId, templates, workers, todayYmd, templateArchived, schedule }: {
  propertyId: string; templates: Opt[]; workers: Opt[]; todayYmd: string; templateArchived?: boolean;
  schedule?: { id: string; templateId: string; assigneeIds: string[]; freq: "DAILY" | "WEEKLY" | "MONTHLY"; daysOfWeek: number[]; dayOfMonth: number | null; dueTime: string; startsOn: Date; endsOn: Date | null };
}) {
  const t = useTranslations("schedules.form");
  const te = useTranslations("enums");
  const locale = useLocale();
  const [freq, setFreq] = useState<ScheduleFormInput["freq"]>(schedule?.freq ?? "DAILY");
  const [days, setDays] = useState<number[]>(schedule?.daysOfWeek ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const input: ScheduleFormInput = {
          templateId: String(fd.get("templateId")), assigneeIds: fd.getAll("assigneeIds").map(String), freq,
          daysOfWeek: freq === "WEEKLY" ? days : [], dayOfMonth: freq === "MONTHLY" ? Number(fd.get("dayOfMonth")) : null,
          dueTime: String(fd.get("dueTime")), startsOn: String(fd.get("startsOn")), endsOn: String(fd.get("endsOn") ?? ""),
        };
        start(async () => {
          const r = schedule ? await updateScheduleAction(schedule.id, input) : await createScheduleAction(propertyId, input);
          if (r && !r.ok) { setError(r.error); setSaved(false); } else { setError(null); setSaved(true); }
        });
      }}
      className="space-y-8"
    >
      <Section title={t("whatWho")} card>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="templateId">{t("template")}</Label>
            <Select id="templateId" name="templateId" defaultValue={schedule?.templateId} required>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
            {templateArchived && <Notice tone="warning">{t("archived")}</Notice>}
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-medium">{t("workers")}</legend>
            {workers.length === 0 && <p className="text-sm text-muted-foreground">{t("noWorkers")}</p>}
            <div className="grid gap-2 sm:grid-cols-2">
              {workers.map((w) => (
                <label key={w.id} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm has-checked:border-primary has-checked:bg-accent/50"><input type="checkbox" name="assigneeIds" value={w.id} defaultChecked={schedule?.assigneeIds.includes(w.id)} /> {w.name}</label>
              ))}
            </div>
          </fieldset>
        </div>
      </Section>

      <Section title={t("when")} card>
        <div className="space-y-4">
          <fieldset className="space-y-3">
            <legend className="mb-1 text-sm font-medium">{t("repeats")}</legend>
            <div className="flex rounded-lg bg-muted p-1">
              {(["DAILY", "WEEKLY", "MONTHLY"] as const).map((f) => (
                <label key={f} className={segment}><input type="radio" name="freq" value={f} checked={freq === f} onChange={() => setFreq(f)} className="sr-only" />{te(`freq.${f}`)}</label>
              ))}
            </div>
            {freq === "WEEKLY" && (
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 7 }, (_, i) => weekdayName(i, locale)).map((d, i) => (
                  <button type="button" key={i} aria-pressed={days.includes(i)} onClick={() => setDays((xs) => (xs.includes(i) ? xs.filter((x) => x !== i) : [...xs, i]))}
                    className={cn("h-10 rounded-lg border text-sm font-medium transition-colors", days.includes(i) ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:bg-muted")}>{d}</button>
                ))}
              </div>
            )}
            {freq === "MONTHLY" && (
              <div className="space-y-1.5"><Label htmlFor="dayOfMonth">{t("dayOfMonth")}</Label><Input id="dayOfMonth" name="dayOfMonth" type="number" inputMode="numeric" min={1} max={31} defaultValue={schedule?.dayOfMonth ?? 1} className="w-24" required /></div>
            )}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5"><Label htmlFor="dueTime">{t("dueTime")}</Label><Input id="dueTime" name="dueTime" type="time" defaultValue={schedule?.dueTime ?? "09:00"} required /></div>
            <div className="space-y-1.5"><Label htmlFor="startsOn">{t("startsOn")}</Label><Input id="startsOn" name="startsOn" type="date" defaultValue={schedule ? ymd(schedule.startsOn) : todayYmd} required /></div>
            <div className="space-y-1.5"><Label htmlFor="endsOn">{t("endsOn")}</Label><Input id="endsOn" name="endsOn" type="date" defaultValue={schedule?.endsOn ? ymd(schedule.endsOn) : ""} /></div>
          </div>
        </div>
      </Section>

      <FormError message={error} />
      {saved && schedule && <FormSuccess message={t("saved")} />}
      <SubmitButton pending={pending}>{schedule ? t("save") : t("create")}</SubmitButton>
    </form>
  );
}
