"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { run } from "@/lib/actions";
import { requireUser } from "@/lib/auth/guard";
import * as svc from "@/lib/services/property";
import { propertySchema } from "@/actions/property.schemas";

export async function createPropertyAction(input: z.infer<typeof propertySchema>) {
  const result = await run(async () => {
    const ctx = await requireUser();
    const data = propertySchema.parse(input);
    return svc.createProperty(ctx, { name: data.name, address: data.address || null });
  });
  if (result.ok) redirect(`/properties/${result.data.id}`);
  return result;
}

export async function updatePropertyAction(id: string, input: z.infer<typeof propertySchema>) {
  return run(async () => {
    const ctx = await requireUser();
    const data = propertySchema.parse(input);
    await svc.updateProperty(ctx, id, { name: data.name, address: data.address || null });
    revalidatePath(`/properties/${id}`);
  });
}

export async function deletePropertyAction(id: string) {
  const result = await run(async () => {
    const ctx = await requireUser();
    await svc.deleteProperty(ctx, id);
  });
  if (result.ok) redirect("/");
  return result;
}

export async function addPropertyMemberAction(propertyId: string, userId: string) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.addPropertyMember(ctx, propertyId, userId);
    revalidatePath(`/properties/${propertyId}`);
  });
}

export async function removePropertyMemberAction(propertyId: string, userId: string) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.removePropertyMember(ctx, propertyId, userId);
    revalidatePath(`/properties/${propertyId}`);
  });
}
