"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { run } from "@/lib/actions";
import { unstable_update } from "@/lib/auth/config";
import { requireSignedIn, requireUser } from "@/lib/auth/guard";
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
    await svc.assertMembership(userId, orgId);
    await unstable_update({ activeOrgId: orgId } as never);
    revalidatePath("/", "layout");
  });
}
