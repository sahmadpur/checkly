import { expect, test } from "vitest";
import { run } from "@/lib/actions";
import { forbidden } from "@/lib/errors";

test("run maps success, AppError, and unknown errors", async () => {
  expect(await run(async () => 42)).toEqual({ ok: true, data: 42 });
  expect(await run(async () => { throw forbidden("Nope"); })).toEqual({ ok: false, error: "Nope" });
  expect(await run(async () => { throw new Error("prisma P2002 blah"); })).toEqual({ ok: false, error: "Something went wrong" });
});

test("run rethrows Next.js redirect errors", async () => {
  const redirectErr = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
  await expect(run(async () => { throw redirectErr; })).rejects.toBe(redirectErr);
});
