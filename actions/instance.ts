"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { run } from "@/lib/actions";
import { requireUser } from "@/lib/auth/guard";
import { invalid } from "@/lib/errors";
import { extForMime, mediaKey, mediaRule } from "@/lib/media";
import { presignUpload } from "@/lib/storage";
import * as svc from "@/lib/services/instance";
import { answerSchema, assignSchema, reviewSchema, uploadRequestSchema } from "@/actions/instance.schemas";

export async function assignChecklistAction(input: z.input<typeof assignSchema>) {
  return run(async () => {
    const ctx = await requireUser();
    const data = assignSchema.parse(input);
    const out = await svc.assign(ctx, data);
    revalidatePath(`/properties/${data.propertyId}`);
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

/** Issues a presigned PUT for a PHOTO or VIDEO item. The key is deterministic per item, so re-uploads overwrite. */
export async function requestUploadAction(input: z.input<typeof uploadRequestSchema>) {
  return run(async () => {
    const ctx = await requireUser();
    const data = uploadRequestSchema.parse(input);
    const inst = await svc.getInstance(ctx, data.instanceId);
    if (!inst.canFill) throw invalid("This checklist cannot be edited");
    const item = inst.items.find((i) => i.id === data.itemId);
    if (!item || (item.type !== "PHOTO" && item.type !== "VIDEO")) throw invalid("Item does not accept files");
    const rule = mediaRule(item.type);
    if (!rule.types.includes(data.contentType)) throw invalid(`Unsupported file type ${data.contentType}`);
    if (data.sizeBytes > rule.maxBytes) throw invalid(`File is too large (max ${Math.round(rule.maxBytes / 1024 / 1024)} MB)`);
    const key = mediaKey(ctx.orgId, data.instanceId, data.itemId, extForMime(data.contentType)!);
    const url = await presignUpload({ key, contentType: data.contentType, contentLength: data.sizeBytes, expiresSec: rule.presignSec });
    return { url, key };
  });
}
