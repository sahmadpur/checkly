import { describe, expect, test } from "vitest";
import { db } from "@/lib/db";
import { answerItem, assign, createInstances, getInstance, instanceCounts, isOverdue, listForProperty, listMine, requestUpload, review, submit } from "@/lib/services/instance";
import { removeMember } from "@/lib/services/member";
import { mediaKey } from "@/lib/media";
import { putObject, storageConfigured } from "@/lib/storage";
import { makeInstance, makeMember, makeOrg, makeProperty, makeTemplate, makeUser } from "@/tests/helpers/db";

/** answerItem rejects a media key with no object behind it, so tests must upload first. */
const seedMedia = async (key: string) => {
  if (storageConfigured()) await putObject(key, Buffer.from("fake jpeg"), "image/jpeg");
};

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

  test("rejects more than 50 assignees", async () => {
    const { mgr, prop, tpl, ctx, due } = await setup();
    const ids = Array.from({ length: 51 }, (_, i) => `w${i}`);
    await expect(assign(ctx(mgr.id), { templateId: tpl.id, propertyId: prop.id, assigneeIds: ids, dueAt: due })).rejects.toMatchObject({ code: "INVALID" });
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

  test("workers see only their own instances in listForProperty and instanceCounts", async () => {
    const { org, mgr, w1, w2, prop, ctx } = await setup();
    const mine = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id, dueAt: new Date(Date.now() - 1000) });
    await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w2.id, assignedById: mgr.id });
    expect((await listForProperty(ctx(w1.id), prop.id)).map((i) => i.id)).toEqual([mine.id]);
    expect(await instanceCounts(ctx(w1.id), [prop.id])).toEqual({ [prop.id]: { open: 1, overdue: 1 } });
    expect(await instanceCounts(ctx(mgr.id), [prop.id])).toEqual({ [prop.id]: { open: 2, overdue: 1 } });
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

