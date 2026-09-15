"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { run } from "@/lib/actions";
import { requireUser } from "@/lib/auth/guard";
import * as svc from "@/lib/services/instance";
import { answerSchema, assignSchema, reviewSchema, uploadRequestSchema } from "@/actions/instance.schemas";

export async function assignChecklistAction(input: z.input<typeof assignSchema>) {
  return run(async () => {
    const ctx = await requireUser();
    const data = assignSchema.parse(input);
    const out = await svc.assign(ctx, data);
    revalidatePath(`/properties/${data.propertyId}`);
    revalidatePath("/checklists");
    return out;
  });
}

export async function answerItemAction(instanceId: string, itemId: string, value: z.input<typeof answerSchema>) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.answerItem(ctx, instanceId, itemId, answerSchema.parse(value));
  });
}

export async function submitChecklistAction(instanceId: string) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.submit(ctx, instanceId);
    revalidatePath(`/checklists/${instanceId}`);
    revalidatePath("/today");
  });
}

export async function reviewChecklistAction(instanceId: string, input: z.input<typeof reviewSchema>) {
  return run(async () => {
    const ctx = await requireUser();
    const data = reviewSchema.parse(input);
    await svc.review(ctx, instanceId, data.decision, data.comment);
    revalidatePath(`/checklists/${instanceId}`);
  });
}

export async function requestUploadAction(input: z.input<typeof uploadRequestSchema>) {
  return run(async () => {
    const ctx = await requireUser();
    return svc.requestUpload(ctx, uploadRequestSchema.parse(input));
  });
}
