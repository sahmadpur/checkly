import { Prisma, ScheduleFreq } from "@prisma/client";
import { db } from "@/lib/db";
import { Ctx, requireOrgRole, requirePropertyAccess } from "@/lib/auth/guard";
import { invalid, notFound } from "@/lib/errors";
import { describeRule, nextOccurrence } from "@/lib/schedule";

export type ScheduleInput = { templateId: string; assigneeIds: string[]; freq: ScheduleFreq; daysOfWeek: number[]; dayOfMonth: number | null; dueTime: string; startsOn: Date; endsOn: Date | null };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateRule(i: ScheduleInput) {
  if (i.freq === "WEEKLY") {
    const days = [...new Set(i.daysOfWeek)];
    if (days.length < 1 || days.length > 7 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) throw invalid("Pick at least one weekday");
    if (i.dayOfMonth != null) throw invalid("Weekly schedules cannot have a day of month");
  } else if (i.freq === "MONTHLY") {
    if (i.dayOfMonth == null || !Number.isInteger(i.dayOfMonth) || i.dayOfMonth < 1 || i.dayOfMonth > 31) throw invalid("Day of month must be 1–31");
    if (i.daysOfWeek.length) throw invalid("Monthly schedules cannot have weekdays");
  } else {
    if (i.daysOfWeek.length || i.dayOfMonth != null) throw invalid("Daily schedules take no weekdays or day of month");
  }
  if (!TIME.test(i.dueTime)) throw invalid("Due time must be HH:mm");
  if (i.endsOn && i.endsOn.getTime() < i.startsOn.getTime()) throw invalid("End date must be on or after the start date");
  if (i.assigneeIds.length === 0) throw invalid("Pick at least one worker");
}

const include = { assignees: { include: { user: { select: { name: true } } } }, template: { select: { archivedAt: true } }, org: { select: { timezone: true } } } satisfies Prisma.ScheduleInclude;

function toRow(s: Prisma.ScheduleGetPayload<{ include: typeof include }>) {
  const rule = { freq: s.freq, daysOfWeek: s.daysOfWeek, dayOfMonth: s.dayOfMonth, dueTime: s.dueTime, startsOn: s.startsOn, endsOn: s.endsOn };
  return {
    id: s.id, propertyId: s.propertyId, templateId: s.templateId, name: s.name, ...rule, pausedAt: s.pausedAt,
    assignees: s.assignees.map((a) => ({ userId: a.userId, name: a.user.name })),
    templateArchived: s.template.archivedAt !== null,
    description: describeRule(rule),
    nextAt: s.pausedAt ? null : nextOccurrence(rule, s.org.timezone),
  };
}
export type ScheduleRow = ReturnType<typeof toRow>;

/** MANAGER+ and property access; NOT_FOUND for anyone else. Returns the schedule with includes. */
async function loadForManager(ctx: Ctx, id: string) {
  await requireOrgRole(ctx, "MANAGER");
  const s = await db.schedule.findFirst({ where: { id, orgId: ctx.orgId }, include });
  if (!s) throw notFound("Schedule not found");
  await requirePropertyAccess(ctx, s.propertyId); // throws NOT_FOUND for managers without access
  return s;
}

async function assertInputs(ctx: Ctx, propertyId: string, input: ScheduleInput) {
  validateRule(input);
  const tpl = await db.checklistTemplate.findFirst({ where: { id: input.templateId, orgId: ctx.orgId }, select: { name: true, archivedAt: true } });
  if (!tpl) throw notFound("Template not found");
  if (tpl.archivedAt) throw invalid("Template is archived");
  const ids = [...new Set(input.assigneeIds)];
  const members = await db.propertyMember.count({ where: { propertyId, userId: { in: ids } } });
  if (members !== ids.length) throw invalid("Every assignee must be a member of this property");
  return { tpl, ids };
}

export async function listSchedules(ctx: Ctx, propertyId: string) {
  await requireOrgRole(ctx, "MANAGER");
  await requirePropertyAccess(ctx, propertyId);
  const rows = await db.schedule.findMany({ where: { orgId: ctx.orgId, propertyId }, include, orderBy: { createdAt: "asc" } });
  return rows.map(toRow);
}

export async function getSchedule(ctx: Ctx, id: string) {
  return toRow(await loadForManager(ctx, id));
}

export async function createSchedule(ctx: Ctx, propertyId: string, input: ScheduleInput) {
  await requireOrgRole(ctx, "MANAGER");
  await requirePropertyAccess(ctx, propertyId);
  const { tpl, ids } = await assertInputs(ctx, propertyId, input);
  const s = await db.schedule.create({
    data: {
      orgId: ctx.orgId, propertyId, templateId: input.templateId, createdById: ctx.userId, name: tpl.name,
      freq: input.freq, daysOfWeek: input.freq === "WEEKLY" ? [...new Set(input.daysOfWeek)] : [], dayOfMonth: input.freq === "MONTHLY" ? input.dayOfMonth : null,
      dueTime: input.dueTime, startsOn: input.startsOn, endsOn: input.endsOn,
      assignees: { create: ids.map((userId) => ({ userId })) },
    },
    select: { id: true },
  });
  return { id: s.id };
}

export async function updateSchedule(ctx: Ctx, id: string, input: ScheduleInput) {
  const s = await loadForManager(ctx, id);
  const { tpl, ids } = await assertInputs(ctx, s.propertyId, input);
  await db.$transaction([
    db.scheduleAssignee.deleteMany({ where: { scheduleId: id } }),
    db.schedule.update({
      where: { id },
      data: {
        templateId: input.templateId, name: tpl.name, freq: input.freq,
        daysOfWeek: input.freq === "WEEKLY" ? [...new Set(input.daysOfWeek)] : [], dayOfMonth: input.freq === "MONTHLY" ? input.dayOfMonth : null,
        dueTime: input.dueTime, startsOn: input.startsOn, endsOn: input.endsOn,
        assignees: { create: ids.map((userId) => ({ userId })) },
      },
    }),
  ]);
}

export async function pauseSchedule(ctx: Ctx, id: string) {
  await loadForManager(ctx, id);
  await db.schedule.update({ where: { id }, data: { pausedAt: new Date() } });
}

export async function resumeSchedule(ctx: Ctx, id: string) {
  await loadForManager(ctx, id);
  await db.schedule.update({ where: { id }, data: { pausedAt: null } });
}

export async function deleteSchedule(ctx: Ctx, id: string) {
  await loadForManager(ctx, id);
  await db.schedule.delete({ where: { id } });
}
