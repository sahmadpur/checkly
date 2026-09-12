import { expect, test } from "vitest";
import { createToken, expiresIn, isExpired } from "@/lib/auth/token";

test("token is 64 hex chars and unique", () => {
  const a = createToken();
  const b = createToken();
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  expect(a).not.toBe(b);
});

test("expiry helpers", () => {
  expect(isExpired(expiresIn(60_000))).toBe(false);
  expect(isExpired(new Date(Date.now() - 1))).toBe(true);
});