describe("answer, submit, review", () => {
  test("answer validation per type; only assignee; only OPEN/REJECTED", async () => {
    const { org, mgr, w1, w2, prop, ctx } = await setup();
    const inst = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id });
    const [cb, txt, num, sel, photo] = inst.items;
    await answerItem(ctx(w1.id), inst.id, cb.id, { type: "CHECKBOX", checked: true });
    await answerItem(ctx(w1.id), inst.id, num.id, { type: "NUMBER", number: 3 });
    await expect(answerItem(ctx(w1.id), inst.id, num.id, { type: "NUMBER", number: 21 })).rejects.toMatchObject({ code: "INVALID" });
    await expect(answerItem(ctx(w1.id), inst.id, sel.id, { type: "SELECT", choice: "Great" })).rejects.toMatchObject({ code: "INVALID" });
    await answerItem(ctx(w1.id), inst.id, sel.id, { type: "SELECT", choice: "Good" });
    await expect(answerItem(ctx(w1.id), inst.id, txt.id, { type: "NUMBER", number: 1 })).rejects.toMatchObject({ code: "INVALID" }); // type mismatch
    await expect(answerItem(ctx(w1.id), inst.id, photo.id, { type: "PHOTO", fileKey: "org/x/evil.jpg", fileType: "image/jpeg" })).rejects.toMatchObject({ code: "INVALID" });
    await expect(answerItem(ctx(w1.id), inst.id, photo.id, { type: "PHOTO", fileKey: `org/${org.id}/instances/${inst.id}/${photo.id}.jpg/../x`, fileType: "image/jpeg" })).rejects.toMatchObject({ code: "INVALID" });
    await expect(answerItem(ctx(w1.id), inst.id, photo.id, { type: "PHOTO", fileKey: `org/${org.id}/instances/${inst.id}/${photo.id}.jpg`, fileType: "image/png" })).rejects.toMatchObject({ code: "INVALID" });
    await seedMedia(`org/${org.id}/instances/${inst.id}/${photo.id}.jpg`);
    await answerItem(ctx(w1.id), inst.id, photo.id, { type: "PHOTO", fileKey: `org/${org.id}/instances/${inst.id}/${photo.id}.jpg`, fileType: "image/jpeg" });
    await expect(answerItem(ctx(w2.id), inst.id, cb.id, { type: "CHECKBOX", checked: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(answerItem(ctx(mgr.id), inst.id, cb.id, { type: "CHECKBOX", checked: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const strangerMgr = await makeUser();
    await makeMember(org.id, strangerMgr.id, "MANAGER");
    await expect(answerItem(ctx(strangerMgr.id), inst.id, cb.id, { type: "CHECKBOX", checked: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const d = await getInstance(ctx(w1.id), inst.id);
    expect(d.items.map((i) => i.answeredAt !== null)).toEqual([true, false, true, true, true]);
    await db.checklistInstance.update({ where: { id: inst.id }, data: { status: "SUBMITTED" } });
    await expect(answerItem(ctx(w1.id), inst.id, cb.id, { type: "CHECKBOX", checked: false })).rejects.toMatchObject({ code: "INVALID" });
  });

  test("submit requires required items; lists missing labels", async () => {
    const { org, mgr, w1, prop, ctx } = await setup();
    const inst = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id });
    await expect(submit(ctx(w1.id), inst.id)).rejects.toThrow("Missing: Beds made, Towels left, Condition, Bathroom photo");
    const [cb, , num, sel, photo] = inst.items;
    await answerItem(ctx(w1.id), inst.id, cb.id, { type: "CHECKBOX", checked: true });
    await answerItem(ctx(w1.id), inst.id, num.id, { type: "NUMBER", number: 3 });
    await answerItem(ctx(w1.id), inst.id, sel.id, { type: "SELECT", choice: "Good" });
    await seedMedia(`org/${org.id}/instances/${inst.id}/${photo.id}.jpg`);
    await answerItem(ctx(w1.id), inst.id, photo.id, { type: "PHOTO", fileKey: `org/${org.id}/instances/${inst.id}/${photo.id}.jpg`, fileType: "image/jpeg" });
    await submit(ctx(w1.id), inst.id);
    const d = await getInstance(ctx(w1.id), inst.id);
    expect(d.status).toBe("SUBMITTED");
    expect(d.submittedAt).not.toBeNull();
    await expect(submit(ctx(w1.id), inst.id)).rejects.toThrow("SUBMITTED");
  });

  test.skipIf(!storageConfigured())("a media answer needs the object to exist", async () => {
    const { org, mgr, w1, prop, ctx } = await setup();
    const inst = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id });
    const photo = inst.items[4];
    const key = `org/${org.id}/instances/${inst.id}/${photo.id}.jpg`;
    await expect(answerItem(ctx(w1.id), inst.id, photo.id, { type: "PHOTO", fileKey: key, fileType: "image/jpeg" })).rejects.toMatchObject({ code: "INVALID" });
    await seedMedia(key);
    await answerItem(ctx(w1.id), inst.id, photo.id, { type: "PHOTO", fileKey: key, fileType: "image/jpeg" });
    expect((await getInstance(ctx(w1.id), inst.id)).items[4].fileKey).toBe(key);
  });

  test("a racing second submit loses", async () => {
    const { org, mgr, w1, prop, ctx } = await setup();
    const inst = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id, items: [{ type: "CHECKBOX", label: "A" }] });
    await answerItem(ctx(w1.id), inst.id, inst.items[0].id, { type: "CHECKBOX", checked: true });
    const results = await Promise.allSettled([submit(ctx(w1.id), inst.id), submit(ctx(w1.id), inst.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const loser = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(loser.reason.message).toMatch(/already submitted|is SUBMITTED/);
  });

  test("review: reject reopens with comment; resubmit; approve is terminal; permissions", async () => {
    const { org, mgr, w1, w2, prop, ctx } = await setup();
    const inst = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id, status: "SUBMITTED", items: [{ type: "CHECKBOX", label: "A" }] });
    await db.instanceItem.update({ where: { id: inst.items[0].id }, data: { checked: true, answeredAt: new Date() } });
    await expect(review(ctx(w1.id), inst.id, "APPROVED")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(review(ctx(mgr.id), inst.id, "REJECTED", "  ")).rejects.toMatchObject({ code: "INVALID" });
    await review(ctx(mgr.id), inst.id, "REJECTED", "Redo the beds");
    let d = await getInstance(ctx(w1.id), inst.id);
    expect([d.status, d.reviewComment, d.reviewedByName, d.canFill]).toEqual(["REJECTED", "Redo the beds", "Mgr", true]);
    await answerItem(ctx(w1.id), inst.id, inst.items[0].id, { type: "CHECKBOX", checked: true });
    await submit(ctx(w1.id), inst.id);
    await review(ctx(mgr.id), inst.id, "APPROVED");
    d = await getInstance(ctx(mgr.id), inst.id);
    expect([d.status, d.canReview]).toEqual(["APPROVED", false]);
    await expect(review(ctx(mgr.id), inst.id, "REJECTED", "x")).rejects.toThrow("APPROVED");
    const stranger = await makeUser();
    await makeMember(org.id, stranger.id, "MANAGER");
    const inst2 = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w2.id, assignedById: mgr.id, status: "SUBMITTED" });
    await expect(review(ctx(stranger.id), inst2.id, "APPROVED")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("requestUpload", () => {
  const upload = { contentType: "image/jpeg", sizeBytes: 1000 };

  test("only the assignee of a fillable checklist, for a media item within the rules", async () => {
    const { org, mgr, w1, w2, prop, ctx } = await setup();
    const inst = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id });
    const [cb, , , , photo] = inst.items;
    const base = { instanceId: inst.id, itemId: photo.id, ...upload };
    // Managers can read the instance but not fill it.
    await expect(requestUpload(ctx(mgr.id), base)).rejects.toMatchObject({ code: "INVALID" });
    await expect(requestUpload(ctx(w2.id), base)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(requestUpload(ctx(w1.id), { ...base, sizeBytes: 6 * 1024 * 1024 })).rejects.toMatchObject({ code: "INVALID" });
    await expect(requestUpload(ctx(w1.id), { ...base, contentType: "text/plain" })).rejects.toMatchObject({ code: "INVALID" });
    await expect(requestUpload(ctx(w1.id), { ...base, itemId: cb.id })).rejects.toMatchObject({ code: "INVALID" });
    await db.checklistInstance.update({ where: { id: inst.id }, data: { status: "SUBMITTED" } });
    await expect(requestUpload(ctx(w1.id), base)).rejects.toThrow("cannot be edited");
  });

  test.skipIf(!storageConfigured())("returns the deterministic key and a presigned URL", async () => {
    const { org, mgr, w1, prop, ctx } = await setup();
    const inst = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id });
    const photo = inst.items[4];
    const { url, key } = await requestUpload(ctx(w1.id), { instanceId: inst.id, itemId: photo.id, ...upload });
    expect(key).toBe(mediaKey(org.id, inst.id, photo.id, "jpg"));
    expect(url).toContain(process.env.S3_BUCKET || "checkly");
    expect(url).toContain(key);
  });
});

describe("removeMember", () => {
  test("deletes OPEN and REJECTED instances, keeps SUBMITTED and APPROVED", async () => {
    const { org, owner, mgr, w1, prop, ctx } = await setup();
    for (const status of ["OPEN", "REJECTED", "SUBMITTED", "APPROVED"] as const) {
      await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id, status });
    }
    await removeMember(ctx(owner.id), w1.id);
    const left = await db.checklistInstance.findMany({ where: { assigneeId: w1.id }, select: { status: true } });
    expect(left.map((i) => i.status).sort()).toEqual(["APPROVED", "SUBMITTED"]);
  });
});

describe("notifications from instance events", () => {
  test("assign creates ASSIGNED for each assignee; submit notifies owner + property managers; review notifies the worker", async () => {
    const { org, owner, mgr, w1, w2, prop, tpl, ctx, due } = await setup();
    const { ids } = await assign(ctx(mgr.id), { templateId: tpl.id, propertyId: prop.id, assigneeIds: [w1.id, w2.id], dueAt: due });
    const assigned = await db.notification.findMany({ where: { type: "ASSIGNED" }, orderBy: { userId: "asc" } });
    expect(assigned.map((n) => n.userId).sort()).toEqual([w1.id, w2.id].sort());
    expect(assigned[0].url).toMatch(/^\/checklists\//);
    expect(assigned[0].title).toBe("New checklist: Checkout clean at Villa");

    const inst = await getInstance(ctx(w1.id), ids[0]);
    for (const it of inst.items.filter((i) => i.required)) {
      if (it.type === "CHECKBOX") await answerItem(ctx(w1.id), inst.id, it.id, { type: "CHECKBOX", checked: true });
      if (it.type === "NUMBER") await answerItem(ctx(w1.id), inst.id, it.id, { type: "NUMBER", number: 1 });
      if (it.type === "SELECT") await answerItem(ctx(w1.id), inst.id, it.id, { type: "SELECT", choice: "Good" });
      if (it.type === "PHOTO") { const key = mediaKey(org.id, inst.id, it.id, "jpg"); await seedMedia(key); await answerItem(ctx(w1.id), inst.id, it.id, { type: "PHOTO", fileKey: key, fileType: "image/jpeg" }); }
    }
    await submit(ctx(w1.id), inst.id);
    const submitted = await db.notification.findMany({ where: { type: "SUBMITTED" } });
    expect(submitted.map((n) => n.userId).sort()).toEqual([mgr.id, owner.id].sort());
    expect(submitted[0].title).toBe("W1 submitted Checkout clean at Villa");

    await review(ctx(mgr.id), inst.id, "REJECTED", "Redo");
    expect(await db.notification.findFirst({ where: { type: "REJECTED", userId: w1.id } })).toMatchObject({ body: "Redo" });
    await submit(ctx(w1.id), inst.id);
    await review(ctx(mgr.id), inst.id, "APPROVED");
    expect(await db.notification.count({ where: { type: "APPROVED", userId: w1.id } })).toBe(1);
  });

  test("createInstances (no ctx) validates template and membership and tags scheduleId", async () => {
    const { org, mgr, w1, outsider, prop, tpl, due } = await setup();
    await expect(createInstances({ orgId: org.id, propertyId: prop.id, templateId: tpl.id, assigneeIds: [outsider.id], dueAt: due, assignedById: mgr.id })).rejects.toMatchObject({ code: "INVALID" });
    const s = await db.schedule.create({ data: { orgId: org.id, propertyId: prop.id, templateId: tpl.id, createdById: mgr.id, name: "s", freq: "DAILY", dueTime: "09:00", startsOn: new Date() } });
    const { ids } = await createInstances({ orgId: org.id, propertyId: prop.id, templateId: tpl.id, assigneeIds: [w1.id], dueAt: due, assignedById: mgr.id, scheduleId: s.id });
    expect((await db.checklistInstance.findUniqueOrThrow({ where: { id: ids[0] } })).scheduleId).toBe(s.id);
  });
});
