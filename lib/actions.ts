import { AppError } from "@/lib/errors";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const isNextControlFlow = (e: unknown) =>
  typeof e === "object" && e !== null && "digest" in e &&
  typeof (e as { digest: unknown }).digest === "string" &&
  ((e as { digest: string }).digest.startsWith("NEXT_REDIRECT") || (e as { digest: string }).digest.startsWith("NEXT_NOT_FOUND"));

export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (isNextControlFlow(e)) throw e;
    if (e instanceof AppError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong" };
  }
}
