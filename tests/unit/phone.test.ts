import { expect, test } from "vitest";
import { normalizePhone } from "@/lib/auth/phone";

test("normalizes international numbers to E.164", () => {
  expect(normalizePhone("+1 (415) 555-2671")).toBe("+14155552671");
  expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
});

test("returns null for garbage", () => {
  expect(normalizePhone("hello")).toBeNull();
  expect(normalizePhone("")).toBeNull();
});
