import { expect, test } from "vitest";
import { db } from "@/lib/db";
import { makeMember, makeOrg, makeProperty, makeSchedule, makeTemplate, makeUser } from "@/tests/helpers/db";

test("deleting a schedule keeps instances (scheduleId null) and removes runs/assignees; run dates are unique", async () => {
  const org = await makeOrg();
  const mgr = await makeUser();
  const w = await makeUser();
  await makeMember(org.id, mgr.id, "MANAGER");
  await makeMember(org.id, w.id, "WORKER");
  const prop = await makeProperty(org.id);
  const tpl = await makeTemplate(org.id);
  const s = await makeSchedule({ orgId: org.id, propertyId: prop.id, templateId: tpl.id, createdById: mgr.id, assigneeIds: [w.id] });
  const inst = await db.checklistInstance.create({
    data: { orgId: org.id, propertyId: prop.id, templateName: "x", assigneeId: w.id, assignedById: mgr.id, dueAt: new Date(), scheduleId: s.id },
  });
  const day = new Date("2026-03-01T00:00:00Z");
  await db.scheduleRun.create({ data: { scheduleId: s.id, occurrenceDate: day } });
  await expect(db.scheduleRun.create({ data: { scheduleId: s.id, occurrenceDate: day } })).rejects.toThrow();
  await expect(db.checklistTemplate.delete({ where: { id: tpl.id } })).rejects.toThrow(); // Restrict
  await db.schedule.delete({ where: { id: s.id } });
  expect((await db.checklistInstance.findUniqueOrThrow({ where: { id: inst.id } })).scheduleId).toBeNull();
  expect(await db.scheduleRun.count()).toBe(0);
  expect(await db.scheduleAssignee.count()).toBe(0);
});

test("org timezone defaults to UTC; user notification flags default true", async () => {
  const org = await makeOrg();
  const u = await makeUser();
  expect(org.timezone).toBe("UTC");
  expect([u.notifyPush, u.notifyEmail]).toEqual([true, true]);
});
