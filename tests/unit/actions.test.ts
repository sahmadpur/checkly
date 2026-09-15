import { expect, test } from "vitest";
import { z } from "zod";
import { run } from "@/lib/actions";
import { forbidden } from "@/lib/errors";

test("run maps success, AppError, and unknown errors", async () => {
  expect(await run(async () => 42)).toEqual({ ok: true, data: 42 });
  expect(await run(async () => { throw forbidden("removeSelf"); })).toEqual({ ok: false, error: "You cannot remove yourself" });
  expect(await run(async () => { throw new Error("prisma P2002 blah"); })).toEqual({ ok: false, error: "Something went wrong" });
});

test("run maps ZodError to its first issue message", async () => {
  const schema = z.object({ name: z.string().min(1, "Name is required") });
  expect(await run(async () => schema.parse({ name: "" }))).toEqual({ ok: false, error: "Name is required" });
});

test("run rethrows Next.js redirect errors", async () => {
  const redirectErr = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
  await expect(run(async () => { throw redirectErr; })).rejects.toBe(redirectErr);
});

test("run rethrows Next.js notFound/forbidden/unauthorized errors", async () => {
  const notFoundErr = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  await expect(run(async () => { throw notFoundErr; })).rejects.toBe(notFoundErr);
});
