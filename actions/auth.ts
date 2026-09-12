"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AuthError } from "next-auth";
import { run } from "@/lib/actions";
import { signIn, signOut, unstable_update } from "@/lib/auth/config";
import { requireSignedIn } from "@/lib/auth/guard";
import { throttle, safeNext } from "@/lib/request";
import { invalid } from "@/lib/errors";
import * as svc from "@/lib/services/auth";
import { signupSchema, loginSchema, resetSchema, changePasswordSchema, profileSchema } from "@/actions/auth.schemas";

export async function signupAction(input: z.infer<typeof signupSchema>) {
  const result = await run(async () => {
    await throttle("signup", 5, 0.05);
    const data = signupSchema.parse(input);
    await svc.signup(data);
    await signIn("credentials", { identifier: data.email, password: data.password, redirect: false });
  });
  if (result.ok) redirect("/");
  return result;
}

export async function loginAction(input: z.infer<typeof loginSchema>, next?: string) {
  const result = await run(async () => {
    await throttle("login", 10, 0.2);
    const data = loginSchema.parse(input);
    try {
      await signIn("credentials", { ...data, redirect: false });
    } catch (e) {
      if (e instanceof AuthError) throw invalid("Incorrect identifier or password");
      throw e;
    }
  });
  if (result.ok) redirect(safeNext(next));
  return result;
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}

export async function forgotPasswordAction(input: { identifier: string }) {
  return run(async () => {
    await throttle("forgot", 5, 0.05);
    await svc.requestPasswordReset(z.string().trim().min(1).parse(input.identifier));
  });
}

export async function resetPasswordAction(input: z.infer<typeof resetSchema>) {
  const result = await run(async () => {
    const data = resetSchema.parse(input);
    await svc.resetPassword(data.token, data.password);
  });
  if (result.ok) redirect("/login?reset=1");
  return result;
}

export async function changePasswordAction(input: z.infer<typeof changePasswordSchema>) {
  return run(async () => {
    const { userId } = await requireSignedIn();
    const data = changePasswordSchema.parse(input);
    await svc.changePassword(userId, data.current, data.next);
  });
}

export async function updateProfileAction(input: z.infer<typeof profileSchema>) {
  return run(async () => {
    const { userId } = await requireSignedIn();
    const data = profileSchema.parse(input);
    await svc.updateProfile(userId, data);
    await unstable_update({ name: data.name } as never);
    revalidatePath("/", "layout");
  });
}
