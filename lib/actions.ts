import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AppError) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Invalid input" };
    console.error(e);
    return { ok: false, error: "Something went wrong" };
  }
}
