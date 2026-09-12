import { expect, test } from "vitest";
import { signupSchema, loginSchema } from "@/actions/auth.schemas";
import { inviteSchema } from "@/actions/invite.schemas";

test("signup requires 8-char password and org name", () => {
  expect(signupSchema.safeParse({ name: "A", email: "a@b.co", password: "short", orgName: "X" }).success).toBe(false);
  expect(signupSchema.safeParse({ name: "A", email: "a@b.co", password: "longenough", orgName: "X" }).success).toBe(true);
});

test("login accepts any identifier", () => {
  expect(loginSchema.safeParse({ identifier: "+14155552671", password: "x" }).success).toBe(true);
});

test("invite role is restricted to the enum", () => {
  expect(inviteSchema.safeParse({ email: "a@b.co", role: "GOD", propertyIds: [] }).success).toBe(false);
  expect(inviteSchema.safeParse({ email: "a@b.co", role: "WORKER", propertyIds: ["p1"] }).success).toBe(true);
});
