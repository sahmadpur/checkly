import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { CATCHUP_DAYS, dueAtFor, fromUtcMidnight, localToday, occurrencesBetween, toUtcMidnight } from "@/lib/schedule";
import { copyParams, renderStored } from "@/lib/notifications/copy";
import { translatorFor } from "@/lib/i18n";
import { pushConfigured, sendPush } from "@/lib/notifications/push";
import { escapeHtml, sendMail } from "@/lib/email";
import { notify } from "@/lib/services/notification";
import { createInstances } from "@/lib/services/instance";

const LOCK_KEY = 815_2026; // arbitrary constant for pg_advisory_lock
const scheduleInclude = { assignees: true, template: { select: { archivedAt: true } }, org: { select: { timezone: true } }, runs: { orderBy: { occurrenceDate: "desc" as const }, take: 1 } };
export type ScheduleWithRelations = Prisma.ScheduleGetPayload<{ include: typeof scheduleInclude }>;

export type TickResult = { skipped: true } | { generated: number; reminders: number; overdue: number; notified: number; errors: number; ms: number };

const addDaysLocal = (d: { y: number; m: number; d: number }, n: number) => fromUtcMidnight(new Date(toUtcMidnight(d).getTime() + n * 86400_000));
const fmtDate = (d: { y: number; m: number; d: number }) => toUtcMidnight(d).toISOString().slice(0, 10);

