import { describe, expect, test } from "vitest";
import {
  addPropertyMember, createProperty, deleteProperty, getProperty, listProperties, removePropertyMember, updateProperty,
} from "@/lib/services/property";
import { makeMember, makeOrg, makeUser } from "@/tests/helpers/db";
import { db } from "@/lib/db";

async function setup() {
  const org = await makeOrg();
  const owner = await makeUser({ name: "Owner" });
  const mgr = await makeUser({ name: "Mgr" });
  const worker = await makeUser({ name: "Worker" });
  await makeMember(org.id, owner.id, "OWNER");
  await makeMember(org.id, mgr.id, "MANAGER");
  await makeMember(org.id, worker.id, "WORKER");
  const ctx = (userId: string) => ({ userId, orgId: org.id });
  return { org, owner, mgr, worker, ctx };
}

describe("property CRUD", () => {
  test("manager creates, updates, deletes; worker cannot", async () => {
    const { mgr, worker, ctx } = await setup();
    const { id } = await createProperty(ctx(mgr.id), { name: "Villa", address: "1 Sea Rd" });
    await expect(createProperty(ctx(worker.id), { name: "X" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await updateProperty(ctx(mgr.id), id, { name: "Villa 2" });
    expect((await getProperty(ctx(mgr.id), id)).name).toBe("Villa 2");

    await deleteProperty(ctx(mgr.id), id);
    await expect(getProperty(ctx(mgr.id), id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("listProperties: owner sees all, worker sees only assigned", async () => {
    const { owner, mgr, worker, ctx } = await setup();
    const a = await createProperty(ctx(mgr.id), { name: "A" });
    await createProperty(ctx(mgr.id), { name: "B" });
    await addPropertyMember(ctx(mgr.id), a.id, worker.id);

    expect((await listProperties(ctx(owner.id))).map((p) => p.name)).toEqual(["A", "B"]);
    expect((await listProperties(ctx(worker.id))).map((p) => p.name)).toEqual(["A"]);
    // The creating manager is auto-added as a member of each property they create
    expect((await listProperties(ctx(mgr.id))).map((p) => p.name)).toEqual(["A", "B"]);
  });

  test("property members: add requires org membership, remove works", async () => {
    const { mgr, worker, ctx } = await setup();
    const stranger = await makeUser();
    const { id } = await createProperty(ctx(mgr.id), { name: "A" });
    await expect(addPropertyMember(ctx(mgr.id), id, stranger.id)).rejects.toMatchObject({ code: "INVALID" });
    await addPropertyMember(ctx(mgr.id), id, worker.id);
    await addPropertyMember(ctx(mgr.id), id, worker.id); // idempotent
    // The creating manager is auto-added as a member (see listProperties test), so both appear.
    expect((await getProperty(ctx(mgr.id), id)).members.map((m) => m.userId)).toEqual([mgr.id, worker.id]);
    await removePropertyMember(ctx(mgr.id), id, worker.id);
    expect(await db.propertyMember.count()).toBe(1);
  });
});
