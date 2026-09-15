import { db } from "@/lib/db";
import { Ctx, requireOrgRole, requirePropertyAccess } from "@/lib/auth/guard";
import { invalid } from "@/lib/errors";

type PropertyInput = { name: string; address?: string | null };

export async function listProperties(ctx: Ctx) {
  const role = await requireOrgRole(ctx, "WORKER");
  const rows = await db.property.findMany({
    where: { orgId: ctx.orgId, ...(role === "OWNER" ? {} : { members: { some: { userId: ctx.userId } } }) },
    orderBy: { name: "asc" },
    include: { _count: { select: { members: true } } },
  });
  return rows.map((p) => ({ id: p.id, name: p.name, address: p.address, memberCount: p._count.members }));
}

export async function getProperty(ctx: Ctx, id: string) {
  await requirePropertyAccess(ctx, id);
  const p = await db.property.findUniqueOrThrow({
    where: { id },
    include: {
      members: {
        include: { user: { select: { id: true, name: true, email: true, phone: true } } },
        orderBy: { user: { name: "asc" } },
      },
    },
  });
  return {
    id: p.id,
    name: p.name,
    address: p.address,
    members: p.members.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email, phone: m.user.phone })),
  };
}

export async function createProperty(ctx: Ctx, input: PropertyInput) {
  await requireOrgRole(ctx, "MANAGER");
  const p = await db.property.create({ data: { orgId: ctx.orgId, name: input.name, address: input.address ?? null } });
  // A manager who creates a property gets access to it automatically.
  await db.propertyMember.upsert({
    where: { propertyId_userId: { propertyId: p.id, userId: ctx.userId } },
    create: { propertyId: p.id, userId: ctx.userId },
    update: {},
  });
  return { id: p.id };
}

export async function updateProperty(ctx: Ctx, id: string, input: PropertyInput) {
  await requireOrgRole(ctx, "MANAGER");
  await requirePropertyAccess(ctx, id);
  await db.property.update({ where: { id }, data: { name: input.name, address: input.address ?? null } });
}

export async function deleteProperty(ctx: Ctx, id: string) {
  await requireOrgRole(ctx, "MANAGER");
  await requirePropertyAccess(ctx, id);
  await db.property.delete({ where: { id } });
}

export async function addPropertyMember(ctx: Ctx, propertyId: string, userId: string) {
  await requireOrgRole(ctx, "MANAGER");
  await requirePropertyAccess(ctx, propertyId);
  const isMember = await db.orgMember.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId } } });
  if (!isMember) throw invalid("userNotInOrg");
  await db.propertyMember.upsert({
    where: { propertyId_userId: { propertyId, userId } },
    create: { propertyId, userId },
    update: {},
  });
}

export async function removePropertyMember(ctx: Ctx, propertyId: string, userId: string) {
  await requireOrgRole(ctx, "MANAGER");
  await requirePropertyAccess(ctx, propertyId);
  await db.$transaction([
    db.scheduleAssignee.deleteMany({ where: { userId, schedule: { propertyId } } }),
    db.propertyMember.deleteMany({ where: { propertyId, userId } }),
  ]);
}
