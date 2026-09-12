import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth/config";
import { forbidden, notFound } from "@/lib/errors";

export type Ctx = { userId: string; orgId: string };

const RANK: Record<Role, number> = { OWNER: 3, MANAGER: 2, WORKER: 1 };

export const roleAtLeast = (actual: Role, min: Role) => RANK[actual] >= RANK[min];

export async function requireOrgRole(ctx: Ctx, min: Role): Promise<Role> {
  const m = await db.orgMember.findUnique({
    where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } },
    select: { role: true },
  });
  if (!m || !roleAtLeast(m.role, min)) throw forbidden();
  return m.role;
}

/** Owner: any property in the active org. Others: must have a PropertyMember row. Returns NOT_FOUND to avoid leaking existence. */
export async function requirePropertyAccess(ctx: Ctx, propertyId: string) {
  const role = await requireOrgRole(ctx, "WORKER");
  const property = await db.property.findFirst({
    where: {
      id: propertyId,
      orgId: ctx.orgId,
      ...(role === "OWNER" ? {} : { members: { some: { userId: ctx.userId } } }),
    },
    select: { id: true, orgId: true },
  });
  if (!property) throw notFound("Property not found");
  return property;
}

/** Reads the session. Redirects to /login when signed out. Throws FORBIDDEN when the user has no active org. */
export async function requireUser(): Promise<Ctx> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!session.activeOrgId) throw forbidden("No active organization");
  return { userId: session.user.id, orgId: session.activeOrgId };
}

/** Like requireUser but allows no active org (for settings and org switcher). */
export async function requireSignedIn(): Promise<{ userId: string; orgId: string | null }> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return { userId: session.user.id, orgId: session.activeOrgId };
}
