import { db } from "@/lib/db";
import { Ctx, requireOrgRole } from "@/lib/auth/guard";

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
