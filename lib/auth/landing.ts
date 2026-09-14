import { Role } from "@prisma/client";
import { db } from "@/lib/db";

/** Where a role lands after signing in. Workers get their own queue; everyone else the properties list. */
export const landingFor = (role?: Role | null) => (role === "WORKER" ? "/today" : "/");

/** Same first-org lookup the JWT uses for activeOrgId (lib/auth/config.ts). */
export async function landingForUser(userId: string) {
  const m = await db.orgMember.findFirst({ where: { userId }, orderBy: { createdAt: "asc" }, select: { role: true } });
  return landingFor(m?.role);
}
