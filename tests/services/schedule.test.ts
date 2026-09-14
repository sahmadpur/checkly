import { describe, expect, test } from "vitest";
import { db } from "@/lib/db";
import { createSchedule, deleteSchedule, getSchedule, listSchedules, pauseSchedule, resumeSchedule, updateSchedule, ScheduleInput } from "@/lib/services/schedule";
import { removeMember } from "@/lib/services/member";
import { removePropertyMember } from "@/lib/services/property";
import { makeMember, makeOrg, makeProperty, makeTemplate, makeUser } from "@/tests/helpers/db";

async function setup() {
  const org = await makeOrg();
  const owner = await makeUser({ name: "Owner" });
  const mgr = await makeUser({ name: "Mgr" });
  const w1 = await makeUser({ name: "W1" });
  const w2 = await makeUser({ name: "W2" });
  for (const [u, r] of [[owner, "OWNER"], [mgr, "MANAGER"], [w1, "WORKER"], [w2, "WORKER"]] as const) await makeMember(org.id, u.id, r);
  const prop = await makeProperty(org.id, "Villa");
  await db.propertyMember.createMany({ data: [mgr.id, w1.id, w2.id].map((userId) => ({ propertyId: prop.id, userId })) });
  const tpl = await makeTemplate(org.id);
  const ctx = (userId: string) => ({ userId, orgId: org.id });
  const base: ScheduleInput = { templateId: tpl.id, assigneeIds: [w1.id], freq: "WEEKLY", daysOfWeek: [1, 3], dayOfMonth: null, dueTime: "09:00", startsOn: new Date("2026-01-01T00:00:00Z"), endsOn: null };
  return { org, owner, mgr, w1, w2, prop, tpl, ctx, base };
}

describe("schedule CRUD", () => {
  test("create/list/get/update/pause/resume/delete; description and nextAt", async () => {
    const { mgr, w1, w2, prop, ctx, base } = await setup();
    const { id } = await createSchedule(ctx(mgr.id), prop.id, base);
    const [row] = await listSchedules(ctx(mgr.id), prop.id);
    expect(row).toMatchObject({ id, name: "Checkout clean", description: "Weekly on Mon, Wed at 09:00", templateArchived: false });
    expect(row.assignees.map((a) => a.userId)).toEqual([w1.id]);
    expect(row.nextAt).toBeInstanceOf(Date);
    await updateSchedule(ctx(mgr.id), id, { ...base, freq: "DAILY", daysOfWeek: [], assigneeIds: [w1.id, w2.id] });
    const g = await getSchedule(ctx(mgr.id), id);
    expect(g.description).toBe("Daily at 09:00");
    expect(g.assignees.map((a) => a.userId).sort()).toEqual([w1.id, w2.id].sort());
    await pauseSchedule(ctx(mgr.id), id);
    expect((await getSchedule(ctx(mgr.id), id)).pausedAt).not.toBeNull();
    await resumeSchedule(ctx(mgr.id), id);
    expect((await getSchedule(ctx(mgr.id), id)).pausedAt).toBeNull();
    expect(await deleteSchedule(ctx(mgr.id), id)).toEqual({ propertyId: prop.id });
    expect(await listSchedules(ctx(mgr.id), prop.id)).toEqual([]);
  });

  test("permissions: worker forbidden; manager without property access NOT_FOUND; cross-org NOT_FOUND", async () => {
    const { org, mgr, w1, prop, ctx, base } = await setup();
    const { id } = await createSchedule(ctx(mgr.id), prop.id, base);
    await expect(listSchedules(ctx(w1.id), prop.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const worker = ctx(w1.id);
    await expect(createSchedule(worker, prop.id, base)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateSchedule(worker, id, base)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(pauseSchedule(worker, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(resumeSchedule(worker, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deleteSchedule(worker, id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.schedule.count({ where: { id } })).toBe(1);
    const stranger = await makeUser();
    await makeMember(org.id, stranger.id, "MANAGER");
    await expect(getSchedule(ctx(stranger.id), id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const other = await makeOrg();
    const foreign = await makeUser();
    await makeMember(other.id, foreign.id, "OWNER");
    await expect(getSchedule({ userId: foreign.id, orgId: other.id }, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("validation", async () => {
    const { org, mgr, prop, ctx, base, tpl } = await setup();
    const c = ctx(mgr.id);
    await expect(createSchedule(c, prop.id, { ...base, daysOfWeek: [] })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createSchedule(c, prop.id, { ...base, daysOfWeek: [7] })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createSchedule(c, prop.id, { ...base, freq: "MONTHLY", daysOfWeek: [], dayOfMonth: 0 })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createSchedule(c, prop.id, { ...base, freq: "DAILY", daysOfWeek: [1] })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createSchedule(c, prop.id, { ...base, dueTime: "9:00" })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createSchedule(c, prop.id, { ...base, endsOn: new Date("2025-12-31T00:00:00Z") })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createSchedule(c, prop.id, { ...base, assigneeIds: [] })).rejects.toMatchObject({ code: "INVALID" });
    const outsider = await makeUser(); await makeMember(org.id, outsider.id, "WORKER");
    await expect(createSchedule(c, prop.id, { ...base, assigneeIds: [outsider.id] })).rejects.toMatchObject({ code: "INVALID" });
    await db.checklistTemplate.update({ where: { id: tpl.id }, data: { archivedAt: new Date() } });
    await expect(createSchedule(c, prop.id, base)).rejects.toMatchObject({ code: "INVALID" });
  });

  test("removing a member from the property or org drops their schedule assignments", async () => {
    const { owner, mgr, w1, w2, prop, ctx, base } = await setup();
    const { id } = await createSchedule(ctx(mgr.id), prop.id, { ...base, assigneeIds: [w1.id, w2.id] });
    await removePropertyMember(ctx(mgr.id), prop.id, w1.id);
    expect((await getSchedule(ctx(mgr.id), id)).assignees.map((a) => a.userId)).toEqual([w2.id]);
    await removeMember(ctx(owner.id), w2.id);
    expect((await getSchedule(ctx(mgr.id), id)).assignees).toEqual([]);
  });
});
