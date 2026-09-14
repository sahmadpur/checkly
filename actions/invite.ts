"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { run } from "@/lib/actions";
import { signIn } from "@/lib/auth/config";
import { requireSignedIn, requireUser } from "@/lib/auth/guard";
import { landingForUser } from "@/lib/auth/landing";
import { throttle } from "@/lib/request";
import * as svc from "@/lib/services/invite";
import { inviteSchema, acceptNewSchema } from "@/actions/invite.schemas";

export async function createInviteAction(input: z.infer<typeof inviteSchema>) {
  return run(async () => {
    await throttle("invite", 20, 0.1);
    const ctx = await requireUser();
    await svc.createInvite(ctx, inviteSchema.parse(input));
    revalidatePath("/team");
  });
}

export async function revokeInviteAction(id: string) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.revokeInvite(ctx, id);
    revalidatePath("/team");
  });
}

/** New user: creates the account, accepts, signs in. */
export async function acceptInviteNewUserAction(input: z.infer<typeof acceptNewSchema>) {
  const result = await run(async () => {
    const data = acceptNewSchema.parse(input);
    const info = await svc.getInvite(data.token);
    const { userId } = await svc.acceptInvite(data.token, { name: data.name, password: data.password, phone: data.phone });
    await signIn("credentials", { identifier: info!.email, password: data.password, redirect: false });
    return landingForUser(userId);
  });
  if (result.ok) redirect(result.data);
  return result;
}

/** Existing, signed-in user accepts. */
export async function acceptInviteExistingAction(token: string) {
  const result = await run(async () => {
    const { userId } = await requireSignedIn();
    await svc.acceptInvite(z.string().length(64).parse(token), { userId });
    return landingForUser(userId);
  });
  if (result.ok) redirect(result.data);
  return result;
}
