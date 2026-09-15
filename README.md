# Checkly

Property operations for small teams. Managers create properties, invite staff, build checklist templates, assign or schedule them, and review what comes back. Workers use the installable PWA on their phones to see what is due today and complete their checklists with photos and videos.

## Features

- **Organizations and roles.** Sign up creates an org; invite people by email as Owner, Manager, or Worker. Login by email or phone number plus password. Password reset by email. Users can belong to several orgs and switch between them.
- **Properties and membership.** Managers create properties and pick which members work at each one. Workers see only their properties.
- **Checklist templates.** Reusable, org-wide templates with typed items: checkbox, text, number (optional min/max), choice, photo, video. Each item can be required.
- **Assignment.** Assign a template at a property to one or more workers with a due time; each worker gets their own copy with the items frozen at assignment time.
- **Schedules.** Daily, weekly on chosen weekdays, or monthly on a day of month, with a due time in the org's timezone. Occurrences are generated at the start of each due day; missed days are caught up for 14 days.
- **Worker app.** Today page (overdue, needs rework, due today, upcoming, done). Answers autosave item by item; photos are resized on the phone and uploaded straight to storage; submit when every required item is done.
- **Review.** Managers approve, or reject with a comment, which reopens the checklist for the same worker.
- **Notifications.** In-app inbox with a bell, web push (VAPID), and email: assigned, due in one hour, overdue, submitted (to managers), rejected, approved. Per-user push and email toggles.
- **PWA.** Installable, precached shell, no offline data by design.

## Accounts for local testing

`pnpm db:seed` creates org "Seaside Rentals" with properties Villa Azul and Harbor Loft. All passwords are `password123`.

| Role | Email | Phone |
|---|---|---|
| Owner | owner@example.com | +14155550100 |
| Manager | manager@example.com | |
| Worker | wendy@example.com | +14155550101 |
| Worker | walt@example.com | |

## Development

```bash
cp .env.example .env            # then set AUTH_SECRET: openssl rand -hex 32
docker compose up -d            # Postgres + MinIO
docker compose exec db psql -U checkly -c 'CREATE DATABASE checkly_test;'
pnpm install
pnpm db:migrate
pnpm db:push:test               # applies the schema to checkly_test so tests can run
pnpm db:seed
pnpm storage:init               # creates the MinIO bucket
pnpm push:keys                  # prints VAPID keys; paste them into .env (see Push notifications)
pnpm icons                      # only after editing app/icon.svg: regenerates the PNG app icons
pnpm dev
```

