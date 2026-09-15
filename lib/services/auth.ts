import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { normalizePhone } from "@/lib/auth/phone";
import { createToken, expiresIn, isExpired, RESET_TTL_MS } from "@/lib/auth/token";
import { escapeHtml, sendMail } from "@/lib/email";
import { conflict, invalid, notFound } from "@/lib/errors";
import { isValidTimezone } from "@/lib/timezones";
import { isLocale, translatorFor } from "@/lib/i18n";

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

export async function signup(input: { name: string; email: string; phone?: string; password: string; orgName: string; timezone?: string; locale?: string }) {
  const phone = input.phone?.trim() ? normalizePhone(input.phone) : null;
  if (input.phone?.trim() && !phone) throw invalid("phoneInvalid");
  const timezone = input.timezone && isValidTimezone(input.timezone) ? input.timezone : "UTC";
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: input.name, email: input.email.trim().toLowerCase(), phone, passwordHash, locale: isLocale(input.locale) ? input.locale : null },
      });
      const org = await tx.org.create({ data: { name: input.orgName, timezone } });
      await tx.orgMember.create({ data: { orgId: org.id, userId: user.id, role: "OWNER" } });
      return { userId: user.id, orgId: org.id };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("accountExists");
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
  const t = translatorFor(user.locale ?? "en", "email.reset");
  await sendMail({
    to: user.email,
    subject: t("subject"),
    html: `<p>${escapeHtml(t("body"))}</p><p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
  });
}

export async function getPasswordReset(token: string) {
  const reset = await db.passwordReset.findUnique({ where: { token } });
  return !!reset && !reset.usedAt && !isExpired(reset.expiresAt);
}

export async function resetPassword(token: string, newPassword: string) {
  const reset = await db.passwordReset.findUnique({ where: { token } });
  if (!reset || reset.usedAt || isExpired(reset.expiresAt)) throw invalid("resetLinkInvalid");
  const passwordHash = await hashPassword(newPassword);
  await db.$transaction([
    db.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
    db.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
  ]);
}

export async function updateProfile(userId: string, input: { name: string; phone?: string }) {
  const phone = input.phone?.trim() ? normalizePhone(input.phone) : null;
  if (input.phone?.trim() && !phone) throw invalid("phoneInvalid");
  try {
    await db.user.update({ where: { id: userId }, data: { name: input.name, phone } });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("phoneInUse");
    throw e;
  }
}

export async function changePassword(userId: string, current: string, next: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw notFound("userNotFound");
  if (!(await verifyPassword(current, user.passwordHash))) throw invalid("currentPasswordIncorrect");
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
}
