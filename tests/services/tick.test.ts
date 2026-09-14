import { beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "@/lib/db";
import { makeInstance, makeMember, makeProperty, makeSchedule, makeTemplate, makeUser } from "@/tests/helpers/db";

vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn(async () => ({})), generateVAPIDKeys: vi.fn() } }));
import webpush from "web-push";
import * as email from "@/lib/email";
import { drainOutbox, generateForSchedule, markOverdue, runTick, sendReminders } from "@/lib/services/tick";
import { notify } from "@/lib/services/notification";

const send = webpush.sendNotification as unknown as ReturnType<typeof vi.fn>;

async function setup(tz = "UTC") {
  const org = await db.org.create({ data: { name: "O", timezone: tz } });
  const mgr = await makeUser({ name: "Mgr", email: "mgr@test.local" });
  const w = await makeUser({ name: "W", email: "w@test.local" });
  await makeMember(org.id, mgr.id, "MANAGER");
  await makeMember(org.id, w.id, "WORKER");
  const prop = await makeProperty(org.id, "Villa");
  await db.propertyMember.createMany({ data: [mgr.id, w.id].map((userId) => ({ propertyId: prop.id, userId })) });
  const tpl = await makeTemplate(org.id);
  return { org, mgr, w, prop, tpl };
}

beforeEach(() => { send.mockClear(); process.env.VAPID_PUBLIC_KEY = "pk"; process.env.VAPID_PRIVATE_KEY = "sk"; process.env.VAPID_SUBJECT = "mailto:t@test.local"; });

