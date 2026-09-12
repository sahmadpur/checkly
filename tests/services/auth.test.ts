import { describe, expect, test, vi } from "vitest";
import { db } from "@/lib/db";
import * as email from "@/lib/email";
import { authenticate, changePassword, requestPasswordReset, resetPassword, signup, updateProfile } from "@/lib/services/auth";

describe("signup", () => {
  test("creates user, org, and owner membership", async () => {
    const { userId, orgId } = await signup({
      name: "Ana", email: "ana@test.local", phone: "+14155552671", password: "secret123", orgName: "Ana Co",
    });
    const member = await db.orgMember.findUniqueOrThrow({ where: { orgId_userId: { orgId, userId } } });
    expect(member.role).toBe("OWNER");
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.phone).toBe("+14155552671");
    expect(user.passwordHash).not.toBe("secret123");
  });

  test("rejects duplicate email with CONFLICT", async () => {
    await signup({ name: "A", email: "dup@test.local", password: "secret123", orgName: "X" });
    await expect(signup({ name: "B", email: "dup@test.local", password: "secret123", orgName: "Y" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("rejects invalid phone with INVALID", async () => {
    await expect(signup({ name: "A", email: "p@test.local", phone: "12", password: "secret123", orgName: "X" }))
      .rejects.toMatchObject({ code: "INVALID" });
  });
});

describe("authenticate", () => {
  test("works with email, with phone, and rejects bad password", async () => {
    await signup({ name: "Ana", email: "ana@test.local", phone: "+1 415 555 2671", password: "secret123", orgName: "X" });
    expect(await authenticate("ana@test.local", "secret123")).toMatchObject({ name: "Ana" });
    expect(await authenticate("+14155552671", "secret123")).toMatchObject({ name: "Ana" });
    expect(await authenticate("ana@test.local", "wrong")).toBeNull();
    expect(await authenticate("nobody@test.local", "secret123")).toBeNull();
  });
});

describe("password reset", () => {
  test("sends a link, resets once, second use fails", async () => {
    const spy = vi.spyOn(email, "sendMail").mockResolvedValue();
    await signup({ name: "Ana", email: "ana@test.local", password: "secret123", orgName: "X" });
    await requestPasswordReset("ana@test.local");
    expect(spy).toHaveBeenCalledTimes(1);
    const html: string = spy.mock.calls[0][0].html;
    const prefix = `${process.env.APP_URL}/reset/`;
    expect(html).toContain(prefix);
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const token = html.match(new RegExp(`${escapedPrefix}([0-9a-f]{64})`))![1];

    await resetPassword(token, "newpass456");
    expect(await authenticate("ana@test.local", "newpass456")).not.toBeNull();
    await expect(resetPassword(token, "again789")).rejects.toMatchObject({ code: "INVALID" });
    spy.mockRestore();
  });

  test("unknown identifier resolves silently and sends nothing", async () => {
    const spy = vi.spyOn(email, "sendMail").mockResolvedValue();
    await expect(requestPasswordReset("ghost@test.local")).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

test("changePassword requires the current password", async () => {
  const { userId } = await signup({ name: "Ana", email: "ana@test.local", password: "secret123", orgName: "X" });
  await expect(changePassword(userId, "wrong", "newpass456")).rejects.toMatchObject({ code: "INVALID" });
  await changePassword(userId, "secret123", "newpass456");
  expect(await authenticate("ana@test.local", "newpass456")).not.toBeNull();
});

describe("updateProfile", () => {
  test("updates name and phone", async () => {
    const { userId } = await signup({ name: "Ana", email: "ana@test.local", password: "secret123", orgName: "X" });
    await updateProfile(userId, { name: "Ana B", phone: "+14155552671" });
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.name).toBe("Ana B");
    expect(user.phone).toBe("+14155552671");
  });

  test("rejects invalid phone with INVALID", async () => {
    const { userId } = await signup({ name: "Ana", email: "ana@test.local", password: "secret123", orgName: "X" });
    await expect(updateProfile(userId, { name: "Ana", phone: "12" })).rejects.toMatchObject({ code: "INVALID" });
  });

  test("rejects a phone already in use by another user with CONFLICT", async () => {
    await signup({ name: "Bo", email: "bo@test.local", phone: "+14155552671", password: "secret123", orgName: "Y" });
    const { userId } = await signup({ name: "Ana", email: "ana@test.local", password: "secret123", orgName: "X" });
    await expect(updateProfile(userId, { name: "Ana", phone: "+14155552671" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });
});
