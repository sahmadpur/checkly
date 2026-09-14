# Checkly

Property checklists for your team. Managers create properties and invite staff on the web; workers use the installable PWA on their phones.

## Checklists

Managers build reusable checklist templates (checkbox, text, number, choice,
photo, and video items, each optionally required) and assign them to workers
on a property with a due date. Workers fill theirs in from the **Today**
page on their phone — answers and media save as they go — and submit when
every required item is done. A manager reviews a submitted checklist and
either approves it or rejects it with a comment, which sends it back to the
worker as "Needs rework" for a resubmission.

## Development

```bash
cp .env.example .env            # then set AUTH_SECRET: openssl rand -hex 32
docker compose up -d            # Postgres + MinIO
docker compose exec db psql -U checkly -c 'CREATE DATABASE checkly_test;'
pnpm install
pnpm db:migrate
pnpm db:push:test               # applies the schema to checkly_test so tests can run
pnpm db:seed                    # owner@example.com / password123
pnpm storage:init               # creates the MinIO bucket
pnpm dev
```

Prisma 7 uses `prisma.config.ts` (not `package.json#prisma`) and a driver
adapter (`@prisma/adapter-pg`) instead of talking to Postgres directly.

### Media storage

Files (photos, attachments) live in S3-compatible object storage — MinIO in
dev, any S3-compatible service in production. Configure it via `S3_ENDPOINT`,
`S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
`S3_FORCE_PATH_STYLE` (see `.env.example`). Uploads and downloads go directly
from the browser to storage via short-lived presigned URLs, so the endpoint
used to sign them must be one the browser — not just the server — can reach.
`S3_PUBLIC_ENDPOINT` covers the cases where that differs from `S3_ENDPOINT`
(the compose `app` service reaches MinIO at `http://minio:9000` internally
but the browser needs `http://localhost:9000`); when testing from a phone on
your LAN, set `S3_PUBLIC_ENDPOINT=http://<your-lan-ip>:9000` and `APP_URL`
to the same host.

Retention is unbounded for now: videos up to 100 MB each accumulate, and there
is no lifecycle rule or orphan cleanup — deleting a checklist or replacing a
file leaves the old object behind.

Those direct browser uploads need CORS on the bucket. `pnpm storage:init`
applies a rule allowing `PUT`/`GET` from `APP_URL`; MinIO has no per-bucket
CORS API and answers `NotImplemented`, so the script warns and dev relies on
`MINIO_API_CORS_ALLOW_ORIGIN` (set in `docker-compose.yml` and CI) instead.

## Tests

```bash
pnpm test        # vitest: unit + services against checkly_test
pnpm e2e         # playwright: smoke, checklist flow, photo, schedule (spins up its own dev server on :3100)
```

When `S3_ENDPOINT` is set, `pnpm test` and `pnpm e2e` need MinIO running
(`docker compose up -d`) and its bucket created (`pnpm storage:init`): the
media service tests upload real objects, and the separate photo e2e test
skips itself when `S3_ENDPOINT` is unset. The main checklist flow test runs
without storage.

## Deploy

`pnpm build` runs `next build --webpack` (Turbopack can't run Serwist's
service-worker plugin, so production builds use webpack; `pnpm dev` still
uses Turbopack). Build the image with `docker build -t checkly .`, run
`pnpm prisma migrate deploy` against the production database (from a
checkout or CI job — the image itself has no Prisma CLI in it), then run
the image with `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`, `RESEND_API_KEY`,
`EMAIL_FROM` set. Also set `TRUST_PROXY=1` if you're running behind a
reverse proxy that overwrites `X-Forwarded-For` — without it, rate limiting
ignores that header (it's otherwise attacker-controlled) and falls back to
`X-Real-Ip`/"unknown".

### Run with Docker Compose

```bash
docker compose up -d                         # Postgres + MinIO
pnpm prisma migrate deploy                    # from host — the image has no Prisma CLI
pnpm db:seed                                  # optional
docker compose --profile app up --build -d    # builds and runs the app on :3000
```

Open http://localhost:3000. `pnpm dev` and the compose `app` service both
bind port 3000, so run only one of them at a time.

## Schedules and notifications

Managers set up a recurring schedule (daily, weekly on chosen weekdays, or
monthly on a day of month) on a property, with a due time and a list of
worker assignees. Schedules run in the org's timezone (**Settings**, owner
only): occurrences are created at the start of each due day, one checklist
instance per assignee. If the tick hasn't run in a while, it catches up
missed occurrences up to `CATCHUP_DAYS` (14) days back rather than flooding
years of backlog.

All of that happens inside `POST /api/cron/tick` — it also sends due-soon
reminders, marks checklists overdue, and drains the push/email outbox — so
something has to call it on a schedule. It's authenticated with a bearer
token:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" $APP_URL/api/cron/tick
```

Ways to drive it, pick one:

- **Compose**: `docker compose --profile app up -d` also starts a `cron`
  sidecar (`curlimages/curl`) that calls the endpoint every 5 minutes.
- **crontab** on any host that can reach the app:
  ```
  */5 * * * * curl -fsS -X POST -H "Authorization: Bearer …" https://your-app/api/cron/tick
  ```
- **GitHub Actions**, if you'd rather not run a host or sidecar:
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

### Push notifications

Push needs a VAPID key pair. Generate one with `pnpm push:keys` (prints
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` —
paste all three into `.env`) and set `VAPID_SUBJECT` to a `mailto:` address.
`NEXT_PUBLIC_VAPID_PUBLIC_KEY` is inlined into the client bundle at build
time, so a Docker build needs it passed as a build arg (`docker compose
build` already does this via `app.build.args`; see `docker-compose.yml`).

Browsers require HTTPS for push (localhost is exempt). On iOS, push only
works from the PWA after it's been added to the Home Screen — Safari itself
doesn't support it. Workers opt in from **Settings**: enable push on the
device, and toggle email/push notification preferences independently.

To verify push manually: install the app on a phone over HTTPS, enable push
in Settings, have a manager assign or schedule a checklist to that worker,
and expect a notification within one tick interval (five minutes with the
compose sidecar/crontab example above).
