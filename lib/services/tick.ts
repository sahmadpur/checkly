import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CATCHUP_DAYS, dueAtFor, fromUtcMidnight, localToday, occurrencesBetween, toUtcMidnight } from "@/lib/schedule";
import { buildCopy } from "@/lib/notifications/copy";
import { pushConfigured, sendPush } from "@/lib/notifications/push";
import { sendMail } from "@/lib/email";
import { notify } from "@/lib/services/notification";
import { createInstances } from "@/lib/services/instance";

const LOCK_KEY = 815_2026; // arbitrary constant for pg_advisory_lock
const scheduleInclude = { assignees: true, template: { select: { archivedAt: true } }, org: { select: { timezone: true } }, runs: { orderBy: { occurrenceDate: "desc" as const }, take: 1 } };
export type ScheduleWithRelations = Prisma.ScheduleGetPayload<{ include: typeof scheduleInclude }>;

export type TickResult = { skipped: true } | { generated: number; reminders: number; overdue: number; notified: number; errors: number; ms: number };

const addDaysLocal = (d: { y: number; m: number; d: number }, n: number) => fromUtcMidnight(new Date(toUtcMidnight(d).getTime() + n * 86400_000));

/** Creates instances for every missing occurrence up to local today. Returns instances created. */
export async function generateForSchedule(s: ScheduleWithRelations, now = new Date()) {
  if (s.pausedAt || s.template.archivedAt || s.assignees.length === 0) return 0;
  const tz = s.org.timezone;
  const today = localToday(tz, now);
  const startsOn = fromUtcMidnight(s.startsOn);
  if (toUtcMidnight(startsOn) > toUtcMidnight(today)) return 0;
  if (s.endsOn && toUtcMidnight(fromUtcMidnight(s.endsOn)) < toUtcMidnight(today)) return 0; // ended: no catch-up past the end
  const lastRun = s.runs[0] ? addDaysLocal(fromUtcMidnight(s.runs[0].occurrenceDate), 1) : startsOn;
  const cap = addDaysLocal(today, -(CATCHUP_DAYS - 1));
  const from = [lastRun, startsOn, cap].reduce((a, b) => (toUtcMidnight(a) > toUtcMidnight(b) ? a : b));
  const rule = { freq: s.freq, daysOfWeek: s.daysOfWeek, dayOfMonth: s.dayOfMonth, dueTime: s.dueTime, startsOn: s.startsOn, endsOn: s.endsOn };
  let created = 0;
  for (const d of occurrencesBetween(rule, from, today)) {
    const occurrenceDate = toUtcMidnight(d);
    const dueAt = dueAtFor(d, s.dueTime, tz);
    await db.$transaction(async (tx) => {
      const run = await tx.scheduleRun.createMany({ data: [{ scheduleId: s.id, occurrenceDate }], skipDuplicates: true });
      if (run.count === 0) return;
      const { ids } = await createInstances(
        { orgId: s.orgId, propertyId: s.propertyId, templateId: s.templateId, assigneeIds: s.assignees.map((a) => a.userId), dueAt, assignedById: s.createdById, scheduleId: s.id },
        tx
      );
      await tx.scheduleRun.update({ where: { scheduleId_occurrenceDate: { scheduleId: s.id, occurrenceDate } }, data: { instanceIds: ids } });
      created += ids.length;
    });
  }
  return created;
}

const eventSelect = { id: true, orgId: true, assigneeId: true, templateName: true, dueAt: true, property: { select: { name: true } }, org: { select: { timezone: true } } } as const;

export async function sendReminders(now = new Date()) {
  const rows = await db.checklistInstance.findMany({
    where: { status: { in: ["OPEN", "REJECTED"] }, remindedAt: null, dueAt: { gt: now, lte: new Date(now.getTime() + 60 * 60_000) } },
    select: eventSelect, take: 500,
  });
  let n = 0;
  for (const r of rows) {
    const claimed = await db.checklistInstance.updateMany({ where: { id: r.id, remindedAt: null }, data: { remindedAt: now } });
    if (claimed.count === 0) continue;
    const copy = buildCopy("DUE_SOON", { template: r.templateName, property: r.property.name, dueAt: r.dueAt, tz: r.org.timezone, instanceId: r.id });
    await notify([{ orgId: r.orgId, userId: r.assigneeId, type: "DUE_SOON", instanceId: r.id, ...copy }]);
    n++;
  }
  return n;
}

