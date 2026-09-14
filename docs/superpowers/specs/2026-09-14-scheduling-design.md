# Checkly — Sub-project 3: Scheduling and Notifications

Date: 2026-09-14
Status: approved design, awaiting implementation plan
Builds on: foundation (`2026-09-12-foundation-design.md`) and checklists (`2026-09-14-checklists-design.md`), both merged to main.

## Product context

Managers define recurring schedules (daily, weekly on chosen days, monthly on a date, with a due time in the organization's timezone). A periodic tick creates the day's checklist instances through the existing `assign` entry point and delivers notifications (in-app, web push, email) for the events users care about. Nothing here changes how checklists are filled or reviewed.

Decisions carried over: online only; fixed roles OWNER > MANAGER > WORKER; services own authorization; org id from the session; Resend for email; installed PWA with a Serwist service worker.

## Scope

In scope:

- Organization timezone (IANA), set at signup from the browser, editable by owners.
- Schedules per property: template, workers, frequency (DAILY, WEEKLY with days, MONTHLY with day-of-month), due time, start date, optional end date, pause/resume, delete. Editing applies to future occurrences only.
- Tick endpoint `POST /api/cron/tick` protected by a secret, run by external cron every 5 minutes; idempotent generation with a per-occurrence ledger; catch-up capped at 14 days.
- Notifications as an outbox and inbox: ASSIGNED, DUE_SOON (60 min before), OVERDUE (once), REJECTED, APPROVED to the worker; SUBMITTED to managers with access to the property and to owners.
- Channels: in-app (bell + `/notifications`), web push (VAPID, `web-push`), email (Resend). Per-user toggles for push and email. Push subscriptions per device.
- Compose `cron` sidecar; README for crontab and GitHub Actions alternatives.

Out of scope:

- Per-property timezones; arbitrary RRULE/cron recurrence; per-schedule lead time; quiet hours; SMS; notification digests; manager overdue alerts; in-process schedulers; multi-region.

## Data model

```
Org               + timezone String @default("UTC")
User              + notifyPush Boolean @default(true), notifyEmail Boolean @default(true)

enum ScheduleFreq      { DAILY WEEKLY MONTHLY }
enum NotificationType  { ASSIGNED DUE_SOON OVERDUE REJECTED APPROVED SUBMITTED }

Schedule          id, orgId, propertyId, templateId, createdById, name (template name copied at creation),
                  freq ScheduleFreq, daysOfWeek Int[] (0=Sunday..6, WEEKLY only, else empty),
                  dayOfMonth Int? (1..31, MONTHLY only), dueTime String ("HH:mm" in org timezone),
                  startsOn DateTime (calendar date, stored as UTC midnight), endsOn DateTime? (same),
                  pausedAt DateTime?, createdAt, updatedAt
                  org Cascade; property Cascade; template Restrict; createdBy Restrict
                  @@index(orgId, propertyId)
ScheduleAssignee  id, scheduleId (Cascade), userId (Cascade)   @@unique(scheduleId, userId)
ScheduleRun       id, scheduleId (Cascade), occurrenceDate DateTime (calendar date as UTC midnight),
                  instanceIds String[], createdAt     @@unique(scheduleId, occurrenceDate)
ChecklistInstance + scheduleId String? (SetNull), remindedAt DateTime?, overdueNotifiedAt DateTime?
PushSubscription  id, userId (Cascade), endpoint String @unique, p256dh, auth, userAgent?, createdAt, lastUsedAt?
Notification      id, orgId (Cascade), userId (Cascade), type NotificationType, instanceId? (SetNull),
                  title, body, url, createdAt, readAt?, pushSentAt?, emailSentAt?, attempts Int @default(0), error?
                  @@index(userId, readAt) @@index(pushSentAt) @@index(emailSentAt)
```

Rules:

- Schedule assignees must be PropertyMembers of the schedule's property (INVALID otherwise). Removing a user from a property or org deletes their `ScheduleAssignee` rows (inside the existing removal transactions). A schedule with zero assignees generates nothing and shows a warning badge.
- Deleting a schedule keeps already-created instances (`scheduleId` becomes null). Deleting a property cascades schedules. A template referenced by a schedule cannot be hard-deleted; archive it (archived templates stop generation with a warning badge on the schedule).
- `occurrenceDate` is the local calendar date of the occurrence in the org timezone, normalized to UTC midnight for storage. The instance's `dueAt` is that date at `dueTime` in the org timezone, converted to UTC.
- `Notification` is both inbox and outbox: one row per recipient per event. Channel timestamps record delivery or a deliberate skip.
- Org timezone: set at signup from `Intl.DateTimeFormat().resolvedOptions().timeZone`; must be in `Intl.supportedValuesOf("timeZone")`; existing orgs default to `UTC` and owners see a Settings banner until they confirm one.

## Tick and generation

Route `POST /api/cron/tick` with header `Authorization: Bearer <CRON_SECRET>`; listed as public in `proxy.ts`. Missing or wrong secret → 401 with no body. Response `{ skipped?: true } | { generated, notified, reminders, overdue, errors, ms }`.

Steps, all inside a Postgres advisory lock (`pg_try_advisory_lock` on a fixed key; if not acquired return `{ skipped: true }`):

1. **Generate.** For each schedule that is not paused, `startsOn <= today` and (`endsOn` null or `>= today`), with at least one assignee and a non-archived template: compute local today in the org timezone; walk from `max(lastRun.occurrenceDate + 1 day, startsOn, today - 14 days)` to today; for each date the rule matches (DAILY: every day; WEEKLY: weekday in `daysOfWeek`; MONTHLY: day equals `min(dayOfMonth, daysInMonth)`), in one transaction insert the `ScheduleRun` (skip on unique conflict), call the internal assign routine with `dueAt = zonedTimeToUtc(date + dueTime, tz)` and `scheduleId`, and store the instance ids. Dates older than the 14-day cap are logged and skipped.
2. **Reminders.** Instances with status OPEN or REJECTED, `remindedAt` null, `dueAt` between now and now + 60 min → create DUE_SOON notifications for the assignee, set `remindedAt`.
3. **Overdue.** Instances with status OPEN or REJECTED, `overdueNotifiedAt` null, `dueAt < now` → OVERDUE notifications, set `overdueNotifiedAt`.
4. **Drain outbox.** See Delivery.

The tick uses internal functions that take `orgId` explicitly (no session). Each schedule and each notification is processed in its own try/catch; errors are counted, logged with ids, and never abort the tick. A failed occurrence leaves no `ScheduleRun` row and retries next tick.

Event notifications outside the tick are written synchronously by the services: ASSIGNED in `assign` (manual and scheduled), REJECTED and APPROVED in `review`, SUBMITTED in `submit` (recipients: OWNERs of the org plus MANAGERs who are members of the property, excluding the submitter). Delivery always happens in the tick's drain, so request paths never wait on push or email.

Timezone math uses `date-fns` and `date-fns-tz` (`toZonedTime`, `fromZonedTime`).

## Delivery

Outbox drain (in the tick): rows with `pushSentAt` null or `emailSentAt` null, `createdAt` within 24 h, `attempts < 3`, batch of 200, oldest first.

- Push: send when `user.notifyPush` and the user has subscriptions; payload `{ title, body, url, tag: id }` via `web-push` with VAPID keys. 404 or 410 from the push service deletes that subscription. If push is off or there are no subscriptions, stamp `pushSentAt` anyway (deliberate skip).
- Email: send when `user.notifyEmail` and `user.email`; plain template with title, body, and a button to `APP_URL + url` via the existing `sendMail`. Otherwise stamp `emailSentAt`.
- On failure: increment `attempts`, store `error`, leave the stamp null; after 3 attempts the row is stamped and the error kept.
- Service worker (`app/sw.ts`): `push` handler shows the notification; `notificationclick` focuses an open client at `url` or opens it.
- Client: Settings has a push toggle that requests permission, subscribes with `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, and saves `{ endpoint, keys }`; unsubscribing deletes the row. HTTPS (or localhost) required; iOS requires the installed PWA.
- In-app: header bell with unread count (`readAt` null, shown as 99+ above 99); `/notifications` lists the latest 50 with type, title, body, time; opening one marks it read and navigates to `url`; "Mark all read" button.

Copy (worker unless noted): ASSIGNED "New checklist: {template} at {property}, due {time}"; DUE_SOON "Due in 1 hour: {template} at {property}"; OVERDUE "Overdue: {template} at {property}"; REJECTED "Needs rework: {template} at {property} — {comment}"; APPROVED "Approved: {template} at {property}"; SUBMITTED (managers) "{worker} submitted {template} at {property}". `url` is `/checklists/<id>`. Times in copy use the org timezone.

## Services and routes

```
lib/services/schedule.ts
  listSchedules(ctx, propertyId)                 requirePropertyAccess; MANAGER+ sees all; WORKER sees none (schedules are manager UI)
  getSchedule(ctx, id)                           MANAGER+ with property access; NOT_FOUND otherwise
  createSchedule(ctx, input) / updateSchedule(ctx, id, input)   MANAGER+; validation below
  pauseSchedule / resumeSchedule / deleteSchedule(ctx, id)      MANAGER+
lib/schedule.ts (pure)
  occurrencesBetween(rule, tz, fromDate, toDate): LocalDate[]
  nextOccurrence(rule, tz, from: Date): Date | null
  describeRule(rule): string   e.g. "Weekly on Mon, Wed at 09:00"
  dueAtFor(localDate, dueTime, tz): Date
lib/services/tick.ts
  runTick(now = new Date()): TickResult    (advisory lock, steps 1–4)
lib/services/notification.ts
  notify(rows: { orgId, userId, type, instanceId?, title, body, url }[])   insert
  listMine(ctx, limit=50), unreadCount(ctx), markRead(ctx, id), markAllRead(ctx)
  savePushSubscription(ctx, sub), deletePushSubscription(ctx, endpoint), setPreferences(ctx, { notifyPush?, notifyEmail? })
lib/services/org.ts
  setTimezone(ctx, tz)    OWNER
app/api/cron/tick/route.ts
```

Validation: WEEKLY requires 1–7 distinct days in 0..6; MONTHLY requires `dayOfMonth` 1..31; DAILY has neither; `dueTime` matches `^([01]\d|2[0-3]):[0-5]\d$`; `endsOn >= startsOn`; at least one assignee, all property members; template in org and not archived.

## UI and routes

Manager:

```
/(app)/properties/[id]                    new "Schedules" section under Checklists: rows show template name,
                                          describeRule, assignee names, next occurrence, Paused/No assignees/
                                          Archived template badges; Pause/Resume and Delete buttons; "New schedule" link
/(app)/properties/[id]/schedules/new      form: template, workers (property members), frequency radio, weekday chips,
                                          day-of-month input, due time, starts on (default today), ends on (optional)
/(app)/schedules/[id]                     same form for editing (future occurrences only), Pause/Resume, Delete
/(app)/settings                           owner: timezone select from Intl.supportedValuesOf("timeZone"), banner until set
```

Everyone:

```
/(app)/settings                           Notifications: push toggle (this device), email toggle
/(app)/notifications                      list, mark all read
header                                    bell with unread count
```

Instance detail shows "From schedule: {name}" when `scheduleId` is set. Today page unchanged.

## Errors

- Same `ActionResult` contract; zod validation on every action; service INVALID messages as above.
- Tick: per-item isolation, counts in the response, ids in logs; 401 on bad secret.
- Push subscription save validates an https endpoint and base64url keys.
- Invalid timezone → INVALID.

## Testing

- Unit (`tests/unit/schedule.test.ts`): occurrences for DAILY, WEEKLY, MONTHLY including month-end clamp (31 → Feb 28/29), a DST transition in Europe/Madrid, catch-up cap, `describeRule`, `nextOccurrence`, `dueAtFor`.
- Services on Postgres: schedule CRUD, validation, permissions (worker forbidden, manager without property access NOT_FOUND, cross-org NOT_FOUND); `runTick` generation idempotency (two ticks → one instance per assignee per date), pause, endsOn, backlog (previous open, next still generated), zero assignees skipped; reminder and overdue windows and one-shot flags; notification creation and recipients on assign/submit/review; outbox drain stamping, retry to 3 attempts, subscription deletion on 410 (`web-push` mocked at the module boundary — the only mock in the suite); preferences respected; markRead scoping.
- Route test: 401 without secret, 200 with counts, `skipped` while the lock is held.
- Playwright: manager creates a weekly schedule for today's weekday with a due time 2 h ahead; test calls the tick with the secret; worker's Today shows the instance; manager's Schedules section shows the next occurrence; toggling email preference persists. Push subscription is verified manually (README checklist).

## Ops and rollout

- Env: `CRON_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto:), `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Script `pnpm push:keys` prints a key pair.
- Compose: `cron` service under the `app` profile (`curlimages/curl` loop every 5 min calling the app service). README shows crontab and GitHub Actions `schedule` alternatives and states that push needs HTTPS in production.
- Migration: additive; `Org.timezone` defaults to `UTC`; no backfill of runs.
- New dependencies: `web-push`, `date-fns`, `date-fns-tz`.
