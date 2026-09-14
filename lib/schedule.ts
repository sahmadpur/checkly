import { ScheduleFreq } from "@prisma/client";

export const CATCHUP_DAYS = 14;

export type Rule = { freq: ScheduleFreq; daysOfWeek: number[]; dayOfMonth: number | null; dueTime: string; startsOn: Date; endsOn: Date | null };
export type LocalDate = { y: number; m: number; d: number };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const toUtcMidnight = (d: LocalDate) => new Date(Date.UTC(d.y, d.m - 1, d.d));
export const fromUtcMidnight = (date: Date): LocalDate => ({ y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() });
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const addDays = (d: LocalDate, n: number) => fromUtcMidnight(new Date(toUtcMidnight(d).getTime() + n * 86400_000));
const cmp = (a: LocalDate, b: LocalDate) => toUtcMidnight(a).getTime() - toUtcMidnight(b).getTime();

const dtf = new Map<string, Intl.DateTimeFormat>();
const fmt = (tz: string) => dtf.get(tz) ?? (dtf.set(tz, new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })), dtf.get(tz)!);
/** Wall-clock parts of an instant in tz. */
function wallParts(instant: Date, tz: string) {
  const p = Object.fromEntries(fmt(tz).formatToParts(instant).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute };
}
/** Zone offset (ms) at an instant: wall time read as UTC minus the instant. */
function offsetAt(instant: Date, tz: string) {
  const w = wallParts(instant, tz);
  return Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm) - instant.getTime();
}

/** Calendar date "today" in the given IANA timezone. */
export function localToday(tz: string, now = new Date()): LocalDate {
  const w = wallParts(now, tz);
  return { y: w.y, m: w.m, d: w.d };
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

/**
 * dueTime "HH:mm" on the local date in tz -> UTC instant. Independent of the process
 * timezone. Ambiguous (fall-back) times resolve to the earlier instant; nonexistent
 * (spring-forward) times resolve to the instant after the gap.
 */
export function dueAtFor(d: LocalDate, dueTime: string, tz: string): Date {
  const [hh, mm] = dueTime.split(":").map(Number);
  const wallAsUtc = Date.UTC(d.y, d.m - 1, d.d, hh, mm);
  const probes = [wallAsUtc - 24 * 3600_000, wallAsUtc, wallAsUtc + 24 * 3600_000].map((t) => offsetAt(new Date(t), tz));
  const candidates = [...new Set(probes)].map((off) => new Date(wallAsUtc - off));
  const valid = candidates.filter((c) => { const w = wallParts(c, tz); return w.y === d.y && w.m === d.m && w.d === d.d && w.hh === hh && w.mm === mm; });
  if (valid.length) return new Date(Math.min(...valid.map((c) => c.getTime())));
  // gap: use the offset in force just before the wall time (pre-transition), which lands after the gap
  const before = offsetAt(new Date(wallAsUtc - 24 * 3600_000), tz);
  return new Date(wallAsUtc - before);
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