export async function markOverdue(now = new Date()) {
  const rows = await db.checklistInstance.findMany({
    where: { status: { in: ["OPEN", "REJECTED"] }, overdueNotifiedAt: null, dueAt: { lt: now } },
    select: eventSelect, take: 500,
  });
  let n = 0;
  for (const r of rows) {
    const claimed = await db.checklistInstance.updateMany({ where: { id: r.id, overdueNotifiedAt: null }, data: { overdueNotifiedAt: now } });
    if (claimed.count === 0) continue;
    const copy = buildCopy("OVERDUE", { template: r.templateName, property: r.property.name, dueAt: r.dueAt, tz: r.org.timezone, instanceId: r.id });
    await notify([{ orgId: r.orgId, userId: r.assigneeId, type: "OVERDUE", instanceId: r.id, ...copy }]);
    n++;
  }
  return n;
}

const MAX_ATTEMPTS = 3;

export async function drainOutbox(now = new Date()) {
  const rows = await db.notification.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - 24 * 3600_000) }, attempts: { lt: MAX_ATTEMPTS }, OR: [{ pushSentAt: null }, { emailSentAt: null }] },
    include: { user: { select: { email: true, notifyPush: true, notifyEmail: true, pushSubscriptions: true } } },
    orderBy: { createdAt: "asc" }, take: 200,
  });
  let delivered = 0;
  for (const n of rows) {
    const errors: string[] = [];
    let pushSentAt = n.pushSentAt;
    let emailSentAt = n.emailSentAt;
    if (!pushSentAt) {
      const subs = n.user.pushSubscriptions;
      if (!n.user.notifyPush || subs.length === 0 || !pushConfigured()) pushSentAt = now;
      else {
        let ok = true;
        for (const sub of subs) {
          try {
            const r = await sendPush(sub, { title: n.title, body: n.body, url: n.url, tag: n.id });
            if (r === "gone") await db.pushSubscription.delete({ where: { id: sub.id } });
            else await db.pushSubscription.update({ where: { id: sub.id }, data: { lastUsedAt: now } });
          } catch (e) { ok = false; errors.push(`push: ${(e as Error).message}`); }
        }
        if (ok) pushSentAt = now;
      }
    }
    if (!emailSentAt) {
      if (!n.user.notifyEmail || !n.user.email) emailSentAt = now;
      else {
        try {
          const link = `${process.env.APP_URL ?? ""}${n.url}`;
          await sendMail({ to: n.user.email, subject: n.title, html: `<p>${n.title}</p><p>${n.body}</p><p><a href="${link}">Open in Checkly</a></p>` });
          emailSentAt = now;
        } catch (e) { errors.push(`email: ${(e as Error).message}`); }
      }
    }
    const attempts = errors.length ? n.attempts + 1 : n.attempts;
    const giveUp = attempts >= MAX_ATTEMPTS;
    await db.notification.update({
      where: { id: n.id },
      data: { pushSentAt: pushSentAt ?? (giveUp ? now : null), emailSentAt: emailSentAt ?? (giveUp ? now : null), attempts, error: errors.length ? errors.join("; ").slice(0, 500) : n.error },
    });
    if (pushSentAt && emailSentAt) delivered++;
  }
  return delivered;
}

export async function runTick(now = new Date()): Promise<TickResult> {
  const started = Date.now();
  // pg_try_advisory_xact_lock is released at commit, so the lock lives exactly as long as this transaction.
  // The steps themselves use `db` (separate connections) so the long-running work is not inside the lock's transaction.
  return db.$transaction(
    async (tx) => {
      const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS locked`;
      if (!locked) return { skipped: true } as const;
      const result = { generated: 0, reminders: 0, overdue: 0, notified: 0, errors: 0, ms: 0 };
      const schedules = await db.schedule.findMany({ where: { pausedAt: null }, include: scheduleInclude });
      for (const s of schedules) {
        try { result.generated += await generateForSchedule(s, now); }
        catch (e) { result.errors++; console.error("tick: schedule", s.id, e); }
      }
      for (const [key, fn] of [["reminders", sendReminders], ["overdue", markOverdue], ["notified", drainOutbox]] as const) {
        try { result[key] += await fn(now); }
        catch (e) { result.errors++; console.error("tick:", key, e); }
      }
      result.ms = Date.now() - started;
      return result;
    },
    { timeout: 10 * 60_000, maxWait: 5_000 }
  );
}
