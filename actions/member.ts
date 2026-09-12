"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { run } from "@/lib/actions";
import { requireUser } from "@/lib/auth/guard";
import * as svc from "@/lib/services/member";

const roleSchema = z.enum(["OWNER", "MANAGER", "WORKER"]);

export async function changeRoleAction(userId: string, role: string) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.changeRole(ctx, userId, roleSchema.parse(role));
    revalidatePath("/team");
  });
}

export async function removeMemberAction(userId: string) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.removeMember(ctx, userId);
    revalidatePath("/team");
  });
}
