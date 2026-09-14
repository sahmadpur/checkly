import { db } from "@/lib/db";
import { InstanceStatus, ItemType, Role } from "@prisma/client";

export async function resetDb() {
  await db.$executeRawUnsafe(
    'TRUNCATE "InstanceItem","ChecklistInstance","TemplateItem","ChecklistTemplate","PasswordReset","Invite","PropertyMember","Property","OrgMember","User","Org" CASCADE'
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

export type ItemSeed = { type: ItemType; label: string; required?: boolean; options?: string[]; min?: number; max?: number };

export const defaultItems: ItemSeed[] = [
  { type: "CHECKBOX", label: "Beds made" },
  { type: "TEXT", label: "Notes", required: false },
  { type: "NUMBER", label: "Towels left", min: 0, max: 20 },
  { type: "SELECT", label: "Condition", options: ["Good", "Fair", "Poor"] },
  { type: "PHOTO", label: "Bathroom photo" },
];

export async function makeTemplate(orgId: string, items: ItemSeed[] = defaultItems, name = "Checkout clean") {
  return db.checklistTemplate.create({
    data: {
      orgId, name,
      items: { create: items.map((it, i) => ({ order: i, type: it.type, label: it.label, required: it.required ?? true, options: it.options ?? [], min: it.min ?? null, max: it.max ?? null })) },
    },
    include: { items: { orderBy: { order: "asc" } } },
  });
}

export async function makeInstance(input: {
  orgId: string; propertyId: string; assigneeId: string; assignedById: string;
  items?: ItemSeed[]; dueAt?: Date; status?: InstanceStatus; templateName?: string;
}) {
  const items = input.items ?? defaultItems;
  return db.checklistInstance.create({
    data: {
      orgId: input.orgId, propertyId: input.propertyId, assigneeId: input.assigneeId, assignedById: input.assignedById,
      templateName: input.templateName ?? "Checkout clean", dueAt: input.dueAt ?? new Date(Date.now() + 3600_000),
      status: input.status ?? "OPEN",
      items: { create: items.map((it, i) => ({ order: i, type: it.type, label: it.label, required: it.required ?? true, options: it.options ?? [], min: it.min ?? null, max: it.max ?? null })) },
    },
    include: { items: { orderBy: { order: "asc" } } },
  });
}
