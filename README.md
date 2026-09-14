# Checkly

Property checklists for your team. Managers create properties and invite staff on the web; workers use the installable PWA on their phones.

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

## Tests

```bash
pnpm test        # vitest: unit + services against checkly_test
pnpm e2e         # playwright smoke test (spins up its own dev server on :3100)
```

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
