import { expect, test } from "vitest";
import { describeRule, dueAtFor, fromUtcMidnight, localToday, matches, nextOccurrence, occurrencesBetween, toUtcMidnight, Rule } from "@/lib/schedule";

const base = { dueTime: "09:00", startsOn: new Date("2026-01-01T00:00:00Z"), endsOn: null };
const daily: Rule = { ...base, freq: "DAILY", daysOfWeek: [], dayOfMonth: null };
const weekly: Rule = { ...base, freq: "WEEKLY", daysOfWeek: [1, 3], dayOfMonth: null }; // Mon, Wed
const monthly31: Rule = { ...base, freq: "MONTHLY", daysOfWeek: [], dayOfMonth: 31 };

test("localToday uses the org timezone", () => {
  const now = new Date("2026-03-10T23:30:00Z");
  expect(localToday("UTC", now)).toEqual({ y: 2026, m: 3, d: 10 });
  expect(localToday("Asia/Tokyo", now)).toEqual({ y: 2026, m: 3, d: 11 });
  expect(localToday("America/Los_Angeles", now)).toEqual({ y: 2026, m: 3, d: 10 });
});

test("utc midnight round trip", () => {
  const d = { y: 2026, m: 2, d: 28 };
  expect(fromUtcMidnight(toUtcMidnight(d))).toEqual(d);
  expect(toUtcMidnight(d).toISOString()).toBe("2026-02-28T00:00:00.000Z");
});

test("matches per frequency; monthly clamps to month end", () => {
  expect(matches(daily, { y: 2026, m: 3, d: 2 })).toBe(true);
  expect(matches(weekly, { y: 2026, m: 3, d: 2 })).toBe(true);  // Monday
  expect(matches(weekly, { y: 2026, m: 3, d: 3 })).toBe(false); // Tuesday
  expect(matches(monthly31, { y: 2026, m: 2, d: 28 })).toBe(true); // Feb 2026 has 28 days
  expect(matches(monthly31, { y: 2026, m: 3, d: 31 })).toBe(true);
  expect(matches(monthly31, { y: 2026, m: 3, d: 30 })).toBe(false);
});

test("occurrencesBetween respects startsOn/endsOn and is inclusive", () => {
  const rule: Rule = { ...weekly, startsOn: new Date("2026-03-03T00:00:00Z"), endsOn: new Date("2026-03-11T00:00:00Z") };
  expect(occurrencesBetween(rule, { y: 2026, m: 3, d: 1 }, { y: 2026, m: 3, d: 31 })).toEqual([
    { y: 2026, m: 3, d: 4 }, { y: 2026, m: 3, d: 9 }, { y: 2026, m: 3, d: 11 },
  ]);
});

test("dueAtFor converts org-local time to UTC, including DST change (Europe/Madrid, 2026-03-29)", () => {
  expect(dueAtFor({ y: 2026, m: 3, d: 28 }, "09:00", "Europe/Madrid").toISOString()).toBe("2026-03-28T08:00:00.000Z");
  expect(dueAtFor({ y: 2026, m: 3, d: 29 }, "09:00", "Europe/Madrid").toISOString()).toBe("2026-03-29T07:00:00.000Z");
});

test("dueAtFor resolves DST fall-back overlap to the earlier instant (America/New_York, 2026-11-01)", () => {
  expect(dueAtFor({ y: 2026, m: 11, d: 1 }, "01:30", "America/New_York").toISOString()).toBe("2026-11-01T05:30:00.000Z");
});

test("dueAtFor resolves DST spring-forward gap to the instant after the gap (Europe/Madrid, 2026-03-29 02:30 does not exist -> 03:30 CEST)", () => {
  expect(dueAtFor({ y: 2026, m: 3, d: 29 }, "02:30", "Europe/Madrid").toISOString()).toBe("2026-03-29T01:30:00.000Z");
});

test("nextOccurrence finds the next dueAt after from", () => {
  const from = new Date("2026-03-02T10:00:00Z"); // Monday 10:00 UTC, after 09:00
  expect(nextOccurrence(weekly, "UTC", from)?.toISOString()).toBe("2026-03-04T09:00:00.000Z");
  const ended: Rule = { ...daily, endsOn: new Date("2026-03-01T00:00:00Z") };
  expect(nextOccurrence(ended, "UTC", from)).toBeNull();
});

test("describeRule", () => {
  expect(describeRule(daily)).toBe("Daily at 09:00");
  expect(describeRule(weekly)).toBe("Weekly on Mon, Wed at 09:00");
  expect(describeRule(monthly31)).toBe("Monthly on day 31 at 09:00");
});
