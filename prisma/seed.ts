import "dotenv/config";
import { db } from "../lib/db";
import { hashPassword } from "../lib/auth/password";

async function main() {
  const passwordHash = await hashPassword("password123");
  const org = await db.org.create({ data: { name: "Seaside Rentals" } });
  const mk = (name: string, email: string, phone?: string) =>
    db.user.upsert({ where: { email }, update: {}, create: { name, email, phone, passwordHash } });
  const owner = await mk("Olivia Owner", "owner@example.com", "+14155550100");
  const manager = await mk("Max Manager", "manager@example.com");
  const w1 = await mk("Wendy Worker", "wendy@example.com", "+14155550101");
  const w2 = await mk("Walt Worker", "walt@example.com");
  await db.orgMember.createMany({ data: [
    { orgId: org.id, userId: owner.id, role: "OWNER" },
    { orgId: org.id, userId: manager.id, role: "MANAGER" },
    { orgId: org.id, userId: w1.id, role: "WORKER" },
    { orgId: org.id, userId: w2.id, role: "WORKER" },
  ] });
  const villa = await db.property.create({ data: { orgId: org.id, name: "Villa Azul", address: "12 Ocean Dr" } });
  const loft = await db.property.create({ data: { orgId: org.id, name: "Harbor Loft", address: "3 Pier St" } });
  await db.propertyMember.createMany({ data: [
    { propertyId: villa.id, userId: manager.id },
    { propertyId: loft.id, userId: manager.id },
    { propertyId: villa.id, userId: w1.id },
    { propertyId: loft.id, userId: w2.id },
  ] });
  console.log("Seeded. Login: owner@example.com / password123 (also manager@, wendy@, walt@)");
}

main().finally(() => db.$disconnect());
