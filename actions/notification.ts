"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { run } from "@/lib/actions";
import { requireUser } from "@/lib/auth/guard";
import * as svc from "@/lib/services/notification";
import { preferencesSchema, pushSubscriptionSchema } from "@/actions/notification.schemas";

export async function savePushSubscriptionAction(input: z.input<typeof pushSubscriptionSchema>) {
  return run(async () => { const ctx = await requireUser(); await svc.savePushSubscription(ctx, pushSubscriptionSchema.parse(input)); });
}
export async function deletePushSubscriptionAction(endpoint: string) {
  return run(async () => { const ctx = await requireUser(); await svc.deletePushSubscription(ctx, z.string().url().parse(endpoint)); });
}
export async function setPreferencesAction(input: z.input<typeof preferencesSchema>) {
  return run(async () => { const ctx = await requireUser(); await svc.setPreferences(ctx, preferencesSchema.parse(input)); revalidatePath("/settings"); });
}
export async function markReadAction(id: string) {
  return run(async () => { const ctx = await requireUser(); await svc.markRead(ctx, z.string().min(1).parse(id)); revalidatePath("/notifications"); revalidatePath("/", "layout"); });
}
export async function markAllReadAction() {
  return run(async () => { const ctx = await requireUser(); await svc.markAllRead(ctx); revalidatePath("/notifications"); revalidatePath("/", "layout"); });
}
