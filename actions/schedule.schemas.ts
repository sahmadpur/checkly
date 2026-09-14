import { z } from "zod";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const toUtcDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

export const scheduleSchema = z.object({
  templateId: z.string().min(1),
  assigneeIds: z.array(z.string().min(1)).min(1),
  freq: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
  dayOfMonth: z.number().int().min(1).max(31).nullable().default(null),
  dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  startsOn: ymd,
  endsOn: ymd.optional().or(z.literal("")),
}).transform((d) => ({ ...d, startsOn: toUtcDate(d.startsOn), endsOn: d.endsOn ? toUtcDate(d.endsOn) : null }));
export type ScheduleFormInput = z.input<typeof scheduleSchema>;