describe("generation", () => {
  test("daily schedule creates one instance per assignee per missing day, idempotently, capped to 14 days", async () => {
    const { org, mgr, w, prop, tpl } = await setup("Europe/Madrid");
    const s = await makeSchedule({ orgId: org.id, propertyId: prop.id, templateId: tpl.id, createdById: mgr.id, assigneeIds: [w.id], freq: "DAILY", dueTime: "09:00", startsOn: new Date("2026-01-01T00:00:00Z") });
    const full = await db.schedule.findUniqueOrThrow({ where: { id: s.id }, include: { assignees: true, template: { select: { archivedAt: true } }, org: { select: { timezone: true } }, runs: { orderBy: { occurrenceDate: "desc" }, take: 1 } } });
    const now = new Date("2026-03-10T12:00:00Z");
    expect(await generateForSchedule(full, now)).toBe(14); // Feb 25 .. Mar 10
    expect(await db.scheduleRun.count()).toBe(14);
    expect(await db.checklistInstance.count()).toBe(14);
    const today = await db.checklistInstance.findFirst({ where: { scheduleId: s.id }, orderBy: { dueAt: "desc" } });
    expect(today?.dueAt.toISOString()).toBe("2026-03-10T08:00:00.000Z"); // 09:00 Madrid (CET)
    expect(await db.notification.count({ where: { type: "ASSIGNED", userId: w.id } })).toBe(14);
    const again = await db.schedule.findUniqueOrThrow({ where: { id: s.id }, include: { assignees: true, template: { select: { archivedAt: true } }, org: { select: { timezone: true } }, runs: { orderBy: { occurrenceDate: "desc" }, take: 1 } } });
    expect(await generateForSchedule(again, now)).toBe(0);
    expect(await generateForSchedule(again, new Date("2026-03-11T12:00:00Z"))).toBe(1);
  });

  test("paused, ended, archived-template, and zero-assignee schedules generate nothing; backlog still generates", async () => {
    const { org, mgr, w, prop, tpl } = await setup();
    const now = new Date("2026-03-10T12:00:00Z");
    const load = (id: string) => db.schedule.findUniqueOrThrow({ where: { id }, include: { assignees: true, template: { select: { archivedAt: true } }, org: { select: { timezone: true } }, runs: { orderBy: { occurrenceDate: "desc" }, take: 1 } } });
    const paused = await makeSchedule({ orgId: org.id, propertyId: prop.id, templateId: tpl.id, createdById: mgr.id, assigneeIds: [w.id], startsOn: new Date("2026-03-09T00:00:00Z") });
    await db.schedule.update({ where: { id: paused.id }, data: { pausedAt: now } });
    expect(await generateForSchedule(await load(paused.id), now)).toBe(0);
    const ended = await makeSchedule({ orgId: org.id, propertyId: prop.id, templateId: tpl.id, createdById: mgr.id, assigneeIds: [w.id], startsOn: new Date("2026-03-01T00:00:00Z"), endsOn: new Date("2026-03-05T00:00:00Z") });
    expect(await generateForSchedule(await load(ended.id), now)).toBe(0);
    const none = await makeSchedule({ orgId: org.id, propertyId: prop.id, templateId: tpl.id, createdById: mgr.id, assigneeIds: [], startsOn: new Date("2026-03-09T00:00:00Z") });
    expect(await generateForSchedule(await load(none.id), now)).toBe(0);
    const ok = await makeSchedule({ orgId: org.id, propertyId: prop.id, templateId: tpl.id, createdById: mgr.id, assigneeIds: [w.id], startsOn: new Date("2026-03-09T00:00:00Z") });
    expect(await generateForSchedule(await load(ok.id), now)).toBe(2); // Mar 9 (still open) and Mar 10 both created
    await db.checklistTemplate.update({ where: { id: tpl.id }, data: { archivedAt: now } });
    expect(await generateForSchedule(await load(ok.id), new Date("2026-03-11T12:00:00Z"))).toBe(0);
  });

  test("assignee removed from the property directly is filtered out; the remaining assignee still gets an instance", async () => {
    const { org, mgr, w, prop, tpl } = await setup();
    const w2 = await makeUser({ name: "W2", email: "w2@test.local" });
    await makeMember(org.id, w2.id, "WORKER");
    await db.propertyMember.create({ data: { propertyId: prop.id, userId: w2.id } });
    const s = await makeSchedule({ orgId: org.id, propertyId: prop.id, templateId: tpl.id, createdById: mgr.id, assigneeIds: [w.id, w2.id], startsOn: new Date("2026-03-10T00:00:00Z") });
    // Removed directly via db, bypassing the ScheduleAssignee cleanup in removePropertyMember.
    await db.propertyMember.deleteMany({ where: { propertyId: prop.id, userId: w2.id } });
    const now = new Date("2026-03-10T12:00:00Z");
    const full = await db.schedule.findUniqueOrThrow({ where: { id: s.id }, include: { assignees: true, template: { select: { archivedAt: true } }, org: { select: { timezone: true } }, runs: { orderBy: { occurrenceDate: "desc" }, take: 1 } } });
    expect(await generateForSchedule(full, now)).toBe(1);
    const instances = await db.checklistInstance.findMany({ where: { scheduleId: s.id } });
    expect(instances).toHaveLength(1);
    expect(instances[0].assigneeId).toBe(w.id);
  });
});

describe("reminders and overdue", () => {
  test("DUE_SOON within 60 min once; OVERDUE after due once; SUBMITTED excluded", async () => {
    const { org, mgr, w, prop } = await setup();
    const now = new Date("2026-03-10T12:00:00Z");
    const soon = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w.id, assignedById: mgr.id, dueAt: new Date("2026-03-10T12:30:00Z") });
    await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w.id, assignedById: mgr.id, dueAt: new Date("2026-03-10T14:00:00Z") });
    const late = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w.id, assignedById: mgr.id, dueAt: new Date("2026-03-10T11:00:00Z") });
    await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w.id, assignedById: mgr.id, dueAt: new Date("2026-03-10T11:00:00Z"), status: "SUBMITTED" });
    expect((await sendReminders(now)).count).toBe(1);
    expect((await sendReminders(now)).count).toBe(0);
    expect((await db.checklistInstance.findUniqueOrThrow({ where: { id: soon.id } })).remindedAt).not.toBeNull();
    expect((await markOverdue(now)).count).toBe(1);
    expect((await markOverdue(now)).count).toBe(0);
    expect((await db.checklistInstance.findUniqueOrThrow({ where: { id: late.id } })).overdueNotifiedAt).not.toBeNull();
    expect(await db.notification.count({ where: { type: "DUE_SOON" } })).toBe(1);
    expect(await db.notification.count({ where: { type: "OVERDUE" } })).toBe(1);
  });
});

