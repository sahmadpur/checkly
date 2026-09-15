"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Pause, Play, Trash2 } from "lucide-react";
import { deleteScheduleAction, pauseScheduleAction, resumeScheduleAction } from "@/actions/schedule";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";

export function ScheduleControls({ id, paused }: { id: string; paused: boolean }) {
  const t = useTranslations("schedules.controls");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string } | undefined>) => start(async () => { const r = await fn(); if (r && !r.ok) setError(r.error ?? t("failed")); });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" disabled={pending} onClick={() => act(() => (paused ? resumeScheduleAction(id) : pauseScheduleAction(id)))}>
        {paused ? <Play aria-hidden /> : <Pause aria-hidden />}{paused ? t("resume") : t("pause")}
      </Button>
      <Button variant="destructive" disabled={pending} onClick={() => { if (confirm(t("deleteConfirm"))) act(() => deleteScheduleAction(id)); }}>
        <Trash2 aria-hidden /> {t("delete")}
      </Button>
      <FormError message={error} />
    </div>
  );
}
