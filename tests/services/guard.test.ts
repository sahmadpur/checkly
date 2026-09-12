import { describe, expect, test } from "vitest";
import { requireOrgRole, requirePropertyAccess, roleAtLeast } from "@/lib/auth/guard";
import { makeMember, makeOrg, makeProperty, makeUser } from "@/tests/helpers/db";
import { db } from "@/lib/db";

test("roleAtLeast ordering", () => {
  expect(roleAtLeast("OWNER", "WORKER")).toBe(true);
  expect(roleAtLeast("WORKER", "MANAGER")).toBe(false);
  expect(roleAtLeast("MANAGER", "MANAGER")).toBe(true);
});

describe("requireOrgRole", () => {
  test("returns role when sufficient, throws when not or when not a member", async () => {
    const org = await makeOrg();
    const mgr = await makeUser();
    const stranger = await makeUser();
    await makeMember(org.id, mgr.id, "MANAGER");

    await expect(requireOrgRole({ userId: mgr.id, orgId: org.id }, "WORKER")).resolves.toBe("MANAGER");
    await expect(requireOrgRole({ userId: mgr.id, orgId: org.id }, "OWNER")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requireOrgRole({ userId: stranger.id, orgId: org.id }, "WORKER")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("requirePropertyAccess", () => {
  test("owner sees any property in org; worker only assigned; other org never", async () => {
    const org = await makeOrg();
    const otherOrg = await makeOrg();
    const owner = await makeUser();
    const worker = await makeUser();
    await makeMember(org.id, owner.id, "OWNER");
    await makeMember(org.id, worker.id, "WORKER");
    const p1 = await makeProperty(org.id);
    const p2 = await makeProperty(org.id);
    const foreign = await makeProperty(otherOrg.id);
    await db.propertyMember.create({ data: { propertyId: p1.id, userId: worker.id } });

    await expect(requirePropertyAccess({ userId: owner.id, orgId: org.id }, p2.id)).resolves.toMatchObject({ id: p2.id });
    await expect(requirePropertyAccess({ userId: worker.id, orgId: org.id }, p1.id)).resolves.toMatchObject({ id: p1.id });
    await expect(requirePropertyAccess({ userId: worker.id, orgId: org.id }, p2.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(requirePropertyAccess({ userId: owner.id, orgId: org.id }, foreign.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
