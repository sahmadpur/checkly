import { expect, test } from "vitest";
import { db } from "@/lib/db";
import { makeInstance, makeMember, makeOrg, makeProperty, makeTemplate, makeUser } from "@/tests/helpers/db";

test("deleting a template sets instance.templateId null and keeps templateName", async () => {
  const org = await makeOrg();
  const u = await makeUser();
  await makeMember(org.id, u.id, "OWNER");
  const prop = await makeProperty(org.id);
  const tpl = await makeTemplate(org.id);
  const inst = await db.checklistInstance.create({
    data: { orgId: org.id, propertyId: prop.id, templateId: tpl.id, templateName: tpl.name, assigneeId: u.id, assignedById: u.id, dueAt: new Date() },
  });
  await db.checklistTemplate.delete({ where: { id: tpl.id } });
  const after = await db.checklistInstance.findUniqueOrThrow({ where: { id: inst.id } });
  expect(after.templateId).toBeNull();
  expect(after.templateName).toBe("Checkout clean");
});

test("deleting a property cascades instances and items; deleting an assignee is blocked", async () => {
  const org = await makeOrg();
  const u = await makeUser();
  await makeMember(org.id, u.id, "OWNER");
  const prop = await makeProperty(org.id);
  await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: u.id, assignedById: u.id });
  await expect(db.user.delete({ where: { id: u.id } })).rejects.toThrow();
  await db.property.delete({ where: { id: prop.id } });
  expect(await db.checklistInstance.count()).toBe(0);
  expect(await db.instanceItem.count()).toBe(0);
});
