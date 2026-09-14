import { ScheduleFreq } from "@prisma/client";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

export const CATCHUP_DAYS = 14;

export type Rule = { freq: ScheduleFreq; daysOfWeek: number[]; dayOfMonth: number | null; dueTime: string; startsOn: Date; endsOn: Date | null };
export type LocalDate = { y: number; m: number; d: number };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const toUtcMidnight = (d: LocalDate) => new Date(Date.UTC(d.y, d.m - 1, d.d));
export const fromUtcMidnight = (date: Date): LocalDate => ({ y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() });
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (d: LocalDate, n: number) => fromUtcMidnight(new Date(toUtcMidnight(d).getTime() + n * 86400_000));
const cmp = (a: LocalDate, b: LocalDate) => toUtcMidnight(a).getTime() - toUtcMidnight(b).getTime();

/** Calendar date "today" in the given IANA timezone. */
export function localToday(tz: string, now = new Date()): LocalDate {
  const z = toZonedTime(now, tz);
  return { y: z.getFullYear(), m: z.getMonth() + 1, d: z.getDate() };
}

export function matches(rule: Rule, d: LocalDate): boolean {
  switch (rule.freq) {
    case "DAILY": return true;
    case "WEEKLY": return rule.daysOfWeek.includes(toUtcMidnight(d).getUTCDay());
    case "MONTHLY": return d.d === Math.min(rule.dayOfMonth ?? 1, daysInMonth(d.y, d.m));
  }
}

export function occurrencesBetween(rule: Rule, from: LocalDate, to: LocalDate): LocalDate[] {
  const start = fromUtcMidnight(rule.startsOn);
  const end = rule.endsOn ? fromUtcMidnight(rule.endsOn) : null;
  let cur = cmp(from, start) < 0 ? start : from;
  const last = end && cmp(end, to) < 0 ? end : to;
  const out: LocalDate[] = [];
  while (cmp(cur, last) <= 0) {
    if (matches(rule, cur)) out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** dueTime "HH:mm" on the local date in tz -> UTC instant. */
export function dueAtFor(d: LocalDate, dueTime: string, tz: string): Date {
  const [hh, mm] = dueTime.split(":").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const wall = `${d.y}-${pad(d.m)}-${pad(d.d)}T${pad(hh)}:${pad(mm)}:00`;
  return fromZonedTime(wall, tz);
}

export function nextOccurrence(rule: Rule, tz: string, from = new Date()): Date | null {
  const today = localToday(tz, from);
  const horizon = addDays(today, 400);
  for (const d of occurrencesBetween(rule, today, horizon)) {
    const due = dueAtFor(d, rule.dueTime, tz);
    if (due.getTime() > from.getTime()) return due;
  }
  return null;
}

export function describeRule(rule: Pick<Rule, "freq" | "daysOfWeek" | "dayOfMonth" | "dueTime">): string {
  switch (rule.freq) {
    case "DAILY": return `Daily at ${rule.dueTime}`;
    case "WEEKLY": return `Weekly on ${[...rule.daysOfWeek].sort((a, b) => a - b).map((d) => DAY_NAMES[d]).join(", ")} at ${rule.dueTime}`;
    case "MONTHLY": return `Monthly on day ${rule.dayOfMonth} at ${rule.dueTime}`;
  }
}
