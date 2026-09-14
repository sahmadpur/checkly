import { db } from "@/lib/db";
import { Ctx, requireOrgRole } from "@/lib/auth/guard";
import { forbidden, invalid } from "@/lib/errors";
import { isValidTimezone } from "@/lib/timezones";

/** Throws FORBIDDEN unless the user belongs to the org; otherwise returns the membership row. */
export async function assertMembership(userId: string, orgId: string) {
  const member = await db.orgMember.findUnique({ where: { orgId_userId: { orgId, userId } } });
  if (!member) throw forbidden();
  return member;
}

export async function listOrgsForUser(userId: string) {
  const rows = await db.orgMember.findMany({
    where: { userId },
    include: { org: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ id: r.org.id, name: r.org.name, role: r.role }));
}

export async function renameOrg(ctx: Ctx, name: string) {
  await requireOrgRole(ctx, "OWNER");
  await db.org.update({ where: { id: ctx.orgId }, data: { name } });
}

export async function setTimezone(ctx: Ctx, timezone: string) {
  await requireOrgRole(ctx, "OWNER");
  if (!isValidTimezone(timezone)) throw invalid("Unknown timezone");
  await db.org.update({ where: { id: ctx.orgId }, data: { timezone } });
}
