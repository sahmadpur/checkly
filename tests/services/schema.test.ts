import { expect, test } from "vitest";
import { db } from "@/lib/db";
import { makeOrg, makeUser, makeMember, makeProperty } from "@/tests/helpers/db";

test("deleting a property cascades to property members", async () => {
  const org = await makeOrg();
  const user = await makeUser();
  await makeMember(org.id, user.id, "WORKER");
  const prop = await makeProperty(org.id);
  await db.propertyMember.create({ data: { propertyId: prop.id, userId: user.id } });

  await db.property.delete({ where: { id: prop.id } });

  expect(await db.propertyMember.count()).toBe(0);
});

test("a user cannot be a member of the same org twice", async () => {
  const org = await makeOrg();
  const user = await makeUser();
  await makeMember(org.id, user.id, "WORKER");
  await expect(makeMember(org.id, user.id, "MANAGER")).rejects.toThrow();
});
