"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { run } from "@/lib/actions";
import { requireUser } from "@/lib/auth/guard";
import * as svc from "@/lib/services/schedule";
import { scheduleSchema } from "@/actions/schedule.schemas";

export async function createScheduleAction(propertyId: string, input: z.input<typeof scheduleSchema>) {
  const result = await run(async () => {
    const ctx = await requireUser();
    await svc.createSchedule(ctx, propertyId, scheduleSchema.parse(input));
    revalidatePath(`/properties/${propertyId}`);
  });
  if (result.ok) redirect(`/properties/${propertyId}`);
  return result;
}

export async function updateScheduleAction(id: string, input: z.input<typeof scheduleSchema>) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.updateSchedule(ctx, id, scheduleSchema.parse(input));
    revalidatePath(`/schedules/${id}`);
  });
}

export async function pauseScheduleAction(id: string) {
  return run(async () => { const ctx = await requireUser(); await svc.pauseSchedule(ctx, id); revalidatePath(`/schedules/${id}`); revalidatePath("/properties", "layout"); });
}

export async function resumeScheduleAction(id: string) {
  return run(async () => { const ctx = await requireUser(); await svc.resumeSchedule(ctx, id); revalidatePath(`/schedules/${id}`); revalidatePath("/properties", "layout"); });
}

export async function deleteScheduleAction(id: string, propertyId: string) {
  const result = await run(async () => { const ctx = await requireUser(); await svc.deleteSchedule(ctx, id); revalidatePath(`/properties/${propertyId}`); });
  if (result.ok) redirect(`/properties/${propertyId}`);
  return result;
}
