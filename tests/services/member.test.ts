import { expect, test } from "vitest";
import { changeRole, listMembers, removeMember } from "@/lib/services/member";
import { makeMember, makeOrg, makeProperty, makeUser } from "@/tests/helpers/db";
import { db } from "@/lib/db";

async function setup() {
  const org = await makeOrg();
  const owner = await makeUser({ name: "Owner" });
  const worker = await makeUser({ name: "Worker" });
  await makeMember(org.id, owner.id, "OWNER");
  await makeMember(org.id, worker.id, "WORKER");
  const ctx = (userId: string) => ({ userId, orgId: org.id });
  return { org, owner, worker, ctx };
}

test("listMembers includes property ids scoped to this org", async () => {
  const { org, owner, worker, ctx } = await setup();
  const p = await makeProperty(org.id);
  const other = await makeOrg();
  const foreignProp = await makeProperty(other.id);
  await db.propertyMember.createMany({ data: [
    { propertyId: p.id, userId: worker.id },
    { propertyId: foreignProp.id, userId: worker.id },
  ] });
  const rows = await listMembers(ctx(owner.id));
  expect(rows.find((r) => r.userId === worker.id)?.propertyIds).toEqual([p.id]);
});

test("changeRole: owner only, cannot demote last owner", async () => {
  const { owner, worker, ctx } = await setup();
  await expect(changeRole(ctx(worker.id), owner.id, "WORKER")).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(changeRole(ctx(owner.id), owner.id, "MANAGER")).rejects.toMatchObject({ code: "INVALID" });
  await changeRole(ctx(owner.id), worker.id, "OWNER");
  await changeRole(ctx(owner.id), owner.id, "MANAGER"); // now allowed, another owner exists
});

test("removeMember: cannot remove last owner, cleans property memberships", async () => {
  const { org, owner, worker, ctx } = await setup();
  const p = await makeProperty(org.id);
  await db.propertyMember.create({ data: { propertyId: p.id, userId: worker.id } });
  await expect(removeMember(ctx(owner.id), owner.id)).rejects.toMatchObject({ code: "INVALID" });
  await removeMember(ctx(owner.id), worker.id);
  expect(await db.orgMember.count({ where: { orgId: org.id } })).toBe(1);
  expect(await db.propertyMember.count()).toBe(0);
});

test("removeMember: owner cannot remove themselves even when another owner exists", async () => {
  const { org, owner, ctx } = await setup();
  const owner2 = await makeUser({ name: "Owner2" });
  await makeMember(org.id, owner2.id, "OWNER");
  await expect(removeMember(ctx(owner.id), owner.id)).rejects.toMatchObject({ code: "INVALID" });
  expect(await db.orgMember.count({ where: { orgId: org.id, userId: owner.id } })).toBe(1);
});

test("removeMember: concurrent removal of two owners cannot both succeed (atomic guard)", async () => {
  const { org, owner, ctx } = await setup();
  const owner2 = await makeUser({ name: "Owner2" });
  await makeMember(org.id, owner2.id, "OWNER");

  const results = await Promise.allSettled([
    removeMember(ctx(owner.id), owner2.id),
    removeMember(ctx(owner2.id), owner.id),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled").length;
  expect(fulfilled).toBeLessThan(2); // at least one must lose the race
  const remainingOwners = await db.orgMember.count({ where: { orgId: org.id, role: "OWNER" } });
  expect(remainingOwners).toBeGreaterThanOrEqual(1);
});
