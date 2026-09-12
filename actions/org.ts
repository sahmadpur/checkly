"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { run } from "@/lib/actions";
import { unstable_update } from "@/lib/auth/config";
import { requireSignedIn, requireUser } from "@/lib/auth/guard";
import { forbidden } from "@/lib/errors";
import { db } from "@/lib/db";
import * as svc from "@/lib/services/org";

export async function renameOrgAction(input: { name: string }) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.renameOrg(ctx, z.string().trim().min(1).max(100).parse(input.name));
    revalidatePath("/", "layout");
  });
}

export async function switchOrgAction(input: { orgId: string }) {
  return run(async () => {
    const { userId } = await requireSignedIn();
    const orgId = z.string().min(1).parse(input.orgId);
    const member = await db.orgMember.findUnique({ where: { orgId_userId: { orgId, userId } } });
    if (!member) throw forbidden();
    await unstable_update({ activeOrgId: orgId } as never);
    revalidatePath("/", "layout");
  });
}
