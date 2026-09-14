"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { run } from "@/lib/actions";
import { requireUser } from "@/lib/auth/guard";
import * as svc from "@/lib/services/template";
import { templateSchema } from "@/actions/template.schemas";

const toInput = (d: z.infer<typeof templateSchema>) => ({ name: d.name, description: d.description || null, items: d.items });

export async function createTemplateAction(input: z.input<typeof templateSchema>) {
  const result = await run(async () => {
    const ctx = await requireUser();
    return svc.createTemplate(ctx, toInput(templateSchema.parse(input)));
  });
  if (result.ok) {
    revalidatePath("/templates");
    redirect(`/templates/${result.data.id}`);
  }
  return result;
}

export async function updateTemplateAction(id: string, input: z.input<typeof templateSchema>) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.updateTemplate(ctx, id, toInput(templateSchema.parse(input)));
    revalidatePath(`/templates/${id}`);
    revalidatePath("/templates");
  });
}

export async function archiveTemplateAction(id: string) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.archiveTemplate(ctx, id);
    revalidatePath("/templates");
    revalidatePath(`/templates/${id}`);
  });
}

export async function unarchiveTemplateAction(id: string) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.unarchiveTemplate(ctx, id);
    revalidatePath("/templates");
    revalidatePath(`/templates/${id}`);
  });
}
