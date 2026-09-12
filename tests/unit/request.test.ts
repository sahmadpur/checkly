import { expect, test } from "vitest";
import { safeNext } from "@/lib/request";

test("safeNext restricts redirect targets to same-origin paths", () => {
  expect(safeNext(undefined)).toBe("/");
  expect(safeNext("/team")).toBe("/team");
  expect(safeNext("//evil.com")).toBe("/");
  expect(safeNext("https://evil.com")).toBe("/");
});
