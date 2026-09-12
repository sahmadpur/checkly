import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { Ctx, requireOrgRole } from "@/lib/auth/guard";
import { invalid, notFound } from "@/lib/errors";

export async function listMembers(ctx: Ctx) {
  await requireOrgRole(ctx, "WORKER");
  const rows = await db.orgMember.findMany({
    where: { orgId: ctx.orgId },
    include: {
      user: {
        select: {
          id: true, name: true, email: true, phone: true,
          propertyMembers: { where: { property: { orgId: ctx.orgId } }, select: { propertyId: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    phone: m.user.phone,
    role: m.role,
    propertyIds: m.user.propertyMembers.map((p) => p.propertyId),
  }));
}

async function assertNotLastOwner(orgId: string, userId: string) {
  const target = await db.orgMember.findUnique({ where: { orgId_userId: { orgId, userId } } });
  if (!target) throw notFound("Member not found");
  if (target.role !== "OWNER") return;
  const owners = await db.orgMember.count({ where: { orgId, role: "OWNER" } });
  if (owners <= 1) throw invalid("An organization must keep at least one owner");
}

export async function changeRole(ctx: Ctx, userId: string, role: Role) {
  await requireOrgRole(ctx, "OWNER");
  if (role !== "OWNER") await assertNotLastOwner(ctx.orgId, userId);
  await db.orgMember.update({ where: { orgId_userId: { orgId: ctx.orgId, userId } }, data: { role } });
}

export async function removeMember(ctx: Ctx, userId: string) {
  await requireOrgRole(ctx, "OWNER");
  await assertNotLastOwner(ctx.orgId, userId);
  await db.$transaction([
    db.propertyMember.deleteMany({ where: { userId, property: { orgId: ctx.orgId } } }),
    db.orgMember.delete({ where: { orgId_userId: { orgId: ctx.orgId, userId } } }),
  ]);
}
