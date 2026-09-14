# Scheduling and Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recurring schedules generate checklist instances daily/weekly/monthly at a due time in the org's timezone via a secured cron tick, and users get in-app, web push, and email notifications for assignment, reminders, overdue, submission, rejection, and approval.

**Architecture:** Pure recurrence math in `lib/schedule.ts`; `Schedule` rows with a `ScheduleRun` ledger for idempotent generation; `Notification` rows as inbox + outbox written synchronously by services and delivered by the tick; `POST /api/cron/tick` (bearer secret, advisory lock) runs generate → reminders → overdue → drain. Existing `assign` gets an internal creation routine reused by the tick. Push via `web-push` + service-worker handlers; email via existing `sendMail`.

**Tech Stack:** Next 16.3 (`next build --webpack`, `proxy.ts`), React 19, Prisma 7.10 (adapter-pg), Postgres, zod 4, Base UI shadcn, Serwist, `date-fns` + `date-fns-tz`, `web-push`, Resend, Vitest 5 on real Postgres, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-14-scheduling-design.md`

## Global Constraints

- Org id from the session only; services own authorization (`requireOrgRole`, `requirePropertyAccess`). Tick-side functions take `orgId` explicitly and are never exposed to sessions.
- Enums exactly `ScheduleFreq { DAILY WEEKLY MONTHLY }` and `NotificationType { ASSIGNED DUE_SOON OVERDUE REJECTED APPROVED SUBMITTED }`.
- Schedule validation: WEEKLY needs 1–7 distinct `daysOfWeek` in 0..6 (0 = Sunday); MONTHLY needs `dayOfMonth` 1..31 (clamped to month end when generating); DAILY has neither; `dueTime` matches `^([01]\d|2[0-3]):[0-5]\d$`; `endsOn >= startsOn`; ≥1 assignee, all PropertyMembers; template in org and not archived.
- `occurrenceDate` = local calendar date in org tz stored as UTC midnight; `dueAt` = that date + `dueTime` in org tz converted to UTC. Catch-up capped at 14 days back.
- Tick: `Authorization: Bearer <CRON_SECRET>`; 401 with empty body otherwise; `pg_try_advisory_lock` → `{ skipped: true }` when held; per-item try/catch; response `{ generated, notified, reminders, overdue, errors, ms }`.
- Reminders: OPEN/REJECTED, `remindedAt` null, `dueAt` in (now, now+60min]. Overdue: OPEN/REJECTED, `overdueNotifiedAt` null, `dueAt < now`. Each fires once.
- Event recipients: ASSIGNED/DUE_SOON/OVERDUE/REJECTED/APPROVED → the assignee; SUBMITTED → org OWNERs plus MANAGERs who are PropertyMembers of that property, excluding the submitter.
- Delivery: push only if `user.notifyPush` and subscriptions exist, else stamp; email only if `user.notifyEmail` and email present, else stamp; 3 attempts max; 404/410 deletes the subscription; rows older than 24 h are not delivered.
- Copy exactly as in the spec; `url` is `/checklists/<id>`; times in copy use the org timezone.
- Actions via `run()`; zod schemas in `actions/*.schemas.ts`; no schema exports from `"use server"` files; Prisma errors never leak.
- Tests on real Postgres; the only mock is `web-push` at the module boundary.
- New env: `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
- pnpm; conventional commits ending with the controller's two attribution lines.

## File Structure

```
prisma/schema.prisma                      + enums, Schedule, ScheduleAssignee, ScheduleRun, PushSubscription, Notification; Org.timezone; User.notify*; instance cols
tests/helpers/db.ts                       resetDb + makeSchedule helper
lib/schedule.ts                           pure recurrence math + describeRule
lib/notifications/copy.ts                 buildCopy(type, ctx) → { title, body, url }
lib/notifications/push.ts                 web-push wrapper (sendPush, configured)
lib/services/notification.ts              notify, inbox, preferences, push subscriptions, recipientsForSubmitted
lib/services/instance.ts                  createInstances (internal), assign/submit/review emit notifications
lib/services/schedule.ts                  schedule CRUD + validation; ScheduleAssignee cleanup in member/property services
lib/services/tick.ts                      runTick: lock, generate, reminders, overdue, drain
app/api/cron/tick/route.ts                bearer-secret route
lib/services/org.ts                       setTimezone; auth.signup takes timezone
actions/schedule.ts, schedule.schemas.ts  actions/notification.ts, notification.schemas.ts  actions/org.ts (+setTimezoneAction)
app/(app)/properties/[id]/schedules.tsx   list section;  .../schedules/new/page.tsx; app/(app)/schedules/[id]/page.tsx; schedule-form.tsx
app/(app)/notifications/page.tsx          inbox;  components/notification-bell.tsx; app/(app)/layout.tsx (bell)
app/(app)/settings/*                      timezone-form.tsx, notification-prefs.tsx (push toggle), page wiring
app/sw.ts                                 push + notificationclick handlers
scripts/push-keys.ts                      prints VAPID pair
docker-compose.yml (cron sidecar), .env.example, .github/workflows/ci.yml, README.md
tests/unit/schedule.test.ts, copy.test.ts, scheduling-schemas.test.ts; tests/services/schedule.test.ts, notification.test.ts, tick.test.ts; tests/route/tick.test.ts; e2e/schedule.spec.ts
```

---

### Task 1: Schema, migration, helpers

**Files:**
- Modify: `prisma/schema.prisma`, `tests/helpers/db.ts`
- Create: migration via `prisma migrate dev`
- Test: `tests/services/scheduling-schema.test.ts`

**Interfaces:**
- Produces: models/enums above from `@prisma/client`; helper `makeSchedule({ orgId, propertyId, templateId, createdById, assigneeIds, freq?, daysOfWeek?, dayOfMonth?, dueTime?, startsOn?, endsOn? })`.

- [ ] **Step 1: Schema changes**

In `prisma/schema.prisma`:
- `Org`: add `timezone String @default("UTC")`, `schedules Schedule[]`, `notifications Notification[]`.
- `User`: add `notifyPush Boolean @default(true)`, `notifyEmail Boolean @default(true)`, `schedulesCreated Schedule[] @relation("ScheduleCreator")`, `scheduleAssignments ScheduleAssignee[]`, `pushSubscriptions PushSubscription[]`, `notifications Notification[]`.
- `Property`: add `schedules Schedule[]`.
- `ChecklistTemplate`: add `schedules Schedule[]`.
- `ChecklistInstance`: add `scheduleId String?`, `schedule Schedule? @relation(fields: [scheduleId], references: [id], onDelete: SetNull)`, `remindedAt DateTime?`, `overdueNotifiedAt DateTime?`, `notifications Notification[]`, and `@@index([status, dueAt])`.

Append:

```prisma
enum ScheduleFreq {
  DAILY
  WEEKLY
  MONTHLY
}

enum NotificationType {
  ASSIGNED
  DUE_SOON
  OVERDUE
  REJECTED
  APPROVED
  SUBMITTED
}

model Schedule {
  id          String             @id @default(cuid())
  orgId       String
  propertyId  String
  templateId  String
  createdById String
  name        String
  freq        ScheduleFreq
  daysOfWeek  Int[]              @default([])
  dayOfMonth  Int?
  dueTime     String
  startsOn    DateTime
  endsOn      DateTime?
  pausedAt    DateTime?
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt
  org         Org                @relation(fields: [orgId], references: [id], onDelete: Cascade)
  property    Property           @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  template    ChecklistTemplate  @relation(fields: [templateId], references: [id], onDelete: Restrict)
  createdBy   User               @relation("ScheduleCreator", fields: [createdById], references: [id], onDelete: Restrict)
  assignees   ScheduleAssignee[]
  runs        ScheduleRun[]
  instances   ChecklistInstance[]

  @@index([orgId, propertyId])
}

model ScheduleAssignee {
  id         String   @id @default(cuid())
  scheduleId String
  userId     String
  schedule   Schedule @relation(fields: [scheduleId], references: [id], onDelete: Cascade)
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([scheduleId, userId])
}

model ScheduleRun {
  id             String   @id @default(cuid())
  scheduleId     String
  occurrenceDate DateTime
  instanceIds    String[] @default([])
  createdAt      DateTime @default(now())
  schedule       Schedule @relation(fields: [scheduleId], references: [id], onDelete: Cascade)

  @@unique([scheduleId, occurrenceDate])
}

model PushSubscription {
  id         String    @id @default(cuid())
  userId     String
  endpoint   String    @unique
  p256dh     String
  auth       String
  userAgent  String?
  createdAt  DateTime  @default(now())
  lastUsedAt DateTime?
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Notification {
  id          String            @id @default(cuid())
  orgId       String
  userId      String
  type        NotificationType
  instanceId  String?
  title       String
  body        String
  url         String
  createdAt   DateTime          @default(now())
  readAt      DateTime?
  pushSentAt  DateTime?
  emailSentAt DateTime?
  attempts    Int               @default(0)
  error       String?
  org         Org               @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user        User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  instance    ChecklistInstance? @relation(fields: [instanceId], references: [id], onDelete: SetNull)

  @@index([userId, readAt])
  @@index([pushSentAt])
  @@index([emailSentAt])
}
```

- [ ] **Step 2: Migrate**

```bash
pnpm prisma migrate dev --name scheduling
pnpm prisma generate
pnpm db:push:test
```

- [ ] **Step 3: Helpers**

In `tests/helpers/db.ts`, prepend the new tables to `resetDb`'s TRUNCATE list: `"Notification","PushSubscription","ScheduleRun","ScheduleAssignee","Schedule",` (before `"InstanceItem"`). Append:

```ts
import { ScheduleFreq } from "@prisma/client";

export async function makeSchedule(input: {
  orgId: string; propertyId: string; templateId: string; createdById: string; assigneeIds: string[];
  freq?: ScheduleFreq; daysOfWeek?: number[]; dayOfMonth?: number | null; dueTime?: string;
  startsOn?: Date; endsOn?: Date | null; name?: string;
}) {
  return db.schedule.create({
    data: {
      orgId: input.orgId, propertyId: input.propertyId, templateId: input.templateId, createdById: input.createdById,
      name: input.name ?? "Checkout clean", freq: input.freq ?? "DAILY", daysOfWeek: input.daysOfWeek ?? [],
      dayOfMonth: input.dayOfMonth ?? null, dueTime: input.dueTime ?? "09:00",
      startsOn: input.startsOn ?? new Date("2026-01-01T00:00:00Z"), endsOn: input.endsOn ?? null,
      assignees: { create: input.assigneeIds.map((userId) => ({ userId })) },
    },
    include: { assignees: true },
  });
}
```

Add `ScheduleFreq` to the existing `@prisma/client` import instead of a second import statement.

- [ ] **Step 4: Schema test**

Create `tests/services/scheduling-schema.test.ts`:

```ts
import { expect, test } from "vitest";
import { db } from "@/lib/db";
import { makeMember, makeOrg, makeProperty, makeSchedule, makeTemplate, makeUser } from "@/tests/helpers/db";

test("deleting a schedule keeps instances (scheduleId null) and removes runs/assignees; run dates are unique", async () => {
  const org = await makeOrg();
  const mgr = await makeUser();
  const w = await makeUser();
  await makeMember(org.id, mgr.id, "MANAGER");
  await makeMember(org.id, w.id, "WORKER");
  const prop = await makeProperty(org.id);
  const tpl = await makeTemplate(org.id);
  const s = await makeSchedule({ orgId: org.id, propertyId: prop.id, templateId: tpl.id, createdById: mgr.id, assigneeIds: [w.id] });
  const inst = await db.checklistInstance.create({
    data: { orgId: org.id, propertyId: prop.id, templateName: "x", assigneeId: w.id, assignedById: mgr.id, dueAt: new Date(), scheduleId: s.id },
  });
  const day = new Date("2026-03-01T00:00:00Z");
  await db.scheduleRun.create({ data: { scheduleId: s.id, occurrenceDate: day } });
  await expect(db.scheduleRun.create({ data: { scheduleId: s.id, occurrenceDate: day } })).rejects.toThrow();
  await expect(db.checklistTemplate.delete({ where: { id: tpl.id } })).rejects.toThrow(); // Restrict
  await db.schedule.delete({ where: { id: s.id } });
  expect((await db.checklistInstance.findUniqueOrThrow({ where: { id: inst.id } })).scheduleId).toBeNull();
  expect(await db.scheduleRun.count()).toBe(0);
  expect(await db.scheduleAssignee.count()).toBe(0);
});

test("org timezone defaults to UTC; user notification flags default true", async () => {
  const org = await makeOrg();
  const u = await makeUser();
  expect(org.timezone).toBe("UTC");
  expect([u.notifyPush, u.notifyEmail]).toEqual([true, true]);
});
```

- [ ] **Step 5: Run and commit**

Run: `pnpm test` → all previous + 2 pass; `pnpm build` clean.

```bash
git add prisma tests
git commit -m "feat: add schedule, notification, and push subscription schema"
```

---

### Task 2: Pure recurrence math

**Files:**
- Create: `lib/schedule.ts`
- Modify: `package.json` (deps)
- Test: `tests/unit/schedule.test.ts`

**Interfaces:**
- Produces:
  - `type Rule = { freq: ScheduleFreq; daysOfWeek: number[]; dayOfMonth: number | null; dueTime: string; startsOn: Date; endsOn: Date | null }`
  - `type LocalDate = { y: number; m: number; d: number }` (1-based month)
  - `localToday(tz: string, now?: Date): LocalDate`
  - `toUtcMidnight(d: LocalDate): Date` and `fromUtcMidnight(date: Date): LocalDate`
  - `matches(rule: Rule, d: LocalDate): boolean`
  - `occurrencesBetween(rule: Rule, from: LocalDate, to: LocalDate): LocalDate[]` (inclusive both ends; respects startsOn/endsOn as UTC-midnight dates)
  - `dueAtFor(d: LocalDate, dueTime: string, tz: string): Date`
  - `nextOccurrence(rule: Rule, tz: string, from?: Date): Date | null` (next dueAt strictly after `from`, within 400 days)
  - `describeRule(rule: Pick<Rule, "freq" | "daysOfWeek" | "dayOfMonth" | "dueTime">): string`
  - `CATCHUP_DAYS = 14`

- [ ] **Step 1: Install deps**

```bash
pnpm add date-fns date-fns-tz
```

- [ ] **Step 2: Failing tests**

Create `tests/unit/schedule.test.ts`:

```ts
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
```

Run: `pnpm test tests/unit/schedule.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `lib/schedule.ts`:

```ts
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

/** dueTime "HH:mm" on the local date in tz → UTC instant. */
export function dueAtFor(d: LocalDate, dueTime: string, tz: string): Date {
  const [hh, mm] = dueTime.split(":").map(Number);
  const wall = new Date(d.y, d.m - 1, d.d, hh, mm, 0, 0); // interpreted as wall-clock in tz by fromZonedTime
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
```

Note on `dueAtFor`: `fromZonedTime(date, tz)` treats the given Date's wall-clock fields (in the process's local zone) as wall time in `tz`. Building `new Date(y, m-1, d, hh, mm)` uses the process zone for construction only; `fromZonedTime` reads the fields back, so the result is correct regardless of `TZ`. Verify the DST test passes with `TZ=UTC pnpm test tests/unit/schedule.test.ts` and with `TZ=Asia/Tokyo …`. If the second fails, replace the construction with `fromZonedTime(`${y}-${mm}-${dd}T${dueTime}:00`, tz)` (string form), which is zone-independent.

- [ ] **Step 4: Run and commit**

Run: `pnpm test tests/unit/schedule.test.ts` → 7 passed; also `TZ=Asia/Tokyo pnpm test tests/unit/schedule.test.ts`.

```bash
git add lib/schedule.ts tests/unit/schedule.test.ts package.json pnpm-lock.yaml
git commit -m "feat: add recurrence math for schedules"
```

---

### Task 3: Notification service, copy, and event hooks in instance service

**Files:**
- Create: `lib/notifications/copy.ts`, `lib/services/notification.ts`
- Modify: `lib/services/instance.ts` (extract `createInstances`; emit ASSIGNED/SUBMITTED/REJECTED/APPROVED), `lib/format.ts` (add `formatInTz`)
- Test: `tests/unit/copy.test.ts`, `tests/services/notification.test.ts`, `tests/services/instance.test.ts` (append)

**Interfaces:**
- Produces in `lib/notifications/copy.ts`:
  - `type CopyCtx = { template: string; property: string; dueAt: Date; tz: string; comment?: string | null; worker?: string; instanceId: string }`
  - `buildCopy(type: NotificationType, c: CopyCtx): { title: string; body: string; url: string }`
- Produces in `lib/format.ts`: `formatInTz(d: Date, tz: string): string` (e.g. "Mon, Mar 2, 09:00").
- Produces in `lib/services/notification.ts`:
  - `type NotifyRow = { orgId: string; userId: string; type: NotificationType; instanceId?: string | null; title: string; body: string; url: string }`
  - `notify(rows: NotifyRow[], tx?: Prisma.TransactionClient): Promise<void>`
  - `recipientsForSubmitted(orgId, propertyId, excludeUserId): Promise<string[]>` (OWNERs + MANAGERs who are PropertyMembers, minus exclude)
  - `listMine(ctx, limit = 50)`, `unreadCount(ctx): Promise<number>`, `markRead(ctx, id)`, `markAllRead(ctx)`
  - `setPreferences(ctx, { notifyPush?: boolean; notifyEmail?: boolean })`, `getPreferences(ctx)`
  - `savePushSubscription(ctx, { endpoint, keys: { p256dh, auth }, userAgent? })`, `deletePushSubscription(ctx, endpoint)`, `listPushSubscriptions(userId)`
- Produces in `lib/services/instance.ts`:
  - `createInstances(input: { orgId; propertyId; templateId; assigneeIds; dueAt; assignedById; scheduleId?: string | null }, tx?: Prisma.TransactionClient): Promise<{ ids: string[] }>` — no ctx; validates template (in org, not archived, has items) and membership; creates instances + ASSIGNED notifications in one transaction (uses `tx` when given).
  - `assign(ctx, input)` keeps its signature and delegates to `createInstances` after the guards.

- [ ] **Step 1: Copy + format tests**

Create `tests/unit/copy.test.ts`:

```ts
import { expect, test } from "vitest";
import { buildCopy } from "@/lib/notifications/copy";
import { formatInTz } from "@/lib/format";

const c = { template: "Checkout clean", property: "Villa Azul", dueAt: new Date("2026-03-02T08:00:00Z"), tz: "Europe/Madrid", instanceId: "i1" };

test("formatInTz renders in the org timezone", () => {
  expect(formatInTz(c.dueAt, "Europe/Madrid")).toBe("Mon, Mar 2, 09:00");
  expect(formatInTz(c.dueAt, "UTC")).toBe("Mon, Mar 2, 08:00");
});

test("copy per type", () => {
  expect(buildCopy("ASSIGNED", c)).toEqual({ title: "New checklist: Checkout clean at Villa Azul", body: "Due Mon, Mar 2, 09:00", url: "/checklists/i1" });
  expect(buildCopy("DUE_SOON", c).title).toBe("Due in 1 hour: Checkout clean at Villa Azul");
  expect(buildCopy("OVERDUE", c).title).toBe("Overdue: Checkout clean at Villa Azul");
  expect(buildCopy("REJECTED", { ...c, comment: "Redo beds" })).toMatchObject({ title: "Needs rework: Checkout clean at Villa Azul", body: "Redo beds" });
  expect(buildCopy("APPROVED", c).title).toBe("Approved: Checkout clean at Villa Azul");
  expect(buildCopy("SUBMITTED", { ...c, worker: "Wendy" }).title).toBe("Wendy submitted Checkout clean at Villa Azul");
});
```

Add to `lib/format.ts`:

```ts
export const formatInTz = (d: Date, tz: string) =>
  d.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
```

Verify the exact output string at the REPL (`node -e`) and adjust the test's expected strings to the real formatting if Node renders e.g. "Mon, Mar 2, 09:00" differently; the requirement is weekday, month, day, HH:mm in the given zone.

Create `lib/notifications/copy.ts`:

```ts
import type { NotificationType } from "@prisma/client";
import { formatInTz } from "@/lib/format";

export type CopyCtx = { template: string; property: string; dueAt: Date; tz: string; comment?: string | null; worker?: string; instanceId: string };

export function buildCopy(type: NotificationType, c: CopyCtx): { title: string; body: string; url: string } {
  const where = `${c.template} at ${c.property}`;
  const due = `Due ${formatInTz(c.dueAt, c.tz)}`;
  const url = `/checklists/${c.instanceId}`;
  switch (type) {
    case "ASSIGNED": return { title: `New checklist: ${where}`, body: due, url };
    case "DUE_SOON": return { title: `Due in 1 hour: ${where}`, body: due, url };
    case "OVERDUE": return { title: `Overdue: ${where}`, body: due, url };
    case "REJECTED": return { title: `Needs rework: ${where}`, body: c.comment ?? "", url };
    case "APPROVED": return { title: `Approved: ${where}`, body: due, url };
    case "SUBMITTED": return { title: `${c.worker ?? "A worker"} submitted ${where}`, body: due, url };
  }
}
```

Run: `pnpm test tests/unit/copy.test.ts` → 2 passed.

- [ ] **Step 2: Notification service tests**

Create `tests/services/notification.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { db } from "@/lib/db";
import {
  deletePushSubscription, getPreferences, listMine, markAllRead, markRead, notify, recipientsForSubmitted,
  savePushSubscription, setPreferences, unreadCount,
} from "@/lib/services/notification";
import { makeMember, makeOrg, makeProperty, makeUser } from "@/tests/helpers/db";

async function setup() {
  const org = await makeOrg();
  const owner = await makeUser({ name: "Owner" });
  const mgrIn = await makeUser({ name: "MgrIn" });
  const mgrOut = await makeUser({ name: "MgrOut" });
  const w = await makeUser({ name: "W" });
  await makeMember(org.id, owner.id, "OWNER");
  await makeMember(org.id, mgrIn.id, "MANAGER");
  await makeMember(org.id, mgrOut.id, "MANAGER");
  await makeMember(org.id, w.id, "WORKER");
  const prop = await makeProperty(org.id);
  await db.propertyMember.createMany({ data: [mgrIn.id, w.id].map((userId) => ({ propertyId: prop.id, userId })) });
  const ctx = (userId: string) => ({ userId, orgId: org.id });
  return { org, owner, mgrIn, mgrOut, w, prop, ctx };
}

test("recipientsForSubmitted: owners + property managers, excluding the submitter", async () => {
  const { org, owner, mgrIn, w, prop } = await setup();
  const ids = await recipientsForSubmitted(org.id, prop.id, w.id);
  expect(ids.sort()).toEqual([mgrIn.id, owner.id].sort());
});

describe("inbox", () => {
  test("notify, listMine (own only, newest first), unreadCount, markRead scoping, markAllRead", async () => {
    const { org, w, owner, ctx } = await setup();
    await notify([
      { orgId: org.id, userId: w.id, type: "ASSIGNED", title: "a", body: "", url: "/x" },
      { orgId: org.id, userId: w.id, type: "OVERDUE", title: "b", body: "", url: "/y" },
      { orgId: org.id, userId: owner.id, type: "SUBMITTED", title: "c", body: "", url: "/z" },
    ]);
    const mine = await listMine(ctx(w.id));
    expect(mine.map((n) => n.title)).toEqual(["b", "a"]);
    expect(await unreadCount(ctx(w.id))).toBe(2);
    await expect(markRead(ctx(owner.id), mine[0].id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await markRead(ctx(w.id), mine[0].id);
    expect(await unreadCount(ctx(w.id))).toBe(1);
    await markAllRead(ctx(w.id));
    expect(await unreadCount(ctx(w.id))).toBe(0);
    expect(await unreadCount(ctx(owner.id))).toBe(1);
  });
});

describe("preferences and push subscriptions", () => {
  test("toggle preferences; save/replace/delete subscription; endpoint must be https", async () => {
    const { w, ctx } = await setup();
    expect(await getPreferences(ctx(w.id))).toEqual({ notifyPush: true, notifyEmail: true });
    await setPreferences(ctx(w.id), { notifyEmail: false });
    expect(await getPreferences(ctx(w.id))).toEqual({ notifyPush: true, notifyEmail: false });
    await expect(savePushSubscription(ctx(w.id), { endpoint: "http://insecure", keys: { p256dh: "a", auth: "b" } })).rejects.toMatchObject({ code: "INVALID" });
    await savePushSubscription(ctx(w.id), { endpoint: "https://push.example/1", keys: { p256dh: "a", auth: "b" }, userAgent: "ua" });
    await savePushSubscription(ctx(w.id), { endpoint: "https://push.example/1", keys: { p256dh: "a2", auth: "b2" } });
    const subs = await db.pushSubscription.findMany({ where: { userId: w.id } });
    expect(subs).toHaveLength(1);
    expect(subs[0].p256dh).toBe("a2");
    await deletePushSubscription(ctx(w.id), "https://push.example/1");
    expect(await db.pushSubscription.count()).toBe(0);
  });
});
```

Run: `pnpm test tests/services/notification.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement the service**

Create `lib/services/notification.ts`:

```ts
import { NotificationType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { Ctx, requireOrgRole } from "@/lib/auth/guard";
import { invalid, notFound } from "@/lib/errors";

export type NotifyRow = { orgId: string; userId: string; type: NotificationType; instanceId?: string | null; title: string; body: string; url: string };

export async function notify(rows: NotifyRow[], tx: Prisma.TransactionClient | typeof db = db) {
  if (rows.length === 0) return;
  await tx.notification.createMany({ data: rows.map((r) => ({ ...r, instanceId: r.instanceId ?? null })) });
}

/** Org OWNERs plus MANAGERs who are members of the property, minus the submitter. */
export async function recipientsForSubmitted(orgId: string, propertyId: string, excludeUserId: string) {
  const members = await db.orgMember.findMany({
    where: {
      orgId, userId: { not: excludeUserId },
      OR: [{ role: "OWNER" }, { role: "MANAGER", user: { propertyMembers: { some: { propertyId } } } }],
    },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

export async function listMine(ctx: Ctx, limit = 50) {
  await requireOrgRole(ctx, "WORKER");
  return db.notification.findMany({
    where: { orgId: ctx.orgId, userId: ctx.userId },
    orderBy: { createdAt: "desc" }, take: limit,
    select: { id: true, type: true, title: true, body: true, url: true, createdAt: true, readAt: true },
  });
}

export async function unreadCount(ctx: Ctx) {
  await requireOrgRole(ctx, "WORKER");
  return db.notification.count({ where: { orgId: ctx.orgId, userId: ctx.userId, readAt: null } });
}

export async function markRead(ctx: Ctx, id: string) {
  await requireOrgRole(ctx, "WORKER");
  const n = await db.notification.updateMany({ where: { id, orgId: ctx.orgId, userId: ctx.userId, readAt: null }, data: { readAt: new Date() } });
  if (n.count === 0) {
    const exists = await db.notification.findFirst({ where: { id, orgId: ctx.orgId, userId: ctx.userId }, select: { id: true } });
    if (!exists) throw notFound("Notification not found");
  }
}

export async function markAllRead(ctx: Ctx) {
  await requireOrgRole(ctx, "WORKER");
  await db.notification.updateMany({ where: { orgId: ctx.orgId, userId: ctx.userId, readAt: null }, data: { readAt: new Date() } });
}

export async function getPreferences(ctx: Ctx) {
  const u = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { notifyPush: true, notifyEmail: true } });
  return u;
}

export async function setPreferences(ctx: Ctx, p: { notifyPush?: boolean; notifyEmail?: boolean }) {
  await db.user.update({ where: { id: ctx.userId }, data: p });
}

const b64url = /^[A-Za-z0-9_-]+=*$/;

export async function savePushSubscription(ctx: Ctx, sub: { endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string | null }) {
  if (!/^https:\/\//.test(sub.endpoint)) throw invalid("Push endpoint must be https");
  if (!b64url.test(sub.keys.p256dh) || !b64url.test(sub.keys.auth)) throw invalid("Invalid subscription keys");
  await db.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { userId: ctx.userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: sub.userAgent ?? null },
    update: { userId: ctx.userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: sub.userAgent ?? null },
  });
}

export async function deletePushSubscription(ctx: Ctx, endpoint: string) {
  await db.pushSubscription.deleteMany({ where: { endpoint, userId: ctx.userId } });
}

export const listPushSubscriptions = (userId: string) => db.pushSubscription.findMany({ where: { userId } });
```

Run: `pnpm test tests/services/notification.test.ts` → 3 passed.

- [ ] **Step 4: Instance hooks — failing tests**

Append to `tests/services/instance.test.ts` (import `createInstances` too):

```ts
describe("notifications from instance events", () => {
  test("assign creates ASSIGNED for each assignee; submit notifies owner + property managers; review notifies the worker", async () => {
    const { org, owner, mgr, w1, w2, prop, tpl, ctx, due } = await setup();
    const { ids } = await assign(ctx(mgr.id), { templateId: tpl.id, propertyId: prop.id, assigneeIds: [w1.id, w2.id], dueAt: due });
    const assigned = await db.notification.findMany({ where: { type: "ASSIGNED" }, orderBy: { userId: "asc" } });
    expect(assigned.map((n) => n.userId).sort()).toEqual([w1.id, w2.id].sort());
    expect(assigned[0].url).toMatch(/^\/checklists\//);
    expect(assigned[0].title).toBe("New checklist: Checkout clean at Villa");

    const inst = await getInstance(ctx(w1.id), ids[0]);
    for (const it of inst.items.filter((i) => i.required)) {
      if (it.type === "CHECKBOX") await answerItem(ctx(w1.id), inst.id, it.id, { type: "CHECKBOX", checked: true });
      if (it.type === "NUMBER") await answerItem(ctx(w1.id), inst.id, it.id, { type: "NUMBER", number: 1 });
      if (it.type === "SELECT") await answerItem(ctx(w1.id), inst.id, it.id, { type: "SELECT", choice: "Good" });
      if (it.type === "PHOTO") { const key = mediaKey(org.id, inst.id, it.id, "jpg"); await seedMedia(key); await answerItem(ctx(w1.id), inst.id, it.id, { type: "PHOTO", fileKey: key, fileType: "image/jpeg" }); }
    }
    await submit(ctx(w1.id), inst.id);
    const submitted = await db.notification.findMany({ where: { type: "SUBMITTED" } });
    expect(submitted.map((n) => n.userId).sort()).toEqual([mgr.id, owner.id].sort());
    expect(submitted[0].title).toBe("W1 submitted Checkout clean at Villa");

    await review(ctx(mgr.id), inst.id, "REJECTED", "Redo");
    expect(await db.notification.findFirst({ where: { type: "REJECTED", userId: w1.id } })).toMatchObject({ body: "Redo" });
    await submit(ctx(w1.id), inst.id);
    await review(ctx(mgr.id), inst.id, "APPROVED");
    expect(await db.notification.count({ where: { type: "APPROVED", userId: w1.id } })).toBe(1);
  });

  test("createInstances (no ctx) validates template and membership and tags scheduleId", async () => {
    const { org, mgr, w1, outsider, prop, tpl, due } = await setup();
    await expect(createInstances({ orgId: org.id, propertyId: prop.id, templateId: tpl.id, assigneeIds: [outsider.id], dueAt: due, assignedById: mgr.id })).rejects.toMatchObject({ code: "INVALID" });
    const s = await db.schedule.create({ data: { orgId: org.id, propertyId: prop.id, templateId: tpl.id, createdById: mgr.id, name: "s", freq: "DAILY", dueTime: "09:00", startsOn: new Date() } });
    const { ids } = await createInstances({ orgId: org.id, propertyId: prop.id, templateId: tpl.id, assigneeIds: [w1.id], dueAt: due, assignedById: mgr.id, scheduleId: s.id });
    expect((await db.checklistInstance.findUniqueOrThrow({ where: { id: ids[0] } })).scheduleId).toBe(s.id);
  });
});
```

Run: `pnpm test tests/services/instance.test.ts` → FAIL (`createInstances` not exported; no notifications).

- [ ] **Step 5: Implement hooks**

In `lib/services/instance.ts`:

Add imports: `import { notify, recipientsForSubmitted } from "@/lib/services/notification"; import { buildCopy } from "@/lib/notifications/copy";`.

Replace `assign` with:

```ts
export type CreateInstancesInput = { orgId: string; propertyId: string; templateId: string; assigneeIds: string[]; dueAt: Date; assignedById: string; scheduleId?: string | null };

/** Creates one instance per assignee with frozen items and ASSIGNED notifications. No session; callers authorize. */
export async function createInstances(input: CreateInstancesInput, tx?: Prisma.TransactionClient) {
  const assigneeIds = [...new Set(input.assigneeIds)];
  if (assigneeIds.length === 0) throw invalid("Pick at least one worker");
  if (assigneeIds.length > 50) throw invalid("Assign to at most 50 workers at a time");
  const client = tx ?? db;
  const tpl = await client.checklistTemplate.findFirst({ where: { id: input.templateId, orgId: input.orgId }, include: { items: { orderBy: { order: "asc" } } } });
  if (!tpl) throw notFound("Template not found");
  if (tpl.archivedAt) throw invalid("Template is archived");
  if (tpl.items.length === 0) throw invalid("Template has no items");
  const [members, property, org] = await Promise.all([
    client.propertyMember.count({ where: { propertyId: input.propertyId, userId: { in: assigneeIds } } }),
    client.property.findFirst({ where: { id: input.propertyId, orgId: input.orgId }, select: { name: true } }),
    client.org.findUniqueOrThrow({ where: { id: input.orgId }, select: { timezone: true } }),
  ]);
  if (!property) throw notFound("Property not found");
  if (members !== assigneeIds.length) throw invalid("Every assignee must be a member of this property");
  const frozen = tpl.items.map((i) => ({ order: i.order, type: i.type, label: i.label, required: i.required, options: i.options, min: i.min, max: i.max }));

  const work = async (t: Prisma.TransactionClient) => {
    const ids: string[] = [];
    for (const assigneeId of assigneeIds) {
      const row = await t.checklistInstance.create({
        data: {
          orgId: input.orgId, propertyId: input.propertyId, templateId: tpl.id, templateName: tpl.name, scheduleId: input.scheduleId ?? null,
          assigneeId, assignedById: input.assignedById, dueAt: input.dueAt, items: { create: frozen },
        },
        select: { id: true },
      });
      ids.push(row.id);
      const copy = buildCopy("ASSIGNED", { template: tpl.name, property: property.name, dueAt: input.dueAt, tz: org.timezone, instanceId: row.id });
      await notify([{ orgId: input.orgId, userId: assigneeId, type: "ASSIGNED", instanceId: row.id, ...copy }], t);
    }
    return { ids };
  };
  return tx ? work(tx) : db.$transaction(work);
}

export async function assign(ctx: Ctx, input: { templateId: string; propertyId: string; assigneeIds: string[]; dueAt: Date }) {
  await requireOrgRole(ctx, "MANAGER");
  await requirePropertyAccess(ctx, input.propertyId);
  return createInstances({ orgId: ctx.orgId, ...input, assignedById: ctx.userId });
}
```

In `submit`, after the successful `updateMany`, add:

```ts
  const inst = await db.checklistInstance.findUniqueOrThrow({
    where: { id: instanceId }, select: { propertyId: true, templateName: true, dueAt: true, assignee: { select: { name: true } }, property: { select: { name: true } }, org: { select: { timezone: true } } },
  });
  const recipients = await recipientsForSubmitted(ctx.orgId, inst.propertyId, ctx.userId);
  const copy = buildCopy("SUBMITTED", { template: inst.templateName, property: inst.property.name, dueAt: inst.dueAt, tz: inst.org.timezone, worker: inst.assignee.name, instanceId });
  await notify(recipients.map((userId) => ({ orgId: ctx.orgId, userId, type: "SUBMITTED" as const, instanceId, ...copy })));
```

In `review`, after the successful `updateMany`, add:

```ts
  const full = await db.checklistInstance.findUniqueOrThrow({
    where: { id: instanceId }, select: { assigneeId: true, templateName: true, dueAt: true, property: { select: { name: true } }, org: { select: { timezone: true } } },
  });
  const copy = buildCopy(decision, { template: full.templateName, property: full.property.name, dueAt: full.dueAt, tz: full.org.timezone, comment: text, instanceId });
  await notify([{ orgId: ctx.orgId, userId: full.assigneeId, type: decision, instanceId, ...copy }]);
```

(`review`'s `select` in the existing pre-check may already include `propertyId`; keep it.)

- [ ] **Step 6: Run and commit**

Run: `pnpm test` → all pass (existing instance tests must still pass unchanged); `pnpm build`, `pnpm lint`.

```bash
git add lib tests
git commit -m "feat: add notification service and emit checklist event notifications"
```

---

### Task 4: Schedule service and membership cleanup

**Files:**
- Create: `lib/services/schedule.ts`
- Modify: `lib/services/member.ts` (removeMember), `lib/services/property.ts` (removePropertyMember, deleteProperty untouched — cascade)
- Test: `tests/services/schedule.test.ts`

**Interfaces:**
- Produces:
  - `type ScheduleInput = { templateId: string; assigneeIds: string[]; freq: ScheduleFreq; daysOfWeek: number[]; dayOfMonth: number | null; dueTime: string; startsOn: Date; endsOn: Date | null }`
  - `type ScheduleRow = { id; propertyId; templateId; name; freq; daysOfWeek; dayOfMonth; dueTime; startsOn; endsOn; pausedAt; assignees: { userId; name }[]; templateArchived: boolean; description: string; nextAt: Date | null }`
  - `listSchedules(ctx, propertyId): Promise<ScheduleRow[]>` (MANAGER+ with property access; WORKER → FORBIDDEN)
  - `getSchedule(ctx, id): Promise<ScheduleRow>` (NOT_FOUND cross-org/no access)
  - `createSchedule(ctx, propertyId, input): Promise<{ id }>`, `updateSchedule(ctx, id, input)`, `pauseSchedule(ctx, id)`, `resumeSchedule(ctx, id)`, `deleteSchedule(ctx, id)`
  - `validateRule(input): void` throws INVALID per the Global Constraints.

- [ ] **Step 1: Failing tests**

Create `tests/services/schedule.test.ts`:

```ts
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
    await deleteSchedule(ctx(mgr.id), id);
    expect(await listSchedules(ctx(mgr.id), prop.id)).toEqual([]);
  });

  test("permissions: worker forbidden; manager without property access NOT_FOUND; cross-org NOT_FOUND", async () => {
    const { org, mgr, w1, prop, ctx, base } = await setup();
    const { id } = await createSchedule(ctx(mgr.id), prop.id, base);
    await expect(listSchedules(ctx(w1.id), prop.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
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
```

Run: `pnpm test tests/services/schedule.test.ts` → FAIL.

- [ ] **Step 2: Implement**

Create `lib/services/schedule.ts`:

```ts
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
```

In `lib/services/member.ts` `removeMember`, inside the transaction before `propertyMember.deleteMany`, add:

```ts
      await tx.scheduleAssignee.deleteMany({ where: { userId, schedule: { orgId: ctx.orgId } } });
```

In `lib/services/property.ts` `removePropertyMember`, replace the single `deleteMany` with a transaction:

```ts
  await db.$transaction([
    db.scheduleAssignee.deleteMany({ where: { userId, schedule: { propertyId } } }),
    db.propertyMember.deleteMany({ where: { propertyId, userId } }),
  ]);
```

- [ ] **Step 3: Run and commit**

Run: `pnpm test tests/services/schedule.test.ts tests/services/member.test.ts tests/services/property.test.ts` then full `pnpm test`, `pnpm build`, `pnpm lint`.

```bash
git add lib/services/schedule.ts lib/services/member.ts lib/services/property.ts tests/services/schedule.test.ts
git commit -m "feat: add schedule service with validation and membership cleanup"
```

---

### Task 5: Tick service, push/email delivery, cron route

**Files:**
- Create: `lib/notifications/push.ts`, `lib/services/tick.ts`, `app/api/cron/tick/route.ts`, `scripts/push-keys.ts`
- Modify: `proxy.ts` (public `/api/cron/`), `.env.example`, `package.json` (deps, `push:keys` script)
- Test: `tests/services/tick.test.ts`, `tests/route/tick.test.ts`

**Interfaces:**
- Produces in `lib/notifications/push.ts`: `pushConfigured(): boolean`; `sendPush(sub: { endpoint; p256dh; auth }, payload: { title; body; url; tag }): Promise<"ok" | "gone">` (throws on other errors).
- Produces in `lib/services/tick.ts`:
  - `type TickResult = { skipped: true } | { generated: number; reminders: number; overdue: number; notified: number; errors: number; ms: number }`
  - `runTick(now = new Date()): Promise<TickResult>`
  - `generateForSchedule(schedule: ScheduleWithRelations, now: Date): Promise<number>` (instances created)
  - `sendReminders(now)`, `markOverdue(now)`, `drainOutbox(now)`; each returns a count.
- Route: `POST /api/cron/tick` → 401 / 200 JSON.

- [ ] **Step 1: Deps, env, script**

```bash
pnpm add web-push
pnpm add -D @types/web-push
```

Append to `.env.example`:

```
CRON_SECRET=change-me-openssl-rand-hex-32
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@example.com
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
# run `pnpm push:keys` and paste the pair into VAPID_*; NEXT_PUBLIC_VAPID_PUBLIC_KEY = VAPID_PUBLIC_KEY
```

Create `scripts/push-keys.ts`:

```ts
import webpush from "web-push";
const k = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}\nNEXT_PUBLIC_VAPID_PUBLIC_KEY=${k.publicKey}`);
```

Add script `"push:keys": "tsx scripts/push-keys.ts"`. Run it and put the values plus a random `CRON_SECRET` into your local `.env`.

In `proxy.ts` add `/^\/api\/cron\//` to `PUBLIC`.

- [ ] **Step 2: Push wrapper**

Create `lib/notifications/push.ts`:

```ts
import webpush from "web-push";

let configured = false;
export function pushConfigured() {
  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) return false;
  if (!configured) { webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY); configured = true; }
  return true;
}

/** Returns "gone" when the subscription is dead (404/410) so the caller can delete it. */
export async function sendPush(sub: { endpoint: string; p256dh: string; auth: string }, payload: { title: string; body: string; url: string; tag: string }) {
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { TTL: 3600 });
    return "ok" as const;
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    if (status === 404 || status === 410) return "gone" as const;
    throw e;
  }
}
```

- [ ] **Step 3: Failing tick tests**

Create `tests/services/tick.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { db } from "@/lib/db";
import { makeInstance, makeMember, makeOrg, makeProperty, makeSchedule, makeTemplate, makeUser } from "@/tests/helpers/db";

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
});

describe("reminders and overdue", () => {
  test("DUE_SOON within 60 min once; OVERDUE after due once; SUBMITTED excluded", async () => {
    const { org, mgr, w, prop } = await setup();
    const now = new Date("2026-03-10T12:00:00Z");
    const soon = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w.id, assignedById: mgr.id, dueAt: new Date("2026-03-10T12:30:00Z") });
    await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w.id, assignedById: mgr.id, dueAt: new Date("2026-03-10T14:00:00Z") });
    const late = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w.id, assignedById: mgr.id, dueAt: new Date("2026-03-10T11:00:00Z") });
    await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w.id, assignedById: mgr.id, dueAt: new Date("2026-03-10T11:00:00Z"), status: "SUBMITTED" });
    expect(await sendReminders(now)).toBe(1);
    expect(await sendReminders(now)).toBe(0);
    expect((await db.checklistInstance.findUniqueOrThrow({ where: { id: soon.id } })).remindedAt).not.toBeNull();
    expect(await markOverdue(now)).toBe(1);
    expect(await markOverdue(now)).toBe(0);
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
    expect(await drainOutbox(new Date())).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(mail).toHaveBeenCalledTimes(1);
    let n = await db.notification.findFirstOrThrow();
    expect([n.pushSentAt, n.emailSentAt].every(Boolean)).toBe(true);

    // preferences off → stamped without sending
    await db.user.update({ where: { id: w.id }, data: { notifyPush: false, notifyEmail: false } });
    await notify([{ orgId: org.id, userId: w.id, type: "OVERDUE", title: "t", body: "b", url: "/x" }]);
    send.mockClear(); mail.mockClear();
    expect(await drainOutbox(new Date())).toBe(1);
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
  const { org, mgr, w, prop, tpl } = await setup();
  await makeSchedule({ orgId: org.id, propertyId: prop.id, templateId: tpl.id, createdById: mgr.id, assigneeIds: [w.id], freq: "DAILY", dueTime: "23:59", startsOn: new Date("2026-01-01T00:00:00Z") });
  const [a, b] = await Promise.all([runTick(new Date()), runTick(new Date())]);
  const results = [a, b];
  expect(results.filter((r) => "skipped" in r)).toHaveLength(1);
  const done = results.find((r) => !("skipped" in r))!;
  expect(done).toMatchObject({ generated: expect.any(Number), errors: 0 });
  expect((done as { generated: number }).generated).toBeGreaterThanOrEqual(1);
});
```

Run: `pnpm test tests/services/tick.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement the tick**

Create `lib/services/tick.ts`:

```ts
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
```

`generateForSchedule` does not need any special handling for `endsOn`: `occurrencesBetween` already stops at `endsOn`.

- [ ] **Step 5: Route + route test**

Create `app/api/cron/tick/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { runTick } from "@/lib/services/tick";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret || header !== `Bearer ${secret}`) return new NextResponse(null, { status: 401 });
  const result = await runTick(new Date());
  return NextResponse.json(result);
}
```

Create `tests/route/tick.test.ts` (Vitest include already covers `tests/**`):

```ts
import { expect, test } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/cron/tick/route";

test("401 without the secret, 200 with counts", async () => {
  process.env.CRON_SECRET = "s3cret";
  const bad = await POST(new NextRequest("http://x/api/cron/tick", { method: "POST" }));
  expect(bad.status).toBe(401);
  const ok = await POST(new NextRequest("http://x/api/cron/tick", { method: "POST", headers: { authorization: "Bearer s3cret" } }));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toMatchObject({ generated: 0, errors: 0 });
});
```

If importing the route in Vitest fails on `next/server`, add `"next"` to `server.deps.inline` in `vitest.config.mts`.

- [ ] **Step 6: Run and commit**

Run: `pnpm test tests/services/tick.test.ts tests/route/tick.test.ts`, then `pnpm test`, `pnpm build`, `pnpm lint`. Also curl the route once: `pnpm dev` → `curl -s -o /dev/null -w "%{http_code}" -X POST localhost:3000/api/cron/tick` → 401; with `-H "Authorization: Bearer $CRON_SECRET"` → 200 JSON. Stop the server.

```bash
git add -A
git commit -m "feat: add cron tick with schedule generation, reminders, overdue, and delivery"
```

---

### Task 6: Organization timezone

**Files:**
- Modify: `lib/services/org.ts` (`setTimezone`), `lib/services/auth.ts` (`signup` takes `timezone?`), `actions/auth.schemas.ts` (`signupSchema.timezone`), `actions/auth.ts`, `actions/org.ts` (`setTimezoneAction`), `app/(auth)/signup/signup-form.tsx` (hidden timezone input), `app/(app)/settings/page.tsx`
- Create: `app/(app)/settings/timezone-form.tsx`, `lib/timezones.ts`
- Test: `tests/services/org.test.ts` (append), `tests/services/auth.test.ts` (append), `tests/unit/timezones.test.ts`

**Interfaces:**
- Produces: `isValidTimezone(tz: string): boolean` and `TIMEZONES: string[]` in `lib/timezones.ts`; `setTimezone(ctx, tz)` (OWNER); `signup({ ..., timezone? })` stores a valid tz or `UTC`; `setTimezoneAction({ timezone })`.

- [ ] **Step 1: Tests**

Create `tests/unit/timezones.test.ts`:

```ts
import { expect, test } from "vitest";
import { isValidTimezone, TIMEZONES } from "@/lib/timezones";
test("validates IANA names", () => {
  expect(isValidTimezone("Europe/Madrid")).toBe(true);
  expect(isValidTimezone("Mars/Olympus")).toBe(false);
  expect(TIMEZONES).toContain("UTC");
});
```

Append to `tests/services/org.test.ts` (import `setTimezone`):

```ts
test("setTimezone: owner only, must be valid", async () => {
  const u = await makeUser(); const mgr = await makeUser(); const org = await makeOrg();
  await makeMember(org.id, u.id, "OWNER"); await makeMember(org.id, mgr.id, "MANAGER");
  await expect(setTimezone({ userId: mgr.id, orgId: org.id }, "Europe/Madrid")).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(setTimezone({ userId: u.id, orgId: org.id }, "Nope/Nope")).rejects.toMatchObject({ code: "INVALID" });
  await setTimezone({ userId: u.id, orgId: org.id }, "Europe/Madrid");
  expect((await db.org.findUniqueOrThrow({ where: { id: org.id } })).timezone).toBe("Europe/Madrid");
});
```

Append to `tests/services/auth.test.ts` inside `describe("signup")`:

```ts
  test("stores a valid timezone, falls back to UTC", async () => {
    const a = await signup({ name: "A", email: "tz1@test.local", password: "secret123", orgName: "X", timezone: "Asia/Tokyo" });
    expect((await db.org.findUniqueOrThrow({ where: { id: a.orgId } })).timezone).toBe("Asia/Tokyo");
    const b = await signup({ name: "B", email: "tz2@test.local", password: "secret123", orgName: "Y", timezone: "Not/AZone" });
    expect((await db.org.findUniqueOrThrow({ where: { id: b.orgId } })).timezone).toBe("UTC");
  });
```

- [ ] **Step 2: Implement**

Create `lib/timezones.ts`:

```ts
export const TIMEZONES: string[] = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? ["UTC"];
const SET = new Set([...TIMEZONES, "UTC"]);
export const isValidTimezone = (tz: string) => SET.has(tz);
```

`lib/services/org.ts`:

```ts
export async function setTimezone(ctx: Ctx, timezone: string) {
  await requireOrgRole(ctx, "OWNER");
  if (!isValidTimezone(timezone)) throw invalid("Unknown timezone");
  await db.org.update({ where: { id: ctx.orgId }, data: { timezone } });
}
```

`lib/services/auth.ts` `signup`: add `timezone?: string` to the input type and use `timezone: input.timezone && isValidTimezone(input.timezone) ? input.timezone : "UTC"` in `tx.org.create`.

`actions/auth.schemas.ts`: add `timezone: z.string().max(64).optional()` to `signupSchema`. `actions/auth.ts` `signupAction` passes it through (it spreads `data` into `svc.signup` — confirm). `app/(auth)/signup/signup-form.tsx`: add `<input type="hidden" name="timezone" value={tz} />` where `const [tz] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone)`, and include `timezone: String(fd.get("timezone") || "")` in the action input.

`actions/org.ts`:

```ts
export async function setTimezoneAction(input: { timezone: string }) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.setTimezone(ctx, z.string().min(1).max(64).parse(input.timezone));
    revalidatePath("/settings");
  });
}
```

Create `app/(app)/settings/timezone-form.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { setTimezoneAction } from "@/actions/org";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

export function TimezoneForm({ timezone, options, unset }: { timezone: string; options: string[]; unset: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget);
      start(async () => { const r = await setTimezoneAction({ timezone: String(fd.get("timezone")) }); setError(r.ok ? null : r.error); setSaved(r.ok); }); }}
      className="max-w-md space-y-3">
      <h2 className="font-medium">Timezone</h2>
      {unset && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm">Schedules use this timezone. Confirm it for your organization.</p>}
      <div className="space-y-1">
        <Label htmlFor="timezone">Organization timezone</Label>
        <select id="timezone" name="timezone" defaultValue={timezone} className="w-full rounded-md border bg-background px-2 py-2 text-sm">
          {options.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
        </select>
      </div>
      <FormError message={error} />
      {saved && <p className="text-sm text-muted-foreground">Saved.</p>}
      <SubmitButton pending={pending}>Save timezone</SubmitButton>
    </form>
  );
}
```

`app/(app)/settings/page.tsx`: select `timezone` from the org; for OWNER render `<TimezoneForm timezone={org.timezone} options={TIMEZONES} unset={org.timezone === "UTC"} />` under `OrgForm` (import `TIMEZONES` from `@/lib/timezones`). The "unset" banner uses `UTC` as the sentinel since existing orgs were backfilled with it.

- [ ] **Step 3: Run and commit**

Run: `pnpm test tests/unit/timezones.test.ts tests/services/org.test.ts tests/services/auth.test.ts`; `pnpm build`; `pnpm lint`.

```bash
git add -A
git commit -m "feat: add organization timezone with signup detection and settings"
```

---

### Task 7: Actions and schemas for schedules and notifications

**Files:**
- Create: `actions/schedule.schemas.ts`, `actions/schedule.ts`, `actions/notification.schemas.ts`, `actions/notification.ts`
- Test: `tests/unit/scheduling-schemas.test.ts`

**Interfaces:**
- Produces:
  - `scheduleSchema` (`{ templateId, assigneeIds: string[], freq, daysOfWeek: number[], dayOfMonth: number|null, dueTime, startsOn: "YYYY-MM-DD", endsOn?: "YYYY-MM-DD"|"" }`) with a `.transform` producing `ScheduleInput` (dates → UTC midnight `Date`s).
  - `createScheduleAction(propertyId, input)` → redirects to `/properties/<propertyId>`; `updateScheduleAction(id, input)`; `pauseScheduleAction(id)`; `resumeScheduleAction(id)`; `deleteScheduleAction(id)` → redirects to the property.
  - `pushSubscriptionSchema`, `preferencesSchema`; `savePushSubscriptionAction(sub)`, `deletePushSubscriptionAction(endpoint)`, `setPreferencesAction(prefs)`, `markReadAction(id)`, `markAllReadAction()`.

- [ ] **Step 1: Schema test**

Create `tests/unit/scheduling-schemas.test.ts`:

```ts
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
```

- [ ] **Step 2: Schemas**

Create `actions/schedule.schemas.ts`:

```ts
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
```

Create `actions/notification.schemas.ts`:

```ts
import { z } from "zod";
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(1), auth: z.string().min(1) }),
  userAgent: z.string().max(300).optional(),
});
export const preferencesSchema = z.object({ notifyPush: z.boolean().optional(), notifyEmail: z.boolean().optional() });
```

- [ ] **Step 3: Actions**

Create `actions/schedule.ts`:

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { run } from "@/lib/actions";
import { requireUser } from "@/lib/auth/guard";
import * as svc from "@/lib/services/schedule";
import { scheduleSchema } from "@/actions/schedule.schemas";

export async function createScheduleAction(propertyId: string, input: z.input<typeof scheduleSchema>) {
  const result = await run(async () => {
    const ctx = await requireUser();
    await svc.createSchedule(ctx, propertyId, scheduleSchema.parse(input));
    revalidatePath(`/properties/${propertyId}`);
  });
  if (result.ok) redirect(`/properties/${propertyId}`);
  return result;
}

export async function updateScheduleAction(id: string, input: z.input<typeof scheduleSchema>) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.updateSchedule(ctx, id, scheduleSchema.parse(input));
    revalidatePath(`/schedules/${id}`);
  });
}

export async function pauseScheduleAction(id: string) {
  return run(async () => { const ctx = await requireUser(); await svc.pauseSchedule(ctx, id); revalidatePath(`/schedules/${id}`); revalidatePath("/properties", "layout"); });
}

export async function resumeScheduleAction(id: string) {
  return run(async () => { const ctx = await requireUser(); await svc.resumeSchedule(ctx, id); revalidatePath(`/schedules/${id}`); revalidatePath("/properties", "layout"); });
}

export async function deleteScheduleAction(id: string, propertyId: string) {
  const result = await run(async () => { const ctx = await requireUser(); await svc.deleteSchedule(ctx, id); revalidatePath(`/properties/${propertyId}`); });
  if (result.ok) redirect(`/properties/${propertyId}`);
  return result;
}
```

Create `actions/notification.ts`:

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { run } from "@/lib/actions";
import { requireUser } from "@/lib/auth/guard";
import * as svc from "@/lib/services/notification";
import { preferencesSchema, pushSubscriptionSchema } from "@/actions/notification.schemas";

export async function savePushSubscriptionAction(input: z.input<typeof pushSubscriptionSchema>) {
  return run(async () => { const ctx = await requireUser(); await svc.savePushSubscription(ctx, pushSubscriptionSchema.parse(input)); });
}
export async function deletePushSubscriptionAction(endpoint: string) {
  return run(async () => { const ctx = await requireUser(); await svc.deletePushSubscription(ctx, z.string().url().parse(endpoint)); });
}
export async function setPreferencesAction(input: z.input<typeof preferencesSchema>) {
  return run(async () => { const ctx = await requireUser(); await svc.setPreferences(ctx, preferencesSchema.parse(input)); revalidatePath("/settings"); });
}
export async function markReadAction(id: string) {
  return run(async () => { const ctx = await requireUser(); await svc.markRead(ctx, z.string().min(1).parse(id)); revalidatePath("/notifications"); revalidatePath("/", "layout"); });
}
export async function markAllReadAction() {
  return run(async () => { const ctx = await requireUser(); await svc.markAllRead(ctx); revalidatePath("/notifications"); revalidatePath("/", "layout"); });
}
```

- [ ] **Step 4: Run and commit**

Run: `pnpm test tests/unit`, `pnpm build`, `pnpm lint`.

```bash
git add actions tests/unit/scheduling-schemas.test.ts
git commit -m "feat: add schedule and notification server actions"
```

---

### Task 8: Schedule UI

**Files:**
- Create: `app/(app)/properties/[id]/schedules.tsx`, `app/(app)/properties/[id]/schedules/new/page.tsx`, `app/(app)/schedules/[id]/page.tsx`, `app/(app)/schedules/schedule-form.tsx`, `app/(app)/schedules/[id]/schedule-controls.tsx`
- Modify: `app/(app)/properties/[id]/page.tsx`, `app/(app)/checklists/[id]/page.tsx` ("From schedule" line)

**Interfaces:**
- Consumes: `listSchedules`, `getSchedule`, `ScheduleRow`, `listTemplates`, `getProperty` (members), schedule actions, `LocalTime`, `toLocalInputValue`.

- [ ] **Step 1: List section**

Create `app/(app)/properties/[id]/schedules.tsx`:

```tsx
import Link from "next/link";
import type { ScheduleRow } from "@/lib/services/schedule";
import { LocalTime } from "@/components/local-time";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";

export function PropertySchedules({ propertyId, schedules }: { propertyId: string; schedules: ScheduleRow[] }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Schedules</h2>
        <Button size="sm" render={<Link href={`/properties/${propertyId}/schedules/new`} />}>New schedule</Button>
      </div>
      <ul className="divide-y rounded-md border">
        {schedules.length === 0 && <li className="p-3 text-sm text-muted-foreground">No schedules.</li>}
        {schedules.map((s) => (
          <li key={s.id} className="p-3 text-sm">
            <Link href={`/schedules/${s.id}`} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">{s.name}</span> <span className="text-muted-foreground">· {s.description} · {s.assignees.map((a) => a.name).join(", ") || "no workers"}</span>
              </span>
              <span className="flex items-center gap-2 text-muted-foreground">
                {s.pausedAt && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Paused</span>}
                {s.assignees.length === 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">No assignees</span>}
                {s.templateArchived && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">Archived template</span>}
                {s.nextAt && <>next <LocalTime iso={s.nextAt.toISOString()} fallback={formatDateTime(s.nextAt)} /></>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Form (client)**

Create `app/(app)/schedules/schedule-form.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { createScheduleAction, updateScheduleAction } from "@/actions/schedule";
import type { ScheduleFormInput } from "@/actions/schedule.schemas";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

type Opt = { id: string; name: string };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function ScheduleForm({ propertyId, templates, workers, schedule }: {
  propertyId: string; templates: Opt[]; workers: Opt[];
  schedule?: { id: string; templateId: string; assigneeIds: string[]; freq: "DAILY" | "WEEKLY" | "MONTHLY"; daysOfWeek: number[]; dayOfMonth: number | null; dueTime: string; startsOn: Date; endsOn: Date | null };
}) {
  const [freq, setFreq] = useState<ScheduleFormInput["freq"]>(schedule?.freq ?? "DAILY");
  const [days, setDays] = useState<number[]>(schedule?.daysOfWeek ?? []);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  const today = useState(() => ymd(new Date()))[0];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const input: ScheduleFormInput = {
          templateId: String(fd.get("templateId")), assigneeIds: fd.getAll("assigneeIds").map(String), freq,
          daysOfWeek: freq === "WEEKLY" ? days : [], dayOfMonth: freq === "MONTHLY" ? Number(fd.get("dayOfMonth")) : null,
          dueTime: String(fd.get("dueTime")), startsOn: String(fd.get("startsOn")), endsOn: String(fd.get("endsOn") ?? ""),
        };
        start(async () => {
          const r = schedule ? await updateScheduleAction(schedule.id, input) : await createScheduleAction(propertyId, input);
          if (r && !r.ok) { setError(r.error); setSaved(false); } else { setError(null); setSaved(true); }
        });
      }}
      className="max-w-md space-y-4"
    >
      <div className="space-y-1">
        <Label htmlFor="templateId">Template</Label>
        <select id="templateId" name="templateId" defaultValue={schedule?.templateId} className="w-full rounded-md border bg-background px-2 py-2 text-sm" required>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Workers</legend>
        {workers.map((w) => (
          <label key={w.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="assigneeIds" value={w.id} defaultChecked={schedule?.assigneeIds.includes(w.id)} /> {w.name}</label>
        ))}
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Repeats</legend>
        <div className="flex gap-3 text-sm">
          {(["DAILY", "WEEKLY", "MONTHLY"] as const).map((f) => (
            <label key={f} className="flex items-center gap-1"><input type="radio" name="freq" value={f} checked={freq === f} onChange={() => setFreq(f)} /> {f[0] + f.slice(1).toLowerCase()}</label>
          ))}
        </div>
        {freq === "WEEKLY" && (
          <div className="flex flex-wrap gap-1">
            {DAYS.map((d, i) => (
              <button type="button" key={d} aria-pressed={days.includes(i)} onClick={() => setDays((xs) => (xs.includes(i) ? xs.filter((x) => x !== i) : [...xs, i]))}
                className={`rounded-md border px-2 py-1 text-sm ${days.includes(i) ? "bg-primary text-primary-foreground" : ""}`}>{d}</button>
            ))}
          </div>
        )}
        {freq === "MONTHLY" && (
          <div className="space-y-1"><Label htmlFor="dayOfMonth">Day of month</Label><Input id="dayOfMonth" name="dayOfMonth" type="number" min={1} max={31} defaultValue={schedule?.dayOfMonth ?? 1} className="w-24" required /></div>
        )}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label htmlFor="dueTime">Due time</Label><Input id="dueTime" name="dueTime" type="time" defaultValue={schedule?.dueTime ?? "09:00"} required /></div>
        <div className="space-y-1"><Label htmlFor="startsOn">Starts on</Label><Input id="startsOn" name="startsOn" type="date" defaultValue={schedule ? ymd(schedule.startsOn) : today} required /></div>
        <div className="space-y-1"><Label htmlFor="endsOn">Ends on</Label><Input id="endsOn" name="endsOn" type="date" defaultValue={schedule?.endsOn ? ymd(schedule.endsOn) : ""} /></div>
      </div>
      <FormError message={error} />
      {saved && schedule && <p className="text-sm text-muted-foreground">Saved. Changes apply to future occurrences.</p>}
      <SubmitButton pending={pending}>{schedule ? "Save" : "Create schedule"}</SubmitButton>
    </form>
  );
}
```

- [ ] **Step 3: Pages**

Create `app/(app)/properties/[id]/schedules/new/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireUser, requireOrgRole } from "@/lib/auth/guard";
import { getProperty } from "@/lib/services/property";
import { listTemplates } from "@/lib/services/template";
import { AppError } from "@/lib/errors";
import { Forbidden } from "@/components/forbidden";
import { ScheduleForm } from "@/app/(app)/schedules/schedule-form";

export default async function NewSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireUser();
  try { await requireOrgRole(ctx, "MANAGER"); } catch (e) { if (e instanceof AppError && e.code === "FORBIDDEN") return <Forbidden />; throw e; }
  let property;
  try { property = await getProperty(ctx, id); } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
  const templates = await listTemplates(ctx);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">New schedule · {property.name}</h1>
      <ScheduleForm propertyId={property.id} templates={templates.map((t) => ({ id: t.id, name: t.name }))} workers={property.members.map((m) => ({ id: m.userId, name: m.name }))} />
    </div>
  );
}
```

Create `app/(app)/schedules/[id]/schedule-controls.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { deleteScheduleAction, pauseScheduleAction, resumeScheduleAction } from "@/actions/schedule";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";

export function ScheduleControls({ id, propertyId, paused }: { id: string; propertyId: string; paused: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string } | undefined>) => start(async () => { const r = await fn(); if (r && !r.ok) setError(r.error ?? "Failed"); });
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" disabled={pending} onClick={() => act(() => (paused ? resumeScheduleAction(id) : pauseScheduleAction(id)))}>{paused ? "Resume" : "Pause"}</Button>
      <Button variant="destructive" size="sm" disabled={pending} onClick={() => { if (confirm("Delete this schedule? Existing checklists are kept.")) act(() => deleteScheduleAction(id, propertyId)); }}>Delete</Button>
      <FormError message={error} />
    </div>
  );
}
```

Create `app/(app)/schedules/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guard";
import { getSchedule } from "@/lib/services/schedule";
import { getProperty } from "@/lib/services/property";
import { listTemplates } from "@/lib/services/template";
import { AppError } from "@/lib/errors";
import { Forbidden } from "@/components/forbidden";
import { ScheduleForm } from "../schedule-form";
import { ScheduleControls } from "./schedule-controls";

export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireUser();
  let s;
  try { s = await getSchedule(ctx, id); } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") return <Forbidden />;
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const [property, templates] = await Promise.all([getProperty(ctx, s.propertyId), listTemplates(ctx, { includeArchived: true })]);
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground"><Link href={`/properties/${s.propertyId}`} className="underline">{property.name}</Link></p>
        <h1 className="text-xl font-semibold">{s.name}{s.pausedAt ? " (paused)" : ""}</h1>
        <p className="text-sm text-muted-foreground">{s.description}</p>
      </div>
      <ScheduleControls id={s.id} propertyId={s.propertyId} paused={!!s.pausedAt} />
      <ScheduleForm propertyId={s.propertyId} templates={templates.map((t) => ({ id: t.id, name: t.name }))} workers={property.members.map((m) => ({ id: m.userId, name: m.name }))}
        schedule={{ id: s.id, templateId: s.templateId, assigneeIds: s.assignees.map((a) => a.userId), freq: s.freq, daysOfWeek: s.daysOfWeek, dayOfMonth: s.dayOfMonth, dueTime: s.dueTime, startsOn: s.startsOn, endsOn: s.endsOn }} />
    </div>
  );
}
```

`app/(app)/properties/[id]/page.tsx`: when `canEdit`, load `const schedules = await listSchedules(ctx, id)` and render `<PropertySchedules propertyId={property.id} schedules={schedules} />` between the Checklists section and the Assign form.

`app/(app)/checklists/[id]/page.tsx`: `getInstance` should expose `scheduleName: string | null` — add to the service's `getInstance` include `schedule: { select: { name: true } }` and return `scheduleName: r.schedule?.name ?? null`; render `From schedule: {name}` under the due line when present.

- [ ] **Step 4: Verify and commit**

`pnpm build && pnpm lint && pnpm test`. `pnpm dev` as manager: create a weekly schedule on Villa Azul (Mon/Wed 09:00), see it listed with "next", pause/resume, edit assignees, delete. 375 px Playwright screenshot of the form to the SDD workspace. Stop the server.

```bash
git add -A
git commit -m "feat: add schedule pages and property schedule list"
```

---

### Task 9: Notifications UI, service worker push, settings toggles

**Files:**
- Create: `components/notification-bell.tsx`, `app/(app)/notifications/page.tsx`, `app/(app)/notifications/notification-list.tsx`, `app/(app)/settings/notification-prefs.tsx`, `lib/client/push.ts`
- Modify: `app/(app)/layout.tsx` (bell in header), `app/(app)/settings/page.tsx`, `app/sw.ts`

**Interfaces:**
- Consumes: `unreadCount`, `listMine`, `getPreferences`, notification actions, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
- Produces: `subscribeToPush(): Promise<PushSubscriptionJSON | null>` and `currentPushSubscription()` in `lib/client/push.ts`.

- [ ] **Step 1: Bell**

Create `components/notification-bell.tsx` (server component):

```tsx
import Link from "next/link";

export function NotificationBell({ unread }: { unread: number }) {
  const label = unread > 99 ? "99+" : String(unread);
  return (
    <Link href="/notifications" aria-label={`Notifications, ${unread} unread`} className="relative rounded-md px-2 py-1 text-sm">
      <span aria-hidden>🔔</span>
      {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-destructive px-1.5 text-[10px] font-medium text-white">{label}</span>}
    </Link>
  );
}
```

In `app/(app)/layout.tsx`: `const unread = await unreadCount({ userId, orgId: active.id });` (import from `@/lib/services/notification`) and render `<div className="flex items-center gap-3"><NotificationBell unread={unread} /><span className="text-xs uppercase text-muted-foreground">{active.role}</span></div>` in place of the role span.

- [ ] **Step 2: Inbox page**

Create `app/(app)/notifications/notification-list.tsx`:

```tsx
"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markAllReadAction, markReadAction } from "@/actions/notification";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/local-time";

type Row = { id: string; type: string; title: string; body: string; url: string; createdAt: string; readAt: string | null; createdLabel: string };

export function NotificationList({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Notifications</h1>
        <Button variant="outline" size="sm" disabled={pending || rows.every((r) => r.readAt)} onClick={() => start(async () => { await markAllReadAction(); router.refresh(); })}>Mark all read</Button>
      </div>
      <ul className="divide-y rounded-md border">
        {rows.length === 0 && <li className="p-3 text-sm text-muted-foreground">No notifications.</li>}
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" className={`flex w-full flex-col items-start gap-0.5 p-3 text-left text-sm ${r.readAt ? "text-muted-foreground" : ""}`}
              onClick={() => start(async () => { if (!r.readAt) await markReadAction(r.id); router.push(r.url); })}>
              <span className={r.readAt ? "" : "font-medium"}>{r.title}</span>
              {r.body && <span className="text-muted-foreground">{r.body}</span>}
              <span className="text-xs text-muted-foreground"><LocalTime iso={r.createdAt} fallback={r.createdLabel} /></span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Create `app/(app)/notifications/page.tsx`:

```tsx
import { requireUser } from "@/lib/auth/guard";
import { listMine } from "@/lib/services/notification";
import { formatDateTime } from "@/lib/format";
import { NotificationList } from "./notification-list";

export default async function NotificationsPage() {
  const ctx = await requireUser();
  const rows = await listMine(ctx);
  return <NotificationList rows={rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), readAt: r.readAt?.toISOString() ?? null, createdLabel: formatDateTime(r.createdAt) }))} />;
}
```

- [ ] **Step 3: Client push helper and settings toggles**

Create `lib/client/push.ts`:

```ts
function urlBase64ToUint8Array(s: string) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export async function currentPushSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function subscribeToPush(vapidPublicKey: string) {
  if (!pushSupported()) throw new Error("Push is not supported in this browser");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notification permission was not granted");
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) });
}
```

Create `app/(app)/settings/notification-prefs.tsx`:

```tsx
"use client";
import { useEffect, useState, useTransition } from "react";
import { deletePushSubscriptionAction, savePushSubscriptionAction, setPreferencesAction } from "@/actions/notification";
import { currentPushSubscription, pushSupported, subscribeToPush } from "@/lib/client/push";
import { FormError } from "@/components/form-error";

export function NotificationPrefs({ notifyPush, notifyEmail, hasEmail, vapidKey }: { notifyPush: boolean; notifyEmail: boolean; hasEmail: boolean; vapidKey: string }) {
  const [error, setError] = useState<string | null>(null);
  const [deviceSubscribed, setDeviceSubscribed] = useState<boolean | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => { currentPushSubscription().then((s) => setDeviceSubscribed(!!s)).catch(() => setDeviceSubscribed(false)); }, []);

  const toggleDevice = () => start(async () => {
    try {
      setError(null);
      if (deviceSubscribed) {
        const sub = await currentPushSubscription();
        if (sub) { await deletePushSubscriptionAction(sub.endpoint); await sub.unsubscribe(); }
        setDeviceSubscribed(false);
      } else {
        const sub = await subscribeToPush(vapidKey);
        const json = sub.toJSON();
        const r = await savePushSubscriptionAction({ endpoint: json.endpoint!, keys: { p256dh: json.keys!.p256dh, auth: json.keys!.auth }, userAgent: navigator.userAgent.slice(0, 300) });
        if (!r.ok) throw new Error(r.error);
        setDeviceSubscribed(true);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
  });

  const setPref = (p: { notifyPush?: boolean; notifyEmail?: boolean }) => start(async () => { const r = await setPreferencesAction(p); if (!r.ok) setError(r.error); });

  return (
    <section className="max-w-md space-y-3">
      <h2 className="font-medium">Notifications</h2>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" defaultChecked={notifyPush} disabled={pending} onChange={(e) => setPref({ notifyPush: e.target.checked })} /> Push notifications</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" defaultChecked={notifyEmail} disabled={pending || !hasEmail} onChange={(e) => setPref({ notifyEmail: e.target.checked })} /> Email notifications{!hasEmail && <span className="text-muted-foreground"> (no email on your profile)</span>}</label>
      {pushSupported() && vapidKey ? (
        <button type="button" disabled={pending || deviceSubscribed === null} onClick={toggleDevice} className="rounded-md border px-3 py-2 text-sm">
          {deviceSubscribed ? "Disable push on this device" : "Enable push on this device"}
        </button>
      ) : <p className="text-sm text-muted-foreground">Push is unavailable in this browser. On iPhone, install the app to the Home Screen first.</p>}
      <FormError message={error} />
    </section>
  );
}
```

`app/(app)/settings/page.tsx`: load `const prefs = await getPreferences(ctx)` and the user's `email`; render `<NotificationPrefs notifyPush={prefs.notifyPush} notifyEmail={prefs.notifyEmail} hasEmail={!!user.email} vapidKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""} />` above the password form.

- [ ] **Step 4: Service worker handlers**

Append to `app/sw.ts` before `serwist.addEventListeners()`:

```ts
self.addEventListener("push", (event) => {
  const data = (() => { try { return event.data?.json() as { title: string; body: string; url: string; tag: string }; } catch { return null; } })();
  if (!data) return;
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, tag: data.tag, data: { url: data.url }, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png" }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/today";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const target = new URL(url, self.location.origin).href;
    for (const c of all) { if (c.url === target && "focus" in c) return c.focus(); }
    if (all[0] && "navigate" in all[0]) { await all[0].navigate(target); return all[0].focus(); }
    return self.clients.openWindow(target);
  })());
});
```

- [ ] **Step 5: Verify and commit**

`pnpm build` (webpack, bundles sw.ts) and `pnpm lint`, `pnpm test`. `pnpm build && pnpm start`: as Wendy open Settings → "Enable push on this device" in headless Chromium will be denied (no permission UI) — assert the error message renders; then verify the round trip with a script: call `savePushSubscriptionAction` through the UI is not possible headless, so instead run `pnpm test tests/services/notification.test.ts` (already covers save) and, with `pnpm dev`, create a notification row via a throwaway `pnpm tsx` script for Wendy, load `/` → bell shows 1, open `/notifications`, click it → marked read and navigated. Stop servers.

```bash
git add -A
git commit -m "feat: add notification inbox, bell, push subscription toggle, and service worker handlers"
```

---

### Task 10: Compose cron sidecar, CI, README, e2e

**Files:**
- Modify: `docker-compose.yml`, `.github/workflows/ci.yml`, `README.md`, `.env.example` (done in Task 5), `e2e/smoke.spec.ts` (only if a locator broke)
- Create: `e2e/schedule.spec.ts`

- [ ] **Step 1: Compose sidecar**

Add under `services` in `docker-compose.yml`:

```yaml
  cron:
    image: curlimages/curl:latest
    profiles: [app]
    depends_on: [app]
    environment:
      CRON_SECRET: ${CRON_SECRET}
    command: >
      sh -c 'while true; do
        curl -fsS -X POST -H "Authorization: Bearer $$CRON_SECRET" http://app:3000/api/cron/tick || echo tick failed;
        sleep 300; done'
```

Add `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` to the `app` service `environment` via `${VAR:-}`. Note: `NEXT_PUBLIC_*` is inlined at build time; the Dockerfile build stage needs `ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `ENV` before `pnpm build`, and compose passes it under `build.args`. Add both.

- [ ] **Step 2: CI**

In the `.env` construction step append `CRON_SECRET=ci-secret` and VAPID lines generated on the fly: `pnpm push:keys >> .env` (it prints `KEY=value` lines) plus `VAPID_SUBJECT=mailto:ci@example.com`. Ensure `pnpm push:keys` runs after install and before `.env` is consumed by build/e2e.

- [ ] **Step 3: E2E**

Create `e2e/schedule.spec.ts`:

```ts
import "dotenv/config";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL_TEST }) });
test.afterAll(async () => { await db.$disconnect(); });
const stamp = Date.now();
const ownerEmail = `sc-owner${stamp}@test.local`;
const workerEmail = `sc-worker${stamp}@test.local`;

test("schedule → tick → worker sees today's checklist; email toggle persists", async ({ page, browser, request }) => {
  await page.goto("/signup");
  await page.fill("#orgName", `SC Org ${stamp}`); await page.fill("#name", "Owner"); await page.fill("#email", ownerEmail); await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Properties" })).toBeVisible();
  await page.getByRole("link", { name: "New property" }).click();
  await page.fill("#name", "Villa SC"); await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Villa SC" })).toBeVisible();
  const propertyUrl = page.url();
  await page.goto("/team");
  await page.fill("#email", workerEmail); await page.selectOption("#role", "WORKER"); await page.getByLabel("Villa SC").check(); await page.click("button[type=submit]");
  const invite = await db.invite.findFirstOrThrow({ where: { email: workerEmail } });
  const wctx = await browser.newContext(); const worker = await wctx.newPage();
  await worker.goto(`/invite/${invite.token}`); await worker.fill("#name", "Worker"); await worker.fill("#password", "password123"); await worker.click("button[type=submit]");
  await expect(worker.getByRole("heading", { name: "Today" })).toBeVisible();

  await page.goto("/templates/new");
  await page.fill("#name", `Daily E2E ${stamp}`); await page.getByLabel("Item label").first().fill("Beds"); await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: `Daily E2E ${stamp}` })).toBeVisible();

  await page.goto(`${propertyUrl}/schedules/new`);
  await page.selectOption("#templateId", { label: `Daily E2E ${stamp}` });
  await page.getByLabel("Worker").check();
  await page.fill("#dueTime", "23:59");
  await page.click("button[type=submit]");
  await expect(page.getByText("Daily at 23:59")).toBeVisible();

  const tick = await request.post("/api/cron/tick", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
  expect(tick.ok()).toBe(true);
  expect((await tick.json()).generated).toBeGreaterThanOrEqual(1);

  await worker.goto("/today");
  await expect(worker.getByRole("link", { name: new RegExp(`Daily E2E ${stamp}`) })).toBeVisible();
  await worker.goto("/notifications");
  await expect(worker.getByText(`New checklist: Daily E2E ${stamp} at Villa SC`)).toBeVisible();

  await worker.goto("/settings");
  await worker.getByLabel("Email notifications").uncheck();
  await worker.reload();
  await expect(worker.getByLabel("Email notifications")).not.toBeChecked();
  await wctx.close();
});
```

The Playwright `webServer` inherits `.env`, so `CRON_SECRET` from your local `.env` reaches both the server and the test. Confirm `.env` has it.

- [ ] **Step 4: README**

Add a "Schedules and notifications" section: how schedules work (org timezone, occurrences created at the start of the due day, catch-up 14 days), the tick endpoint and how to call it (`curl -X POST -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/tick`), the compose `cron` service, a crontab line (`*/5 * * * * curl -fsS -X POST -H "Authorization: Bearer …" https://…/api/cron/tick`), a GitHub Actions `schedule` snippet, push setup (`pnpm push:keys`, HTTPS required, iOS needs the installed app), and the manual push verification checklist (install app on a phone over HTTPS, enable push in Settings, assign a checklist, expect a notification within one tick).

- [ ] **Step 5: Full check and commit**

Run: `pnpm lint && pnpm test && pnpm build && pnpm e2e` (4 e2e tests expected: smoke, checklist flow, photo, schedule).

```bash
git add -A
git commit -m "feat: add cron sidecar, CI push keys, docs, and schedule e2e"
```
