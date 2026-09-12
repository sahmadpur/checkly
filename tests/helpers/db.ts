import { db } from "@/lib/db";
import { Role } from "@prisma/client";

export async function resetDb() {
  await db.$executeRawUnsafe(
    'TRUNCATE "PasswordReset","Invite","PropertyMember","Property","OrgMember","User","Org" CASCADE'
  );
}

let counter = 0;
export function uniq(prefix = "x") {
  counter += 1;
  return `${prefix}${counter}-${Date.now()}`;
}

export async function makeUser(overrides: Partial<{ email: string; phone: string; name: string }> = {}) {
  return db.user.create({
    data: {
      email: overrides.email ?? `${uniq("u")}@test.local`,
      phone: overrides.phone,
      name: overrides.name ?? "Test User",
      passwordHash: "x",
    },
  });
}

export async function makeOrg(name = "Org") {
  return db.org.create({ data: { name } });
}

export async function makeMember(orgId: string, userId: string, role: Role) {
  return db.orgMember.create({ data: { orgId, userId, role } });
}

export async function makeProperty(orgId: string, name = "Prop") {
  return db.property.create({ data: { orgId, name } });
}
