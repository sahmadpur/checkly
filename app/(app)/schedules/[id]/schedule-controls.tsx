"use client";
import { useState, useTransition } from "react";
import { Pause, Play, Trash2 } from "lucide-react";
import { deleteScheduleAction, pauseScheduleAction, resumeScheduleAction } from "@/actions/schedule";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";

export function ScheduleControls({ id, paused }: { id: string; paused: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string } | undefined>) => start(async () => { const r = await fn(); if (r && !r.ok) setError(r.error ?? "Failed"); });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" disabled={pending} onClick={() => act(() => (paused ? resumeScheduleAction(id) : pauseScheduleAction(id)))}>
        {paused ? <Play aria-hidden /> : <Pause aria-hidden />}{paused ? "Resume" : "Pause"}
      </Button>
      <Button variant="destructive" disabled={pending} onClick={() => { if (confirm("Delete this schedule? Existing checklists are kept.")) act(() => deleteScheduleAction(id)); }}>
        <Trash2 aria-hidden /> Delete
      </Button>
      <FormError message={error} />
    </div>
  );
}