describe("drain", () => {
  test("push + email per preferences; gone subscription deleted; retries up to 3; old rows ignored", async () => {
    const { org, w } = await setup();
    const mail = vi.spyOn(email, "sendMail").mockResolvedValue();
    await db.pushSubscription.create({ data: { userId: w.id, endpoint: "https://p/1", p256dh: "a", auth: "b" } });
    await notify([{ orgId: org.id, userId: w.id, type: "ASSIGNED", title: "t", body: "b", url: "/checklists/x" }]);
    expect((await drainOutbox(new Date())).count).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(mail).toHaveBeenCalledTimes(1);
    let n = await db.notification.findFirstOrThrow();
    expect([n.pushSentAt, n.emailSentAt].every(Boolean)).toBe(true);

    // preferences off → stamped without sending
    await db.user.update({ where: { id: w.id }, data: { notifyPush: false, notifyEmail: false } });
    await notify([{ orgId: org.id, userId: w.id, type: "OVERDUE", title: "t", body: "b", url: "/x" }]);
    send.mockClear(); mail.mockClear();
    expect((await drainOutbox(new Date())).count).toBe(1);
    expect(send).not.toHaveBeenCalled(); expect(mail).not.toHaveBeenCalled();

    // gone subscription → deleted; failure → retry then give up
    await db.user.update({ where: { id: w.id }, data: { notifyPush: true, notifyEmail: false } });
    send.mockRejectedValueOnce(Object.assign(new Error("gone"), { statusCode: 410 }));
    await notify([{ orgId: org.id, userId: w.id, type: "APPROVED", title: "t", body: "b", url: "/x" }]);
    await drainOutbox(new Date());
    expect(await db.pushSubscription.count()).toBe(0);
    await db.pushSubscription.create({ data: { userId: w.id, endpoint: "https://p/2", p256dh: "a", auth: "b" } });
    send.mockRejectedValue(new Error("boom"));
    await notify([{ orgId: org.id, userId: w.id, type: "REJECTED", title: "t", body: "b", url: "/x" }]);
    for (let i = 0; i < 4; i++) await drainOutbox(new Date());
    n = await db.notification.findFirstOrThrow({ where: { type: "REJECTED" } });
    expect(n.attempts).toBe(3);
    expect(n.pushSentAt).not.toBeNull();
    expect(n.error).toContain("boom");
    send.mockResolvedValue({});

    // old rows are skipped
    await notify([{ orgId: org.id, userId: w.id, type: "ASSIGNED", title: "old", body: "", url: "/x" }]);
    await db.notification.updateMany({ where: { title: "old" }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    send.mockClear();
    await drainOutbox(new Date());
    expect(send).not.toHaveBeenCalled();
    mail.mockRestore();
  });
});

test("runTick composes steps and reports counts; second concurrent tick is skipped", async () => {
  const mail = vi.spyOn(email, "sendMail").mockResolvedValue();
  const { org, mgr, w, prop, tpl } = await setup();
  await makeSchedule({ orgId: org.id, propertyId: prop.id, templateId: tpl.id, createdById: mgr.id, assigneeIds: [w.id], freq: "DAILY", dueTime: "23:59", startsOn: new Date("2026-01-01T00:00:00Z") });
  const [a, b] = await Promise.all([runTick(new Date()), runTick(new Date())]);
  const results = [a, b];
  expect(results.filter((r) => "skipped" in r)).toHaveLength(1);
  const done = results.find((r) => !("skipped" in r))!;
  expect(done).toMatchObject({ generated: expect.any(Number), errors: 0 });
  expect((done as { generated: number }).generated).toBeGreaterThanOrEqual(1);
  mail.mockRestore();
});
