import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { normalizePhone } from "@/lib/auth/phone";
import { createToken, expiresIn, isExpired, RESET_TTL_MS } from "@/lib/auth/token";
import { sendMail } from "@/lib/email";
import { conflict, invalid, notFound } from "@/lib/errors";
import { isValidTimezone } from "@/lib/timezones";

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export function parseIdentifier(identifier: string): { email: string } | { phone: string } | null {
  const v = identifier.trim();
  if (v.includes("@")) return { email: v.toLowerCase() };
  const phone = normalizePhone(v);
  return phone ? { phone } : null;
}

export async function findUserByIdentifier(identifier: string) {
  const where = parseIdentifier(identifier);
  if (!where) return null;
  return db.user.findUnique({ where });
}

export async function signup(input: { name: string; email: string; phone?: string; password: string; orgName: string; timezone?: string }) {
  const phone = input.phone?.trim() ? normalizePhone(input.phone) : null;
  if (input.phone?.trim() && !phone) throw invalid("Phone number is not valid");
  const timezone = input.timezone && isValidTimezone(input.timezone) ? input.timezone : "UTC";
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: input.name, email: input.email.trim().toLowerCase(), phone, passwordHash },
      });
      const org = await tx.org.create({ data: { name: input.orgName, timezone } });
      await tx.orgMember.create({ data: { orgId: org.id, userId: user.id, role: "OWNER" } });
      return { userId: user.id, orgId: org.id };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("An account with that email or phone already exists");
    throw e;
  }
}

export async function authenticate(identifier: string, password: string) {
  const user = await findUserByIdentifier(identifier);
  if (!user) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? { id: user.id, name: user.name } : null;
}

export async function requestPasswordReset(identifier: string) {
  const user = await findUserByIdentifier(identifier);
  if (!user?.email) return;
  const token = createToken();
  await db.passwordReset.create({ data: { userId: user.id, token, expiresAt: expiresIn(RESET_TTL_MS) } });
  const url = `${process.env.APP_URL}/reset/${token}`;
  await sendMail({
    to: user.email,
    subject: "Reset your Checkly password",
    html: `<p>Click to reset your password. The link expires in 1 hour.</p><p><a href="${url}">${url}</a></p>`,
  });
}

export async function getPasswordReset(token: string) {
  const reset = await db.passwordReset.findUnique({ where: { token } });
  return !!reset && !reset.usedAt && !isExpired(reset.expiresAt);
}

export async function resetPassword(token: string, newPassword: string) {
  const reset = await db.passwordReset.findUnique({ where: { token } });
  if (!reset || reset.usedAt || isExpired(reset.expiresAt)) throw invalid("This reset link is invalid or expired");
  const passwordHash = await hashPassword(newPassword);
  await db.$transaction([
    db.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
    db.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
  ]);
}

export async function updateProfile(userId: string, input: { name: string; phone?: string }) {
  const phone = input.phone?.trim() ? normalizePhone(input.phone) : null;
  if (input.phone?.trim() && !phone) throw invalid("Phone number is not valid");
  try {
    await db.user.update({ where: { id: userId }, data: { name: input.name, phone } });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("That phone number is already in use");
    throw e;
  }
}

export async function changePassword(userId: string, current: string, next: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("User not found");
  if (!(await verifyPassword(current, user.passwordHash))) throw invalid("Current password is incorrect");
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
}
