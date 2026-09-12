import { expect, test } from "vitest";
import { listOrgsForUser, renameOrg } from "@/lib/services/org";
import { makeMember, makeOrg, makeUser } from "@/tests/helpers/db";
import { db } from "@/lib/db";

test("listOrgsForUser returns orgs with role", async () => {
  const u = await makeUser();
  const a = await makeOrg("A");
  const b = await makeOrg("B");
  await makeMember(a.id, u.id, "OWNER");
  await makeMember(b.id, u.id, "WORKER");
  const orgs = await listOrgsForUser(u.id);
  expect(orgs.map((o) => [o.name, o.role])).toEqual([["A", "OWNER"], ["B", "WORKER"]]);
});

test("renameOrg requires OWNER", async () => {
  const u = await makeUser();
  const mgr = await makeUser();
  const org = await makeOrg("Old");
  await makeMember(org.id, u.id, "OWNER");
  await makeMember(org.id, mgr.id, "MANAGER");
  await expect(renameOrg({ userId: mgr.id, orgId: org.id }, "New")).rejects.toMatchObject({ code: "FORBIDDEN" });
  await renameOrg({ userId: u.id, orgId: org.id }, "New");
  expect((await db.org.findUniqueOrThrow({ where: { id: org.id } })).name).toBe("New");
});
