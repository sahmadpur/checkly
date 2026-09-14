"use client";
import { useState, useTransition } from "react";
import { createScheduleAction, updateScheduleAction } from "@/actions/schedule";
import type { ScheduleFormInput } from "@/actions/schedule.schemas";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

type Opt = { id: string; name: string };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function ScheduleForm({ propertyId, templates, workers, todayYmd, templateArchived, schedule }: {
  propertyId: string; templates: Opt[]; workers: Opt[]; todayYmd: string; templateArchived?: boolean;
  schedule?: { id: string; templateId: string; assigneeIds: string[]; freq: "DAILY" | "WEEKLY" | "MONTHLY"; daysOfWeek: number[]; dayOfMonth: number | null; dueTime: string; startsOn: Date; endsOn: Date | null };
}) {
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
      className="max-w-md space-y-4"
    >
      <div className="space-y-1">
        <Label htmlFor="templateId">Template</Label>
        <select id="templateId" name="templateId" defaultValue={schedule?.templateId} className="w-full rounded-md border bg-background px-2 py-2 text-sm" required>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {templateArchived && <p className="text-sm text-muted-foreground">This template is archived; pick another to keep generating.</p>}
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Workers</legend>
        {workers.map((w) => (
          <label key={w.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="assigneeIds" value={w.id} defaultChecked={schedule?.assigneeIds.includes(w.id)} /> {w.name}</label>
        ))}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Repeats</legend>
        <div className="flex gap-3 text-sm">
          {(["DAILY", "WEEKLY", "MONTHLY"] as const).map((f) => (
            <label key={f} className="flex items-center gap-1"><input type="radio" name="freq" value={f} checked={freq === f} onChange={() => setFreq(f)} /> {f[0] + f.slice(1).toLowerCase()}</label>
          ))}
        </div>
        {freq === "WEEKLY" && (
          <div className="flex flex-wrap gap-1">
            {DAYS.map((d, i) => (
              <button type="button" key={d} aria-pressed={days.includes(i)} onClick={() => setDays((xs) => (xs.includes(i) ? xs.filter((x) => x !== i) : [...xs, i]))}
                className={`rounded-md border px-2 py-1 text-sm ${days.includes(i) ? "bg-primary text-primary-foreground" : ""}`}>{d}</button>
            ))}
          </div>
        )}
        {freq === "MONTHLY" && (
          <div className="space-y-1"><Label htmlFor="dayOfMonth">Day of month</Label><Input id="dayOfMonth" name="dayOfMonth" type="number" min={1} max={31} defaultValue={schedule?.dayOfMonth ?? 1} className="w-24" required /></div>
        )}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label htmlFor="dueTime">Due time</Label><Input id="dueTime" name="dueTime" type="time" defaultValue={schedule?.dueTime ?? "09:00"} required /></div>
        <div className="space-y-1"><Label htmlFor="startsOn">Starts on</Label><Input id="startsOn" name="startsOn" type="date" defaultValue={schedule ? ymd(schedule.startsOn) : todayYmd} required /></div>
        <div className="space-y-1"><Label htmlFor="endsOn">Ends on</Label><Input id="endsOn" name="endsOn" type="date" defaultValue={schedule?.endsOn ? ymd(schedule.endsOn) : ""} /></div>
      </div>
      <FormError message={error} />
      {saved && schedule && <p className="text-sm text-muted-foreground">Saved. Changes apply to future occurrences.</p>}
      <SubmitButton pending={pending}>{schedule ? "Save" : "Create schedule"}</SubmitButton>
    </form>
  );
}
