import { expect, test } from "vitest";
import { assertMembership, listOrgsForUser, renameOrg, setTimezone } from "@/lib/services/org";
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

test("assertMembership passes for a member and throws FORBIDDEN for a non-member", async () => {
  const member = await makeUser();
  const outsider = await makeUser();
  const org = await makeOrg("Acme");
  await makeMember(org.id, member.id, "WORKER");
  const row = await assertMembership(member.id, org.id);
  expect(row).toMatchObject({ orgId: org.id, userId: member.id, role: "WORKER" });
  await expect(assertMembership(outsider.id, org.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
});

test("setTimezone: owner only, must be valid", async () => {
  const u = await makeUser(); const mgr = await makeUser(); const org = await makeOrg();
  await makeMember(org.id, u.id, "OWNER"); await makeMember(org.id, mgr.id, "MANAGER");
  await expect(setTimezone({ userId: mgr.id, orgId: org.id }, "Europe/Madrid")).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(setTimezone({ userId: u.id, orgId: org.id }, "Nope/Nope")).rejects.toMatchObject({ code: "INVALID" });
  await setTimezone({ userId: u.id, orgId: org.id }, "Europe/Madrid");
  expect((await db.org.findUniqueOrThrow({ where: { id: org.id } })).timezone).toBe("Europe/Madrid");
});
