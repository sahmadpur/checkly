import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { Ctx, requireOrgRole, roleAtLeast } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { normalizePhone } from "@/lib/auth/phone";
import { createToken, expiresIn, INVITE_TTL_MS, isExpired } from "@/lib/auth/token";
import { sendMail } from "@/lib/email";
import { forbidden, invalid } from "@/lib/errors";

export async function createInvite(ctx: Ctx, input: { email: string; role: Role; propertyIds: string[] }) {
  const myRole = await requireOrgRole(ctx, "MANAGER");
  if (!roleAtLeast(myRole, input.role)) throw forbidden("You cannot invite someone with a higher role than yours");
  const email = input.email.trim().toLowerCase();
  const propertyIds = [...new Set(input.propertyIds)];
  if (propertyIds.length) {
    const count = await db.property.count({ where: { id: { in: propertyIds }, orgId: ctx.orgId } });
    if (count !== propertyIds.length) throw invalid("One or more properties do not belong to this organization");
  }
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    const already = await db.orgMember.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: existing.id } } });
    if (already) throw invalid("That person is already a member");
  }
  const org = await db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
  const token = createToken();
  const invite = await db.invite.create({
    data: { orgId: ctx.orgId, email, role: input.role, propertyIds, token, expiresAt: expiresIn(INVITE_TTL_MS) },
  });
  const url = `${process.env.APP_URL}/invite/${token}`;
  await sendMail({
    to: email,
    subject: `You're invited to ${org.name} on Checkly`,
    html: `<p>You've been invited to join <b>${org.name}</b> as ${input.role.toLowerCase()}.</p><p><a href="${url}">${url}</a></p><p>This link expires in 7 days.</p>`,
  });
  return { id: invite.id };
}

export async function listInvites(ctx: Ctx) {
  await requireOrgRole(ctx, "MANAGER");
  const rows = await db.invite.findMany({
    where: { orgId: ctx.orgId, acceptedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, role: true, expiresAt: true, acceptedAt: true },
  });
  return rows;
}

export async function revokeInvite(ctx: Ctx, id: string) {
  await requireOrgRole(ctx, "MANAGER");
  await db.invite.deleteMany({ where: { id, orgId: ctx.orgId } });
}

async function loadValidInvite(token: string) {
  const inv = await db.invite.findUnique({ where: { token }, include: { org: { select: { name: true } } } });
  if (!inv || inv.acceptedAt || isExpired(inv.expiresAt)) return null;
  return inv;
}

export async function getInvite(token: string) {
  const inv = await loadValidInvite(token);
  if (!inv) return null;
  const existing = await db.user.findUnique({ where: { email: inv.email }, select: { id: true } });
  return { id: inv.id, orgName: inv.org.name, email: inv.email, role: inv.role, existingUser: !!existing };
}

export async function acceptInvite(
  token: string,
  opts: { userId: string } | { name: string; password: string; phone?: string }
) {
  const inv = await loadValidInvite(token);
  if (!inv) throw invalid("This invite is invalid or expired");
  const propertyIds = inv.propertyIds as string[];

  return db.$transaction(async (tx) => {
    let userId: string;
    if ("userId" in opts) {
      const user = await tx.user.findUniqueOrThrow({ where: { id: opts.userId }, select: { email: true } });
      if (user.email !== inv.email) throw forbidden("This invite was sent to a different email address");
      userId = opts.userId;
    } else {
      const existing = await tx.user.findUnique({ where: { email: inv.email }, select: { id: true } });
      if (existing) throw invalid("An account with this email already exists. Sign in to accept.");
      const phone = opts.phone?.trim() ? normalizePhone(opts.phone) : null;
      if (opts.phone?.trim() && !phone) throw invalid("Phone number is not valid");
      const user = await tx.user.create({
        data: { name: opts.name, email: inv.email, phone, passwordHash: await hashPassword(opts.password) },
      });
      userId = user.id;
    }
    await tx.orgMember.upsert({
      where: { orgId_userId: { orgId: inv.orgId, userId } },
      create: { orgId: inv.orgId, userId, role: inv.role },
      update: {},
    });
    if (propertyIds.length) {
      await tx.propertyMember.createMany({
        data: propertyIds.map((propertyId) => ({ propertyId, userId })),
        skipDuplicates: true,
      });
    }
    await tx.invite.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    return { userId, orgId: inv.orgId };
  });
}
