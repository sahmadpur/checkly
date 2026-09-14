import { describe, expect, test } from "vitest";
import { db } from "@/lib/db";
import { assign, getInstance, instanceCounts, isOverdue, listForProperty, listMine } from "@/lib/services/instance";
import { makeInstance, makeMember, makeOrg, makeProperty, makeTemplate, makeUser } from "@/tests/helpers/db";

export async function setup() {
  const org = await makeOrg();
  const owner = await makeUser({ name: "Owner" });
  const mgr = await makeUser({ name: "Mgr" });
  const w1 = await makeUser({ name: "W1" });
  const w2 = await makeUser({ name: "W2" });
  const outsider = await makeUser({ name: "Out" });
  await makeMember(org.id, owner.id, "OWNER");
  await makeMember(org.id, mgr.id, "MANAGER");
  await makeMember(org.id, w1.id, "WORKER");
  await makeMember(org.id, w2.id, "WORKER");
  await makeMember(org.id, outsider.id, "WORKER");
  const prop = await makeProperty(org.id, "Villa");
  await db.propertyMember.createMany({ data: [mgr.id, w1.id, w2.id].map((userId) => ({ propertyId: prop.id, userId })) });
  const tpl = await makeTemplate(org.id);
  const ctx = (userId: string) => ({ userId, orgId: org.id });
  const due = new Date(Date.now() + 3600_000);
  return { org, owner, mgr, w1, w2, outsider, prop, tpl, ctx, due };
}

describe("assign", () => {
  test("creates one instance per worker with frozen items", async () => {
    const { mgr, w1, w2, prop, tpl, ctx, due } = await setup();
    const { ids } = await assign(ctx(mgr.id), { templateId: tpl.id, propertyId: prop.id, assigneeIds: [w1.id, w2.id], dueAt: due });
    expect(ids).toHaveLength(2);
    const inst = await getInstance(ctx(w1.id), ids[0]);
    expect(inst.items.map((i) => [i.order, i.type, i.label, i.required])).toEqual(tpl.items.map((i) => [i.order, i.type, i.label, i.required]));
    expect(inst.templateName).toBe("Checkout clean");
    expect(inst.status).toBe("OPEN");
    // editing the template afterwards does not touch the instance
    await db.templateItem.deleteMany({ where: { templateId: tpl.id } });
    expect((await getInstance(ctx(w1.id), ids[0])).items).toHaveLength(5);
  });

  test("rejects non-member assignee, archived template, worker caller, manager without property access", async () => {
    const { org, mgr, w1, outsider, prop, tpl, ctx, due } = await setup();
    await expect(assign(ctx(mgr.id), { templateId: tpl.id, propertyId: prop.id, assigneeIds: [outsider.id], dueAt: due })).rejects.toMatchObject({ code: "INVALID" });
    await expect(assign(ctx(w1.id), { templateId: tpl.id, propertyId: prop.id, assigneeIds: [w1.id], dueAt: due })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await makeProperty(org.id, "Other");
    await expect(assign(ctx(mgr.id), { templateId: tpl.id, propertyId: other.id, assigneeIds: [w1.id], dueAt: due })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.checklistTemplate.update({ where: { id: tpl.id }, data: { archivedAt: new Date() } });
    await expect(assign(ctx(mgr.id), { templateId: tpl.id, propertyId: prop.id, assigneeIds: [w1.id], dueAt: due })).rejects.toMatchObject({ code: "INVALID" });
  });
});

describe("lists and access", () => {
  test("listMine shows only my instances; listForProperty needs property access; overdue filter", async () => {
    const { org, owner, mgr, w1, w2, prop, ctx } = await setup();
    const past = new Date(Date.now() - 3600_000);
    const a = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id, dueAt: past });
    await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w2.id, assignedById: mgr.id });
    expect((await listMine(ctx(w1.id))).map((i) => i.id)).toEqual([a.id]);
    expect((await listMine(ctx(w1.id)))[0].overdue).toBe(true);
    expect(await listForProperty(ctx(owner.id), prop.id)).toHaveLength(2);
    expect((await listForProperty(ctx(mgr.id), prop.id, { status: "OVERDUE" })).map((i) => i.id)).toEqual([a.id]);
    const stranger = await makeUser();
    await makeMember(org.id, stranger.id, "MANAGER");
    await expect(listForProperty(ctx(stranger.id), prop.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("getInstance: assignee and managers with access; others NOT_FOUND; canFill/canReview flags", async () => {
    const { org, mgr, w1, w2, prop, ctx } = await setup();
    const a = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id });
    expect((await getInstance(ctx(w1.id), a.id)).canFill).toBe(true);
    expect((await getInstance(ctx(mgr.id), a.id)).canFill).toBe(false);
    await expect(getInstance(ctx(w2.id), a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const otherOrg = await makeOrg();
    const foreign = await makeUser();
    await makeMember(otherOrg.id, foreign.id, "OWNER");
    await expect(getInstance({ userId: foreign.id, orgId: otherOrg.id }, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.checklistInstance.update({ where: { id: a.id }, data: { status: "SUBMITTED" } });
    expect((await getInstance(ctx(mgr.id), a.id)).canReview).toBe(true);
    expect((await getInstance(ctx(w1.id), a.id)).canFill).toBe(false);
  });

  test("listMine hides APPROVED older than 7 days; instanceCounts", async () => {
    const { org, mgr, w1, prop, ctx } = await setup();
    const old = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id, status: "APPROVED" });
    await db.checklistInstance.update({ where: { id: old.id }, data: { reviewedAt: new Date(Date.now() - 8 * 86400_000) } });
    const recent = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id, status: "APPROVED" });
    await db.checklistInstance.update({ where: { id: recent.id }, data: { reviewedAt: new Date() } });
    await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id, dueAt: new Date(Date.now() - 1000) });
    expect((await listMine(ctx(w1.id))).map((i) => i.id).sort()).toEqual([recent.id].concat((await db.checklistInstance.findMany({ where: { status: "OPEN" } })).map((i) => i.id)).sort());
    expect(await instanceCounts(ctx(mgr.id), [prop.id])).toEqual({ [prop.id]: { open: 1, overdue: 1 } });
  });
});

test("isOverdue", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  expect(isOverdue({ dueAt: new Date("2026-01-01T11:00:00Z"), status: "OPEN" }, now)).toBe(true);
  expect(isOverdue({ dueAt: new Date("2026-01-01T11:00:00Z"), status: "REJECTED" }, now)).toBe(true);
  expect(isOverdue({ dueAt: new Date("2026-01-01T11:00:00Z"), status: "SUBMITTED" }, now)).toBe(false);
  expect(isOverdue({ dueAt: new Date("2026-01-01T13:00:00Z"), status: "OPEN" }, now)).toBe(false);
});
