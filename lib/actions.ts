import { unstable_rethrow } from "next/navigation";
import { AppError } from "@/lib/errors";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    unstable_rethrow(e);
    if (e instanceof AppError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong" };
  }
}
