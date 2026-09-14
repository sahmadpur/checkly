import { expect, test } from "vitest";
import { scheduleSchema } from "@/actions/schedule.schemas";
import { preferencesSchema, pushSubscriptionSchema } from "@/actions/notification.schemas";

test("schedule schema converts dates and defaults", () => {
  const r = scheduleSchema.safeParse({ templateId: "t", assigneeIds: ["u"], freq: "WEEKLY", daysOfWeek: [1, 3], dayOfMonth: null, dueTime: "09:00", startsOn: "2026-03-01", endsOn: "" });
  expect(r.success).toBe(true);
  if (r.success) { expect(r.data.startsOn.toISOString()).toBe("2026-03-01T00:00:00.000Z"); expect(r.data.endsOn).toBeNull(); }
  expect(scheduleSchema.safeParse({ templateId: "t", assigneeIds: [], freq: "DAILY", daysOfWeek: [], dayOfMonth: null, dueTime: "9:00", startsOn: "2026-03-01" }).success).toBe(false);
});

test("push subscription and preferences schemas", () => {
  expect(pushSubscriptionSchema.safeParse({ endpoint: "https://p/1", keys: { p256dh: "a", auth: "b" } }).success).toBe(true);
  expect(pushSubscriptionSchema.safeParse({ endpoint: "ftp://p/1", keys: { p256dh: "a", auth: "b" } }).success).toBe(false);
  expect(preferencesSchema.safeParse({ notifyPush: false }).success).toBe(true);
});