/** Creates instances for every missing occurrence up to local today. Returns instances created. */
export async function generateForSchedule(s: ScheduleWithRelations, now = new Date()) {
  if (s.pausedAt || s.template.archivedAt || s.assignees.length === 0) return 0;
  const tz = s.org.timezone;
  const today = localToday(tz, now);
  const startsOn = fromUtcMidnight(s.startsOn);
  if (toUtcMidnight(startsOn) > toUtcMidnight(today)) return 0;
  if (s.endsOn && toUtcMidnight(fromUtcMidnight(s.endsOn)) < toUtcMidnight(today)) return 0; // ended: no catch-up past the end
  // Assignees may have been removed from the property directly (bypassing the ScheduleAssignee
  // cleanup in member/property removal); only generate for those still on the property.
  const members = await db.propertyMember.findMany({ where: { propertyId: s.propertyId, userId: { in: s.assignees.map((a) => a.userId) } }, select: { userId: true } });
  const assigneeIds = members.map((m) => m.userId);
  if (assigneeIds.length === 0) {
    console.warn(`tick: schedule ${s.id} skipped: no assignees are still property members`);
    return 0;
  }
  const lastRun = s.runs[0] ? addDaysLocal(fromUtcMidnight(s.runs[0].occurrenceDate), 1) : startsOn;
  const cap = addDaysLocal(today, -(CATCHUP_DAYS - 1));
  const earliestMissing = toUtcMidnight(lastRun) > toUtcMidnight(startsOn) ? lastRun : startsOn;
  const from = toUtcMidnight(earliestMissing) > toUtcMidnight(cap) ? earliestMissing : cap;
  if (toUtcMidnight(from).getTime() > toUtcMidnight(earliestMissing).getTime()) {
    console.warn(`tick: schedule ${s.id} skipped catch-up occurrences ${fmtDate(earliestMissing)}..${fmtDate(addDaysLocal(from, -1))} (past the ${CATCHUP_DAYS}-day cap)`);
  }
  const rule = { freq: s.freq, daysOfWeek: s.daysOfWeek, dayOfMonth: s.dayOfMonth, dueTime: s.dueTime, startsOn: s.startsOn, endsOn: s.endsOn };
  let created = 0;
  for (const d of occurrencesBetween(rule, from, today)) {
    const occurrenceDate = toUtcMidnight(d);
    const dueAt = dueAtFor(d, s.dueTime, tz);
    await db.$transaction(async (tx) => {
      const run = await tx.scheduleRun.createMany({ data: [{ scheduleId: s.id, occurrenceDate }], skipDuplicates: true });
      if (run.count === 0) return;
      const { ids } = await createInstances(
        { orgId: s.orgId, propertyId: s.propertyId, templateId: s.templateId, assigneeIds, dueAt, assignedById: s.createdById, scheduleId: s.id },
        tx
      );
      // Catch-up backfill: occurrences whose due time already passed get the ASSIGNED
      // notification only — stamping them here keeps sendReminders/markOverdue from
      // firing a burst of DUE_SOON/OVERDUE for history nobody can act on.
      await tx.checklistInstance.updateMany({ where: { id: { in: ids }, dueAt: { lt: now } }, data: { overdueNotifiedAt: now, remindedAt: now } });
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
  let count = 0, errors = 0;
  for (const r of rows) {
    try {
      const claimed = await db.checklistInstance.updateMany({ where: { id: r.id, remindedAt: null }, data: { remindedAt: now } });
      if (claimed.count === 0) continue;
      await notify([{ orgId: r.orgId, userId: r.assigneeId, type: "DUE_SOON", instanceId: r.id, url: `/checklists/${r.id}`, params: copyParams({ template: r.templateName, property: r.property.name, dueAt: r.dueAt, tz: r.org.timezone }) }]);
      count++;
    } catch (e) {
      errors++;
      console.error("tick: sendReminders", r.id, e);
    }
  }
  return { count, errors };
}

export async function markOverdue(now = new Date()) {
  const rows = await db.checklistInstance.findMany({
    where: { status: { in: ["OPEN", "REJECTED"] }, overdueNotifiedAt: null, dueAt: { lt: now } },
    select: eventSelect, take: 500,
  });
  let count = 0, errors = 0;
  for (const r of rows) {
    try {
      const claimed = await db.checklistInstance.updateMany({ where: { id: r.id, overdueNotifiedAt: null }, data: { overdueNotifiedAt: now } });
      if (claimed.count === 0) continue;
      await notify([{ orgId: r.orgId, userId: r.assigneeId, type: "OVERDUE", instanceId: r.id, url: `/checklists/${r.id}`, params: copyParams({ template: r.templateName, property: r.property.name, dueAt: r.dueAt, tz: r.org.timezone }) }]);
      count++;
    } catch (e) {
      errors++;
      console.error("tick: markOverdue", r.id, e);
    }
  }
  return { count, errors };
}

const MAX_ATTEMPTS = 3;

export async function drainOutbox(now = new Date()) {
  const rows = await db.notification.findMany({
    where: { createdAt: { gte: new Date(now.getTime() - 24 * 3600_000) }, attempts: { lt: MAX_ATTEMPTS }, OR: [{ pushSentAt: null }, { emailSentAt: null }] },
    include: { user: { select: { email: true, locale: true, notifyPush: true, notifyEmail: true, pushSubscriptions: true } } },
    orderBy: { createdAt: "asc" }, take: 200,
  });
  let count = 0, errors = 0;
  for (const n of rows) {
    try {
      const msgs: string[] = [];
      const locale = n.user.locale ?? "en";
      const { title, body } = renderStored(n, locale);
      let pushSentAt = n.pushSentAt;
      let emailSentAt = n.emailSentAt;
      if (!pushSentAt) {
        const subs = n.user.pushSubscriptions;
        if (!n.user.notifyPush || subs.length === 0 || !pushConfigured()) pushSentAt = now;
        else {
          let ok = true;
          for (const sub of subs) {
            try {
              const r = await sendPush(sub, { title, body, url: n.url, tag: n.id });
              if (r === "gone") await db.pushSubscription.delete({ where: { id: sub.id } });
              else await db.pushSubscription.update({ where: { id: sub.id }, data: { lastUsedAt: now } });
            } catch (e) { ok = false; msgs.push(`push: ${(e as Error).message}`); }
          }
          if (ok) pushSentAt = now;
        }
      }
      if (!emailSentAt) {
        if (!n.user.notifyEmail || !n.user.email) emailSentAt = now;
        else {
          try {
            const link = escapeHtml(`${process.env.APP_URL ?? ""}${n.url}`);
            await sendMail({ to: n.user.email, subject: title, html: `<p>${escapeHtml(title)}</p><p>${escapeHtml(body)}</p><p><a href="${link}">${escapeHtml(translatorFor(locale, "email")("open"))}</a></p>` });
            emailSentAt = now;
          } catch (e) { msgs.push(`email: ${(e as Error).message}`); }
        }
      }
      const attempts = msgs.length ? n.attempts + 1 : n.attempts;
      const giveUp = attempts >= MAX_ATTEMPTS;
      await db.notification.update({
        where: { id: n.id },
        data: { pushSentAt: pushSentAt ?? (giveUp ? now : null), emailSentAt: emailSentAt ?? (giveUp ? now : null), attempts, error: msgs.length ? msgs.join("; ").slice(0, 500) : n.error },
      });
      if (pushSentAt && emailSentAt) count++;
    } catch (e) {
      errors++;
      console.error("tick: drainOutbox", n.id, e);
    }
  }
  return { count, errors };
}

export async function runTick(now = new Date()): Promise<TickResult> {
  const started = Date.now();
  const result = { generated: 0, reminders: 0, overdue: 0, notified: 0, errors: 0, ms: 0 };
  let skipped = false;
  try {
    // The transaction exists only to hold pg_try_advisory_xact_lock, which Postgres releases
    // when it ends. All the work below runs on `db` (separate connections), not on `tx`, so a
    // second tick is locked out for as long as this transaction is open — but if it were to hit
    // the 10-minute timeout the lock would be released while the work kept running. Theoretical
    // at current volumes; a session-level lock with an explicit unlock is the fix if it happens.
    await db.$transaction(
      async (tx) => {
        const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${LOCK_KEY}) AS locked`;
        if (!locked) { skipped = true; return; }
        const schedules = await db.schedule.findMany({ where: { pausedAt: null }, include: scheduleInclude });
        for (const s of schedules) {
          try { result.generated += await generateForSchedule(s, now); }
          catch (e) { result.errors++; console.error("tick: schedule", s.id, e); }
        }
        const steps = [["reminders", sendReminders], ["overdue", markOverdue], ["notified", drainOutbox]] as const;
        for (const [key, fn] of steps) {
          try {
            const r = await fn(now);
            result[key] += r.count;
            result.errors += r.errors;
          } catch (e) { result.errors++; console.error("tick:", key, e); }
        }
      },
      { timeout: 10 * 60_000, maxWait: 5_000 }
    );
  } catch (e) {
    // Commit or timeout failure of the lock transaction. The steps ran on `db` (separate connections),
    // so their work is already committed; only the lock is gone. Return the accumulated counts.
    result.errors++;
    console.error("tick: transaction failed", e);
  }
  if (skipped) return { skipped: true };
  result.ms = Date.now() - started;
  return result;
}