Scheduled checklists and notification delivery only happen when the tick endpoint is called (see Schedules and notifications). In development, call it by hand:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick
```

### Stack

Next.js 16 (App Router, React 19), Prisma 7 with the pg driver adapter, Postgres, Auth.js v5 (credentials, JWT sessions), zod 4, Tailwind 4 with shadcn (Base UI) and lucide icons, Serwist for the service worker, S3-compatible storage (MinIO in dev), Resend for email, web-push, Vitest, Playwright.

Things that differ from older tutorials:

- Prisma 7 reads its datasource URL and seed command from `prisma.config.ts`, needs `@prisma/adapter-pg`, and refuses destructive commands (`migrate reset`, `db push --force-reset`) when run by an AI agent.
- Next 16 uses `proxy.ts` instead of `middleware.ts`, and `next build --webpack` is required because Serwist does not run under Turbopack (`pnpm dev` still uses Turbopack).
- shadcn's current default style is Base UI: `Button` takes a `render` prop, not `asChild`.

## Project layout

```
app/            routes (App Router); (auth) public pages, (app) signed-in shell
actions/        server actions; zod schemas live in *.schemas.ts
lib/services/   all business logic and authorization (org scoping, roles)
lib/            auth, storage, email, media rules, recurrence math, notifications
prisma/         schema, migrations, seed
tests/          vitest unit and service tests (real Postgres)
e2e/            Playwright flows
docs/superpowers/specs, plans   design documents for each sub-project
```

Authorization lives in `lib/services/*`: every function takes the caller's `{ userId, orgId }` from the session and scopes every query by org. Pages and actions never pass an org id from the client.

## Tests

```bash
pnpm lint
pnpm test        # vitest: unit + services against checkly_test
pnpm e2e         # playwright: smoke, checklist flow, photo, schedule (spins up its own dev server on :3100)
```

When `S3_ENDPOINT` is set, `pnpm test` and `pnpm e2e` need MinIO running (`docker compose up -d`) and its bucket created (`pnpm storage:init`): the media service tests upload real objects, and the photo e2e test skips itself when `S3_ENDPOINT` is unset. CI (`.github/workflows/ci.yml`) runs all of this with Postgres and MinIO services.

## Media storage

Files live in S3-compatible object storage: MinIO in dev, any S3-compatible service in production. Configure `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE` (see `.env.example`). Uploads and downloads go directly between the browser and storage through short-lived presigned URLs, so the signing endpoint must be reachable from the browser. `S3_PUBLIC_ENDPOINT` covers the case where that differs from `S3_ENDPOINT` (the compose `app` service reaches MinIO at `http://minio:9000`, the browser at `http://localhost:9000`). When testing from a phone on your LAN, set `S3_PUBLIC_ENDPOINT=http://<your-lan-ip>:9000` and `APP_URL` to the same host.

Limits: one file per item, photos up to 5 MB (resized to 1600 px on the phone), videos up to 100 MB (no transcoding; iPhone `.mov` may not play in desktop Chrome, a download link is shown). Retention is unbounded for now: there is no lifecycle rule or orphan cleanup.

Direct browser uploads need CORS on the bucket. `pnpm storage:init` applies a rule allowing `PUT`/`GET` from `APP_URL`; MinIO has no per-bucket CORS API and answers `NotImplemented`, so the script warns and dev relies on `MINIO_API_CORS_ALLOW_ORIGIN` (set in `docker-compose.yml` and CI).

## Schedules and notifications

Managers set up a recurring schedule on a property (daily, weekly on chosen weekdays, or monthly on a day of month) with a due time and worker assignees. Schedules run in the org's timezone (Settings, owner only; detected from the browser at signup). Occurrences are created at the start of each due day, one checklist per assignee. Editing a schedule affects future occurrences only; deleting it keeps the checklists already created. If the tick has not run for a while, it catches up missed days up to 14 days back.

Everything time-based happens inside `POST /api/cron/tick`: generating occurrences, due-in-one-hour reminders, overdue marking, and draining the push/email outbox. Something must call it regularly. It is authenticated with a bearer token:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/tick
```

Pick one way to drive it:

- **Compose**: `docker compose --profile app up -d` also starts a `cron` sidecar that calls the endpoint every 5 minutes.
- **crontab** on any host that can reach the app:
  ```
  */5 * * * * curl -fsS -X POST -H "Authorization: Bearer …" https://your-app/api/cron/tick
  ```
- **GitHub Actions**:
  ```yaml
  on:
    schedule:
      - cron: "*/5 * * * *"
  jobs:
    tick:
      runs-on: ubuntu-latest
      steps:
        - run: curl -fsS -X POST -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" https://your-app/api/cron/tick
  ```

Ticks are safe to overlap (an advisory lock skips the second one) and safe to retry (each occurrence is recorded once).

### Push notifications

Push needs a VAPID key pair. `pnpm push:keys` prints `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `NEXT_PUBLIC_VAPID_PUBLIC_KEY`; paste all three into `.env` and set `VAPID_SUBJECT` to a `mailto:` address. `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is inlined into the client bundle at build time, so a Docker build needs it as a build arg (`docker compose build` passes it via `app.build.args`).

Browsers require HTTPS for push (localhost is exempt). On iPhone, push only works from the app after it has been added to the Home Screen. Users opt in from Settings: enable push on the device, and toggle email and push preferences independently.

To verify push by hand: install the app on a phone over HTTPS, enable push in Settings, have a manager assign or schedule a checklist to that worker, and expect a notification within one tick interval.

## Deploy

`pnpm build` runs `next build --webpack`. Build the image with `docker build -t checkly .` (pass `--build-arg NEXT_PUBLIC_VAPID_PUBLIC_KEY=…`), run `pnpm prisma migrate deploy` against the production database from a checkout or CI job (the image has no Prisma CLI), then run the image with `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, the `S3_*` vars, `CRON_SECRET`, and the `VAPID_*` vars set. Set `TRUST_PROXY=1` behind a reverse proxy that overwrites `X-Forwarded-For`; otherwise rate limiting ignores that header. Push needs HTTPS.

### Run with Docker Compose

```bash
docker compose up -d                         # Postgres + MinIO
pnpm prisma migrate deploy                    # from host: the image has no Prisma CLI
pnpm db:seed                                  # optional
docker compose --profile app up --build -d    # app on :3000 plus the cron sidecar
```

Open http://localhost:3000. `pnpm dev` and the compose `app` service both bind port 3000, so run only one at a time.

## Known limitations

- Online only: no offline capture or sync.
- Password reset does not invalidate existing sessions (JWT, no session table).
- Rate limiting is per IP; behind a proxy without `TRUST_PROXY=1` all clients share one bucket.
- Media: no cleanup of replaced or orphaned files; re-uploading in a different format leaves the old object behind.
- Schedules whose workers were all removed are skipped with a warning until the missed days age past the catch-up window.
