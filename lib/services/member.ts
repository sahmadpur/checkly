import { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";
import { Ctx, requireOrgRole } from "@/lib/auth/guard";
import { invalid, notFound } from "@/lib/errors";

export async function listMembers(ctx: Ctx) {
  await requireOrgRole(ctx, "MANAGER");
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

async function assertNotLastOwner(tx: Prisma.TransactionClient, orgId: string, userId: string) {
  const target = await tx.orgMember.findUnique({ where: { orgId_userId: { orgId, userId } } });
  if (!target) throw notFound("Member not found");
  if (target.role !== "OWNER") return;
  const owners = await tx.orgMember.count({ where: { orgId, role: "OWNER" } });
  if (owners <= 1) throw invalid("An organization must keep at least one owner");
}

export async function changeRole(ctx: Ctx, userId: string, role: Role) {
  await requireOrgRole(ctx, "OWNER");
  await db.$transaction(
    async (tx) => {
      if (role !== "OWNER") await assertNotLastOwner(tx, ctx.orgId, userId);
      await tx.orgMember.update({ where: { orgId_userId: { orgId: ctx.orgId, userId } }, data: { role } });
    },
    { isolationLevel: "Serializable" }
  );
}

export async function removeMember(ctx: Ctx, userId: string) {
  await requireOrgRole(ctx, "OWNER");
  if (userId === ctx.userId) throw invalid("You cannot remove yourself");
  await db.$transaction(
    async (tx) => {
      await assertNotLastOwner(tx, ctx.orgId, userId);
      await tx.checklistInstance.deleteMany({ where: { orgId: ctx.orgId, assigneeId: userId, status: { in: ["OPEN", "REJECTED"] } } });
      await tx.propertyMember.deleteMany({ where: { userId, property: { orgId: ctx.orgId } } });
      await tx.orgMember.delete({ where: { orgId_userId: { orgId: ctx.orgId, userId } } });
    },
    { isolationLevel: "Serializable" }
  );
}
