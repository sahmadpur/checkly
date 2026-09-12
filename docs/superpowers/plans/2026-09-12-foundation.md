# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the multi-tenant foundation of Checkly: signup, login with email or phone, orgs, properties, membership, invites, password reset, and an installable PWA shell.

**Architecture:** Single Next.js App Router app. Server actions are thin: read session, validate with Zod, call a service function. Service functions in `lib/services/` take an explicit `ctx` (`userId`, `orgId`) and are tested directly against a real Postgres. Authorization lives in `lib/auth/guard.ts` and is called inside services, so every code path that touches data is guarded regardless of entry point.

**Tech Stack:** Next.js 15 (App Router, React 19), TypeScript, Prisma 6, Postgres 16, Auth.js v5 (`next-auth@beta`, Credentials provider, JWT sessions), Zod, bcryptjs, libphonenumber-js, Tailwind CSS 4, shadcn/ui, @serwist/next, Resend, Vitest, Playwright, pnpm, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-12-foundation-design.md`

## Global Constraints

- Roles are exactly `OWNER`, `MANAGER`, `WORKER`. Ordering for "minimum role" checks: OWNER > MANAGER > WORKER.
- Every Prisma query that touches org data filters by `orgId` taken from the session context, never from client input.
- Server actions return `{ ok: true, data }` or `{ ok: false, error: string }`. They never throw to the client except for the Auth.js redirect.
- Zod validates every action input.
- Prisma error text never reaches the client.
- Phone numbers are stored in E.164 format.
- Tokens (invite, reset) are 32 random bytes, hex encoded. Invite expiry 7 days, reset expiry 1 hour.
- No offline data in the service worker. Precache the shell only.
- Online only, no email or SMS verification, no billing, no OAuth.
- Package manager: pnpm. Commit after every task with a conventional commit message.

## File Structure

```
package.json, pnpm-lock.yaml, tsconfig.json, next.config.ts
docker-compose.yml, Dockerfile, .env.example
vitest.config.ts, vitest.setup.ts, playwright.config.ts
prisma/schema.prisma           data model
prisma/seed.ts                 dev seed
lib/db.ts                      Prisma client singleton
lib/errors.ts                  AppError class and codes
lib/auth/password.ts           hashPassword, verifyPassword
lib/auth/phone.ts              normalizePhone
lib/auth/token.ts              createToken, expiry helpers
lib/auth/guard.ts              requireUser, requireOrgRole, requirePropertyAccess
lib/auth/config.ts             Auth.js setup, credentials provider, JWT callbacks
lib/ratelimit.ts               in-memory token bucket
lib/email.ts                   sendMail via Resend or console
lib/services/auth.ts           signup, requestPasswordReset, resetPassword, changePassword
lib/services/org.ts            renameOrg, listOrgsForUser
lib/services/property.ts       list/create/update/delete property, add/remove property member
lib/services/member.ts         listMembers, changeRole, removeMember
lib/services/invite.ts         createInvite, getInvite, acceptInvite
lib/actions.ts                 run() wrapper mapping errors to ActionResult
actions/auth.ts, org.ts, property.ts, member.ts, invite.ts   server actions
app/layout.tsx, app/globals.css, app/manifest.ts, app/sw.ts
app/api/auth/[...nextauth]/route.ts
app/(auth)/login, signup, forgot, reset/[token], invite/[token]
app/(app)/layout.tsx           shell: nav, org switcher
app/(app)/page.tsx             dashboard
app/(app)/properties/[id]/page.tsx
app/(app)/team/page.tsx
app/(app)/settings/page.tsx
components/                    shadcn components plus app components
tests/helpers/db.ts            resetDb, factories
tests/unit/*.test.ts           pure helpers
tests/services/*.test.ts       services against Postgres
e2e/smoke.spec.ts              Playwright
```

---

### Task 1: Scaffold the project

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css` (via create-next-app)
- Create: `docker-compose.yml`, `.env.example`, `vitest.config.ts`, `tests/unit/smoke.test.ts`

**Interfaces:**
- Produces: working `pnpm dev`, `pnpm test`, `pnpm build`; Postgres on `localhost:5432`, MinIO on `localhost:9000`.

- [ ] **Step 1: Create the Next.js app in the current directory**

Run from the repo root (it already contains `docs/` and `.gitignore`; create-next-app accepts a non-empty directory when only dotfiles and docs exist; if it refuses, run it in a temp dir and move the files over):

```bash
pnpm dlx create-next-app@latest . --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-pnpm --no-turbopack
```

Answer "no" to any prompt about overwriting `.gitignore`; then append these lines to `.gitignore` if missing:

```
node_modules
.next
.env
.env.*
!.env.example
coverage
playwright-report
test-results
```

- [ ] **Step 2: Add dependencies**

```bash
pnpm add next-auth@beta @prisma/client zod bcryptjs libphonenumber-js resend @serwist/next serwist
pnpm add -D prisma vitest @vitest/coverage-v8 @types/bcryptjs tsx @playwright/test dotenv-cli
```

- [ ] **Step 3: Docker Compose**

Create `docker-compose.yml`:

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: checkly
      POSTGRES_PASSWORD: checkly
      POSTGRES_DB: checkly
    ports: ["5432:5432"]
    volumes: [dbdata:/var/lib/postgresql/data]
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minio
      MINIO_ROOT_PASSWORD: minio12345
    ports: ["9000:9000", "9001:9001"]
    volumes: [miniodata:/data]
volumes:
  dbdata:
  miniodata:
```

Create `.env.example`:

```
DATABASE_URL=postgresql://checkly:checkly@localhost:5432/checkly
DATABASE_URL_TEST=postgresql://checkly:checkly@localhost:5432/checkly_test
AUTH_SECRET=change-me-run-openssl-rand-hex-32
APP_URL=http://localhost:3000
RESEND_API_KEY=
EMAIL_FROM=Checkly <noreply@example.com>
```

Copy it: `cp .env.example .env`, then `docker compose up -d`, then create the test database:

```bash
docker compose exec db psql -U checkly -c 'CREATE DATABASE checkly_test;'
```

- [ ] **Step 4: Vitest config and a smoke test**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
    fileParallelism: false,
  },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```

Create `vitest.setup.ts` (the DB reset is added in Task 2):

```ts
import "dotenv/config";
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;
```

Create `tests/unit/smoke.test.ts`:

```ts
import { expect, test } from "vitest";

test("vitest runs", () => {
  expect(1 + 1).toBe(2);
});
```

Add scripts to `package.json`:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "test": "vitest run",
  "test:watch": "vitest",
  "e2e": "playwright test",
  "db:migrate": "prisma migrate dev",
  "db:seed": "tsx prisma/seed.ts",
  "db:push:test": "dotenv -e .env -- sh -c 'DATABASE_URL=$DATABASE_URL_TEST prisma db push --force-reset --skip-generate'"
}
```

- [ ] **Step 5: Verify**

Run: `pnpm test`
Expected: 1 passed.

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js app with vitest and docker compose"
```

---

### Task 2: Prisma schema, DB client, test DB helpers

**Files:**
- Create: `prisma/schema.prisma`, `lib/db.ts`, `tests/helpers/db.ts`
- Modify: `vitest.setup.ts`
- Test: `tests/services/schema.test.ts`

**Interfaces:**
- Produces: `db` (PrismaClient singleton) from `@/lib/db`; `Role` enum from `@prisma/client`; `resetDb()`, `makeUser()`, `makeOrg()` from `@/tests/helpers/db`.

- [ ] **Step 1: Write schema**

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  OWNER
  MANAGER
  WORKER
}

model Org {
  id         String       @id @default(cuid())
  name       String
  createdAt  DateTime     @default(now())
  members    OrgMember[]
  properties Property[]
  invites    Invite[]
}

model User {
  id              String           @id @default(cuid())
  email           String?          @unique
  phone           String?          @unique
  passwordHash    String
  name            String
  createdAt       DateTime         @default(now())
  orgMemberships  OrgMember[]
  propertyMembers PropertyMember[]
  passwordResets  PasswordReset[]
}

model OrgMember {
  id        String   @id @default(cuid())
  orgId     String
  userId    String
  role      Role
  createdAt DateTime @default(now())
  org       Org      @relation(fields: [orgId], references: [id], onDelete: Cascade)
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([orgId, userId])
}

model Property {
  id        String           @id @default(cuid())
  orgId     String
  name      String
  address   String?
  createdAt DateTime         @default(now())
  org       Org              @relation(fields: [orgId], references: [id], onDelete: Cascade)
  members   PropertyMember[]

  @@index([orgId])
}

model PropertyMember {
  id         String   @id @default(cuid())
  propertyId String
  userId     String
  property   Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([propertyId, userId])
}

model Invite {
  id          String    @id @default(cuid())
  orgId       String
  email       String
  role        Role
  propertyIds Json      @default("[]")
  token       String    @unique
  expiresAt   DateTime
  acceptedAt  DateTime?
  createdAt   DateTime  @default(now())
  org         Org       @relation(fields: [orgId], references: [id], onDelete: Cascade)

  @@index([orgId])
}

model PasswordReset {
  id        String    @id @default(cuid())
  userId    String
  token     String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

- [ ] **Step 2: Migrate and push to test DB**

```bash
pnpm prisma migrate dev --name init
pnpm db:push:test
```

Expected: migration folder `prisma/migrations/<timestamp>_init` created; test DB has tables.

- [ ] **Step 3: DB client singleton**

Create `lib/db.ts`:

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
```

- [ ] **Step 4: Test helpers**

Create `tests/helpers/db.ts`:

```ts
import { db } from "@/lib/db";
import { Role } from "@prisma/client";

export async function resetDb() {
  await db.$executeRawUnsafe(
    'TRUNCATE "PasswordReset","Invite","PropertyMember","Property","OrgMember","User","Org" CASCADE'
  );
}

let counter = 0;
export function uniq(prefix = "x") {
  counter += 1;
  return `${prefix}${counter}-${Date.now()}`;
}

export async function makeUser(overrides: Partial<{ email: string; phone: string; name: string }> = {}) {
  return db.user.create({
    data: {
      email: overrides.email ?? `${uniq("u")}@test.local`,
      phone: overrides.phone,
      name: overrides.name ?? "Test User",
      passwordHash: "x",
    },
  });
}

export async function makeOrg(name = "Org") {
  return db.org.create({ data: { name } });
}

export async function makeMember(orgId: string, userId: string, role: Role) {
  return db.orgMember.create({ data: { orgId, userId, role } });
}

export async function makeProperty(orgId: string, name = "Prop") {
  return db.property.create({ data: { orgId, name } });
}
```

Update `vitest.setup.ts`:

```ts
import "dotenv/config";
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL;

import { beforeEach } from "vitest";
import { resetDb } from "./tests/helpers/db";

beforeEach(async () => {
  await resetDb();
});
```

- [ ] **Step 5: Write a schema test**

Create `tests/services/schema.test.ts`:

```ts
import { expect, test } from "vitest";
import { db } from "@/lib/db";
import { makeOrg, makeUser, makeMember, makeProperty } from "@/tests/helpers/db";

test("deleting a property cascades to property members", async () => {
  const org = await makeOrg();
  const user = await makeUser();
  await makeMember(org.id, user.id, "WORKER");
  const prop = await makeProperty(org.id);
  await db.propertyMember.create({ data: { propertyId: prop.id, userId: user.id } });

  await db.property.delete({ where: { id: prop.id } });

  expect(await db.propertyMember.count()).toBe(0);
});

test("a user cannot be a member of the same org twice", async () => {
  const org = await makeOrg();
  const user = await makeUser();
  await makeMember(org.id, user.id, "WORKER");
  await expect(makeMember(org.id, user.id, "MANAGER")).rejects.toThrow();
});
```

- [ ] **Step 6: Run tests**

Run: `pnpm test`
Expected: 3 passed.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add prisma schema, db client, and test db helpers"
```

---

### Task 3: Errors, password, phone, token helpers

**Files:**
- Create: `lib/errors.ts`, `lib/auth/password.ts`, `lib/auth/phone.ts`, `lib/auth/token.ts`
- Test: `tests/unit/password.test.ts`, `tests/unit/phone.test.ts`, `tests/unit/token.test.ts`

**Interfaces:**
- Produces:
  - `class AppError extends Error { code: "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INVALID" | "UNAUTHENTICATED" }` and helpers `forbidden(msg?)`, `notFound(msg?)`, `conflict(msg)`, `invalid(msg)`.
  - `hashPassword(plain: string): Promise<string>`, `verifyPassword(plain: string, hash: string): Promise<boolean>`.
  - `normalizePhone(input: string): string | null` (E.164 or null).
  - `createToken(): string`, `expiresIn(ms: number): Date`, `isExpired(date: Date): boolean`, constants `INVITE_TTL_MS`, `RESET_TTL_MS`.

- [ ] **Step 1: Write failing tests**

Create `tests/unit/password.test.ts`:

```ts
import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

test("hash verifies with correct password and rejects wrong one", async () => {
  const hash = await hashPassword("secret123");
  expect(hash).not.toBe("secret123");
  expect(await verifyPassword("secret123", hash)).toBe(true);
  expect(await verifyPassword("nope", hash)).toBe(false);
});
```

Create `tests/unit/phone.test.ts`:

```ts
import { expect, test } from "vitest";
import { normalizePhone } from "@/lib/auth/phone";

test("normalizes international numbers to E.164", () => {
  expect(normalizePhone("+1 (415) 555-2671")).toBe("+14155552671");
  expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
});

test("returns null for garbage", () => {
  expect(normalizePhone("hello")).toBeNull();
  expect(normalizePhone("")).toBeNull();
});
```

Create `tests/unit/token.test.ts`:

```ts
import { expect, test } from "vitest";
import { createToken, expiresIn, isExpired } from "@/lib/auth/token";

test("token is 64 hex chars and unique", () => {
  const a = createToken();
  const b = createToken();
  expect(a).toMatch(/^[0-9a-f]{64}$/);
  expect(a).not.toBe(b);
});

test("expiry helpers", () => {
  expect(isExpired(expiresIn(60_000))).toBe(false);
  expect(isExpired(new Date(Date.now() - 1))).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/unit`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

Create `lib/errors.ts`:

```ts
export type ErrorCode = "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INVALID" | "UNAUTHENTICATED";

export class AppError extends Error {
  constructor(public code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
  }
}

export const forbidden = (msg = "Forbidden") => new AppError("FORBIDDEN", msg);
export const notFound = (msg = "Not found") => new AppError("NOT_FOUND", msg);
export const conflict = (msg: string) => new AppError("CONFLICT", msg);
export const invalid = (msg: string) => new AppError("INVALID", msg);
export const unauthenticated = () => new AppError("UNAUTHENTICATED", "Not signed in");
```

Create `lib/auth/password.ts`:

```ts
import bcrypt from "bcryptjs";

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);
```

Create `lib/auth/phone.ts`:

```ts
import { parsePhoneNumberFromString } from "libphonenumber-js";

/** Returns E.164 or null. Input must include the country code (leading +). */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parsed = parsePhoneNumberFromString(trimmed);
  return parsed?.isValid() ? parsed.number : null;
}
```

Create `lib/auth/token.ts`:

```ts
import { randomBytes } from "node:crypto";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RESET_TTL_MS = 60 * 60 * 1000;

export const createToken = () => randomBytes(32).toString("hex");
export const expiresIn = (ms: number) => new Date(Date.now() + ms);
export const isExpired = (date: Date) => date.getTime() <= Date.now();
```

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/unit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib tests/unit
git commit -m "feat: add error, password, phone, and token helpers"
```

---

### Task 4: Rate limiter and email

**Files:**
- Create: `lib/ratelimit.ts`, `lib/email.ts`
- Test: `tests/unit/ratelimit.test.ts`

**Interfaces:**
- Produces: `rateLimit(key: string, opts?: { capacity?: number; refillPerSec?: number }): boolean` (true = allowed); `sendMail({ to, subject, html }): Promise<void>`.

- [ ] **Step 1: Write failing test**

Create `tests/unit/ratelimit.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import { rateLimit } from "@/lib/ratelimit";

test("allows up to capacity then blocks, refills over time", () => {
  vi.useFakeTimers();
  const key = "ip:1.2.3.4";
  for (let i = 0; i < 5; i++) expect(rateLimit(key, { capacity: 5, refillPerSec: 1 })).toBe(true);
  expect(rateLimit(key, { capacity: 5, refillPerSec: 1 })).toBe(false);
  vi.advanceTimersByTime(1000);
  expect(rateLimit(key, { capacity: 5, refillPerSec: 1 })).toBe(true);
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/unit/ratelimit.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `lib/ratelimit.ts`:

```ts
// ponytail: in-memory token bucket, single instance only. Swap for Redis when running more than one replica.
type Bucket = { tokens: number; updatedAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  { capacity = 10, refillPerSec = 0.2 }: { capacity?: number; refillPerSec?: number } = {}
): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, updatedAt: now };
  b.tokens = Math.min(capacity, b.tokens + ((now - b.updatedAt) / 1000) * refillPerSec);
  b.updatedAt = now;
  if (b.tokens < 1) {
    buckets.set(key, b);
    return false;
  }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}
```

Create `lib/email.ts`:

```ts
import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

export async function sendMail({ to, subject, html }: { to: string; subject: string; html: string }) {
  if (!resend) {
    console.log(`[email] to=${to} subject=${subject}\n${html}`);
    return;
  }
  await resend.emails.send({ from: process.env.EMAIL_FROM ?? "Checkly <noreply@example.com>", to, subject, html });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/unit`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/ratelimit.ts lib/email.ts tests/unit/ratelimit.test.ts
git commit -m "feat: add in-memory rate limiter and email sender"
```

---

### Task 5: Authorization guard

**Files:**
- Create: `lib/auth/guard.ts`
- Test: `tests/services/guard.test.ts`

**Interfaces:**
- Produces:
  - `type Ctx = { userId: string; orgId: string }`
  - `requireOrgRole(ctx: Ctx, min: Role): Promise<Role>` returns the user's actual role or throws `AppError("FORBIDDEN")`.
  - `requirePropertyAccess(ctx: Ctx, propertyId: string): Promise<{ id: string; orgId: string }>` returns the property or throws `AppError("NOT_FOUND")`.
  - `roleAtLeast(actual: Role, min: Role): boolean`.
  - `requireUser()` is added in Task 6 once Auth.js exists.

- [ ] **Step 1: Write failing tests**

Create `tests/services/guard.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { requireOrgRole, requirePropertyAccess, roleAtLeast } from "@/lib/auth/guard";
import { makeMember, makeOrg, makeProperty, makeUser } from "@/tests/helpers/db";
import { db } from "@/lib/db";

test("roleAtLeast ordering", () => {
  expect(roleAtLeast("OWNER", "WORKER")).toBe(true);
  expect(roleAtLeast("WORKER", "MANAGER")).toBe(false);
  expect(roleAtLeast("MANAGER", "MANAGER")).toBe(true);
});

describe("requireOrgRole", () => {
  test("returns role when sufficient, throws when not or when not a member", async () => {
    const org = await makeOrg();
    const mgr = await makeUser();
    const stranger = await makeUser();
    await makeMember(org.id, mgr.id, "MANAGER");

    await expect(requireOrgRole({ userId: mgr.id, orgId: org.id }, "WORKER")).resolves.toBe("MANAGER");
    await expect(requireOrgRole({ userId: mgr.id, orgId: org.id }, "OWNER")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(requireOrgRole({ userId: stranger.id, orgId: org.id }, "WORKER")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("requirePropertyAccess", () => {
  test("owner sees any property in org; worker only assigned; other org never", async () => {
    const org = await makeOrg();
    const otherOrg = await makeOrg();
    const owner = await makeUser();
    const worker = await makeUser();
    await makeMember(org.id, owner.id, "OWNER");
    await makeMember(org.id, worker.id, "WORKER");
    const p1 = await makeProperty(org.id);
    const p2 = await makeProperty(org.id);
    const foreign = await makeProperty(otherOrg.id);
    await db.propertyMember.create({ data: { propertyId: p1.id, userId: worker.id } });

    await expect(requirePropertyAccess({ userId: owner.id, orgId: org.id }, p2.id)).resolves.toMatchObject({ id: p2.id });
    await expect(requirePropertyAccess({ userId: worker.id, orgId: org.id }, p1.id)).resolves.toMatchObject({ id: p1.id });
    await expect(requirePropertyAccess({ userId: worker.id, orgId: org.id }, p2.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(requirePropertyAccess({ userId: owner.id, orgId: org.id }, foreign.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/services/guard.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `lib/auth/guard.ts`:

```ts
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { forbidden, notFound } from "@/lib/errors";

export type Ctx = { userId: string; orgId: string };

const RANK: Record<Role, number> = { OWNER: 3, MANAGER: 2, WORKER: 1 };

export const roleAtLeast = (actual: Role, min: Role) => RANK[actual] >= RANK[min];

export async function requireOrgRole(ctx: Ctx, min: Role): Promise<Role> {
  const m = await db.orgMember.findUnique({
    where: { orgId_userId: { orgId: ctx.orgId, userId: ctx.userId } },
    select: { role: true },
  });
  if (!m || !roleAtLeast(m.role, min)) throw forbidden();
  return m.role;
}

/** Owner: any property in the active org. Others: must have a PropertyMember row. Returns NOT_FOUND to avoid leaking existence. */
export async function requirePropertyAccess(ctx: Ctx, propertyId: string) {
  const role = await requireOrgRole(ctx, "WORKER");
  const property = await db.property.findFirst({
    where: {
      id: propertyId,
      orgId: ctx.orgId,
      ...(role === "OWNER" ? {} : { members: { some: { userId: ctx.userId } } }),
    },
    select: { id: true, orgId: true },
  });
  if (!property) throw notFound("Property not found");
  return property;
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/services/guard.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/guard.ts tests/services/guard.test.ts
git commit -m "feat: add org role and property access guards"
```

---

### Task 6: Auth service (signup, credential lookup, password reset, change password)

**Files:**
- Create: `lib/services/auth.ts`
- Test: `tests/services/auth.test.ts`

**Interfaces:**
- Consumes: `hashPassword`, `verifyPassword`, `normalizePhone`, `createToken`, `expiresIn`, `isExpired`, `RESET_TTL_MS`, `sendMail`, `AppError` helpers, `db`.
- Produces:
  - `signup(input: { name: string; email: string; phone?: string; password: string; orgName: string }): Promise<{ userId: string; orgId: string }>`
  - `findUserByIdentifier(identifier: string): Promise<User | null>`
  - `authenticate(identifier: string, password: string): Promise<{ id: string; name: string } | null>`
  - `requestPasswordReset(identifier: string): Promise<void>` (always resolves)
  - `resetPassword(token: string, newPassword: string): Promise<void>`
  - `changePassword(userId: string, current: string, next: string): Promise<void>`

- [ ] **Step 1: Write failing tests**

Create `tests/services/auth.test.ts`:

```ts
import { describe, expect, test, vi } from "vitest";
import { db } from "@/lib/db";
import * as email from "@/lib/email";
import { authenticate, changePassword, requestPasswordReset, resetPassword, signup } from "@/lib/services/auth";

describe("signup", () => {
  test("creates user, org, and owner membership", async () => {
    const { userId, orgId } = await signup({
      name: "Ana", email: "ana@test.local", phone: "+14155552671", password: "secret123", orgName: "Ana Co",
    });
    const member = await db.orgMember.findUniqueOrThrow({ where: { orgId_userId: { orgId, userId } } });
    expect(member.role).toBe("OWNER");
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.phone).toBe("+14155552671");
    expect(user.passwordHash).not.toBe("secret123");
  });

  test("rejects duplicate email with CONFLICT", async () => {
    await signup({ name: "A", email: "dup@test.local", password: "secret123", orgName: "X" });
    await expect(signup({ name: "B", email: "dup@test.local", password: "secret123", orgName: "Y" }))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });

  test("rejects invalid phone with INVALID", async () => {
    await expect(signup({ name: "A", email: "p@test.local", phone: "12", password: "secret123", orgName: "X" }))
      .rejects.toMatchObject({ code: "INVALID" });
  });
});

describe("authenticate", () => {
  test("works with email, with phone, and rejects bad password", async () => {
    await signup({ name: "Ana", email: "ana@test.local", phone: "+1 415 555 2671", password: "secret123", orgName: "X" });
    expect(await authenticate("ana@test.local", "secret123")).toMatchObject({ name: "Ana" });
    expect(await authenticate("+14155552671", "secret123")).toMatchObject({ name: "Ana" });
    expect(await authenticate("ana@test.local", "wrong")).toBeNull();
    expect(await authenticate("nobody@test.local", "secret123")).toBeNull();
  });
});

describe("password reset", () => {
  test("sends a link, resets once, second use fails", async () => {
    const spy = vi.spyOn(email, "sendMail").mockResolvedValue();
    await signup({ name: "Ana", email: "ana@test.local", password: "secret123", orgName: "X" });
    await requestPasswordReset("ana@test.local");
    expect(spy).toHaveBeenCalledTimes(1);
    const html: string = spy.mock.calls[0][0].html;
    const token = html.match(/reset\/([0-9a-f]{64})/)![1];

    await resetPassword(token, "newpass456");
    expect(await authenticate("ana@test.local", "newpass456")).not.toBeNull();
    await expect(resetPassword(token, "again789")).rejects.toMatchObject({ code: "INVALID" });
    spy.mockRestore();
  });

  test("unknown identifier resolves silently and sends nothing", async () => {
    const spy = vi.spyOn(email, "sendMail").mockResolvedValue();
    await expect(requestPasswordReset("ghost@test.local")).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

test("changePassword requires the current password", async () => {
  const { userId } = await signup({ name: "Ana", email: "ana@test.local", password: "secret123", orgName: "X" });
  await expect(changePassword(userId, "wrong", "newpass456")).rejects.toMatchObject({ code: "INVALID" });
  await changePassword(userId, "secret123", "newpass456");
  expect(await authenticate("ana@test.local", "newpass456")).not.toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/services/auth.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `lib/services/auth.ts`:

```ts
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { normalizePhone } from "@/lib/auth/phone";
import { createToken, expiresIn, isExpired, RESET_TTL_MS } from "@/lib/auth/token";
import { sendMail } from "@/lib/email";
import { conflict, invalid } from "@/lib/errors";

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export function parseIdentifier(identifier: string): { email: string } | { phone: string } | null {
  const v = identifier.trim();
  if (v.includes("@")) return { email: v.toLowerCase() };
  const phone = normalizePhone(v);
  return phone ? { phone } : null;
}

export async function findUserByIdentifier(identifier: string) {
  const where = parseIdentifier(identifier);
  if (!where) return null;
  return db.user.findUnique({ where });
}

export async function signup(input: { name: string; email: string; phone?: string; password: string; orgName: string }) {
  const phone = input.phone?.trim() ? normalizePhone(input.phone) : null;
  if (input.phone?.trim() && !phone) throw invalid("Phone number is not valid");
  const passwordHash = await hashPassword(input.password);
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { name: input.name, email: input.email.toLowerCase(), phone, passwordHash },
      });
      const org = await tx.org.create({ data: { name: input.orgName } });
      await tx.orgMember.create({ data: { orgId: org.id, userId: user.id, role: "OWNER" } });
      return { userId: user.id, orgId: org.id };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("An account with that email or phone already exists");
    throw e;
  }
}

export async function authenticate(identifier: string, password: string) {
  const user = await findUserByIdentifier(identifier);
  if (!user) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? { id: user.id, name: user.name } : null;
}

export async function requestPasswordReset(identifier: string) {
  const user = await findUserByIdentifier(identifier);
  if (!user?.email) return;
  const token = createToken();
  await db.passwordReset.create({ data: { userId: user.id, token, expiresAt: expiresIn(RESET_TTL_MS) } });
  const url = `${process.env.APP_URL}/reset/${token}`;
  await sendMail({
    to: user.email,
    subject: "Reset your Checkly password",
    html: `<p>Click to reset your password. The link expires in 1 hour.</p><p><a href="${url}">${url}</a></p>`,
  });
}

export async function resetPassword(token: string, newPassword: string) {
  const reset = await db.passwordReset.findUnique({ where: { token } });
  if (!reset || reset.usedAt || isExpired(reset.expiresAt)) throw invalid("This reset link is invalid or expired");
  const passwordHash = await hashPassword(newPassword);
  await db.$transaction([
    db.user.update({ where: { id: reset.userId }, data: { passwordHash } }),
    db.passwordReset.update({ where: { id: reset.id }, data: { usedAt: new Date() } }),
  ]);
}

export async function changePassword(userId: string, current: string, next: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await verifyPassword(current, user.passwordHash))) throw invalid("Current password is incorrect");
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(next) } });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/services/auth.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/services/auth.ts tests/services/auth.test.ts
git commit -m "feat: add auth service with signup, login lookup, and password reset"
```

---

### Task 7: Auth.js configuration, `requireUser`, action wrapper

**Files:**
- Create: `lib/auth/config.ts`, `app/api/auth/[...nextauth]/route.ts`, `lib/actions.ts`, `types/next-auth.d.ts`, `middleware.ts`
- Modify: `lib/auth/guard.ts` (add `requireUser`)
- Test: `tests/unit/actions.test.ts`

**Interfaces:**
- Consumes: `authenticate` from `@/lib/services/auth`, `AppError`.
- Produces:
  - `auth()`, `signIn()`, `signOut()`, `handlers`, `unstable_update` from `@/lib/auth/config`.
  - Session shape: `session.user.id`, `session.activeOrgId: string | null`.
  - `requireUser(): Promise<{ userId: string; orgId: string }>` redirects to `/login` when signed out, throws `AppError("FORBIDDEN", "No active organization")` when no org.
  - `type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string }`; `run<T>(fn: () => Promise<T>): Promise<ActionResult<T>>`.

- [ ] **Step 1: Write failing test for the action wrapper**

Create `tests/unit/actions.test.ts`:

```ts
import { expect, test } from "vitest";
import { run } from "@/lib/actions";
import { forbidden } from "@/lib/errors";

test("run maps success, AppError, and unknown errors", async () => {
  expect(await run(async () => 42)).toEqual({ ok: true, data: 42 });
  expect(await run(async () => { throw forbidden("Nope"); })).toEqual({ ok: false, error: "Nope" });
  expect(await run(async () => { throw new Error("prisma P2002 blah"); })).toEqual({ ok: false, error: "Something went wrong" });
});

test("run rethrows Next.js redirect errors", async () => {
  const redirectErr = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
  await expect(run(async () => { throw redirectErr; })).rejects.toBe(redirectErr);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/unit/actions.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement action wrapper**

Create `lib/actions.ts`:

```ts
import { AppError } from "@/lib/errors";

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const isNextControlFlow = (e: unknown) =>
  typeof e === "object" && e !== null && "digest" in e &&
  typeof (e as { digest: unknown }).digest === "string" &&
  ((e as { digest: string }).digest.startsWith("NEXT_REDIRECT") || (e as { digest: string }).digest.startsWith("NEXT_NOT_FOUND"));

export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (isNextControlFlow(e)) throw e;
    if (e instanceof AppError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong" };
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/unit/actions.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Auth.js config**

Create `types/next-auth.d.ts`:

```ts
import "next-auth";
import "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: { id: string; name: string };
    activeOrgId: string | null;
  }
  interface User {
    id: string;
    name: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    name: string;
    activeOrgId: string | null;
  }
}
```

Create `lib/auth/config.ts`:

```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticate } from "@/lib/services/auth";

const credentialsSchema = z.object({ identifier: z.string().min(1), password: z.string().min(1) });

async function firstOrgId(userId: string) {
  const m = await db.orgMember.findFirst({ where: { userId }, orderBy: { createdAt: "asc" }, select: { orgId: true } });
  return m?.orgId ?? null;
}

export const { handlers, auth, signIn, signOut, unstable_update } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: { identifier: {}, password: {} },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const user = await authenticate(parsed.data.identifier, parsed.data.password);
        return user ? { id: user.id, name: user.name } : null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.userId = user.id;
        token.name = user.name;
        token.activeOrgId = await firstOrgId(user.id);
      }
      if (trigger === "update" && session?.activeOrgId) {
        const ok = await db.orgMember.findUnique({
          where: { orgId_userId: { orgId: session.activeOrgId, userId: token.userId } },
        });
        if (ok) token.activeOrgId = session.activeOrgId;
      }
      if (trigger === "update" && session?.name) token.name = session.name;
      return token;
    },
    async session({ session, token }) {
      session.user = { ...session.user, id: token.userId, name: token.name };
      session.activeOrgId = token.activeOrgId ?? null;
      return session;
    },
  },
});
```

Create `app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from "@/lib/auth/config";
export const { GET, POST } = handlers;
```

Create `middleware.ts`. It runs on the edge runtime, so it must not import `lib/auth/config.ts` (which pulls in Prisma). It decodes the JWT directly:

```ts
import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

const PUBLIC = [/^\/login/, /^\/signup/, /^\/forgot/, /^\/reset\//, /^\/invite\//, /^\/api\/auth/, /^\/manifest/, /^\/sw\.js/, /^\/icons\//];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET!,
    secureCookie: process.env.NODE_ENV === "production",
  });
  if (!token) {
    const url = new URL("/login", req.nextUrl);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```

- [ ] **Step 6: Add `requireUser` to the guard**

Append to `lib/auth/guard.ts`:

```ts
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";

/** Reads the session. Redirects to /login when signed out. Throws FORBIDDEN when the user has no active org. */
export async function requireUser(): Promise<Ctx> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (!session.activeOrgId) throw forbidden("No active organization");
  return { userId: session.user.id, orgId: session.activeOrgId };
}

/** Like requireUser but allows no active org (for settings and org switcher). */
export async function requireSignedIn(): Promise<{ userId: string; orgId: string | null }> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return { userId: session.user.id, orgId: session.activeOrgId };
}
```

Note: `tests/services/guard.test.ts` imports `guard.ts`, which now imports Auth.js. If Vitest fails to load `next/navigation` or `next-auth` in Node, add to `vitest.config.ts` under `test`:

```ts
server: { deps: { inline: ["next-auth", "@auth/core"] } },
```

and keep the earlier tests green.

- [ ] **Step 7: Generate `AUTH_SECRET` and verify build**

```bash
sed -i '' "s/^AUTH_SECRET=.*/AUTH_SECRET=$(openssl rand -hex 32)/" .env
pnpm test
pnpm build
```

Expected: all tests pass, build succeeds.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: configure Auth.js credentials login with JWT sessions and action wrapper"
```

---

### Task 8: Org and property services

**Files:**
- Create: `lib/services/org.ts`, `lib/services/property.ts`
- Test: `tests/services/org.test.ts`, `tests/services/property.test.ts`

**Interfaces:**
- Consumes: `Ctx`, `requireOrgRole`, `requirePropertyAccess`, `db`, error helpers.
- Produces:
  - `listOrgsForUser(userId): Promise<{ id: string; name: string; role: Role }[]>`
  - `renameOrg(ctx, name): Promise<void>` (OWNER)
  - `listProperties(ctx): Promise<{ id; name; address; memberCount }[]>` (role-filtered)
  - `getProperty(ctx, id): Promise<{ id; name; address; members: { userId; name; email; phone }[] }>`
  - `createProperty(ctx, { name, address? }): Promise<{ id: string }>` (MANAGER)
  - `updateProperty(ctx, id, { name, address? }): Promise<void>` (MANAGER)
  - `deleteProperty(ctx, id): Promise<void>` (MANAGER)
  - `addPropertyMember(ctx, propertyId, userId): Promise<void>` (MANAGER; target must be an org member)
  - `removePropertyMember(ctx, propertyId, userId): Promise<void>` (MANAGER)

- [ ] **Step 1: Write failing tests**

Create `tests/services/org.test.ts`:

```ts
import { expect, test } from "vitest";
import { listOrgsForUser, renameOrg } from "@/lib/services/org";
import { makeMember, makeOrg, makeUser } from "@/tests/helpers/db";
import { db } from "@/lib/db";

test("listOrgsForUser returns orgs with role", async () => {
  const u = await makeUser();
  const a = await makeOrg("A");
  const b = await makeOrg("B");
  await makeMember(a.id, u.id, "OWNER");
  await makeMember(b.id, u.id, "WORKER");
  const orgs = await listOrgsForUser(u.id);
  expect(orgs.map((o) => [o.name, o.role])).toEqual([["A", "OWNER"], ["B", "WORKER"]]);
});

test("renameOrg requires OWNER", async () => {
  const u = await makeUser();
  const mgr = await makeUser();
  const org = await makeOrg("Old");
  await makeMember(org.id, u.id, "OWNER");
  await makeMember(org.id, mgr.id, "MANAGER");
  await expect(renameOrg({ userId: mgr.id, orgId: org.id }, "New")).rejects.toMatchObject({ code: "FORBIDDEN" });
  await renameOrg({ userId: u.id, orgId: org.id }, "New");
  expect((await db.org.findUniqueOrThrow({ where: { id: org.id } })).name).toBe("New");
});
```

Create `tests/services/property.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  addPropertyMember, createProperty, deleteProperty, getProperty, listProperties, removePropertyMember, updateProperty,
} from "@/lib/services/property";
import { makeMember, makeOrg, makeUser } from "@/tests/helpers/db";
import { db } from "@/lib/db";

async function setup() {
  const org = await makeOrg();
  const owner = await makeUser({ name: "Owner" });
  const mgr = await makeUser({ name: "Mgr" });
  const worker = await makeUser({ name: "Worker" });
  await makeMember(org.id, owner.id, "OWNER");
  await makeMember(org.id, mgr.id, "MANAGER");
  await makeMember(org.id, worker.id, "WORKER");
  const ctx = (userId: string) => ({ userId, orgId: org.id });
  return { org, owner, mgr, worker, ctx };
}

describe("property CRUD", () => {
  test("manager creates, updates, deletes; worker cannot", async () => {
    const { mgr, worker, ctx } = await setup();
    const { id } = await createProperty(ctx(mgr.id), { name: "Villa", address: "1 Sea Rd" });
    await expect(createProperty(ctx(worker.id), { name: "X" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await updateProperty(ctx(mgr.id), id, { name: "Villa 2" });
    expect((await getProperty(ctx(mgr.id), id)).name).toBe("Villa 2");

    await deleteProperty(ctx(mgr.id), id);
    await expect(getProperty(ctx(mgr.id), id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("listProperties: owner sees all, worker sees only assigned", async () => {
    const { owner, mgr, worker, ctx } = await setup();
    const a = await createProperty(ctx(mgr.id), { name: "A" });
    await createProperty(ctx(mgr.id), { name: "B" });
    await addPropertyMember(ctx(mgr.id), a.id, worker.id);

    expect((await listProperties(ctx(owner.id))).map((p) => p.name)).toEqual(["A", "B"]);
    expect((await listProperties(ctx(worker.id))).map((p) => p.name)).toEqual(["A"]);
    // The creating manager is auto-added as a member of each property they create
    expect((await listProperties(ctx(mgr.id))).map((p) => p.name)).toEqual(["A", "B"]);
  });

  test("property members: add requires org membership, remove works", async () => {
    const { mgr, worker, ctx } = await setup();
    const stranger = await makeUser();
    const { id } = await createProperty(ctx(mgr.id), { name: "A" });
    await expect(addPropertyMember(ctx(mgr.id), id, stranger.id)).rejects.toMatchObject({ code: "INVALID" });
    await addPropertyMember(ctx(mgr.id), id, worker.id);
    await addPropertyMember(ctx(mgr.id), id, worker.id); // idempotent
    expect((await getProperty(ctx(mgr.id), id)).members.map((m) => m.userId)).toEqual([worker.id]);
    await removePropertyMember(ctx(mgr.id), id, worker.id);
    expect(await db.propertyMember.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/services/org.test.ts tests/services/property.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

Create `lib/services/org.ts`:

```ts
import { db } from "@/lib/db";
import { Ctx, requireOrgRole } from "@/lib/auth/guard";

export async function listOrgsForUser(userId: string) {
  const rows = await db.orgMember.findMany({
    where: { userId },
    include: { org: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({ id: r.org.id, name: r.org.name, role: r.role }));
}

export async function renameOrg(ctx: Ctx, name: string) {
  await requireOrgRole(ctx, "OWNER");
  await db.org.update({ where: { id: ctx.orgId }, data: { name } });
}
```

Create `lib/services/property.ts`:

```ts
import { db } from "@/lib/db";
import { Ctx, requireOrgRole, requirePropertyAccess } from "@/lib/auth/guard";
import { invalid } from "@/lib/errors";

type PropertyInput = { name: string; address?: string | null };

export async function listProperties(ctx: Ctx) {
  const role = await requireOrgRole(ctx, "WORKER");
  const rows = await db.property.findMany({
    where: { orgId: ctx.orgId, ...(role === "OWNER" ? {} : { members: { some: { userId: ctx.userId } } }) },
    orderBy: { name: "asc" },
    include: { _count: { select: { members: true } } },
  });
  return rows.map((p) => ({ id: p.id, name: p.name, address: p.address, memberCount: p._count.members }));
}

export async function getProperty(ctx: Ctx, id: string) {
  await requirePropertyAccess(ctx, id);
  const p = await db.property.findUniqueOrThrow({
    where: { id },
    include: { members: { include: { user: { select: { id: true, name: true, email: true, phone: true } } } } },
  });
  return {
    id: p.id,
    name: p.name,
    address: p.address,
    members: p.members.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email, phone: m.user.phone })),
  };
}

export async function createProperty(ctx: Ctx, input: PropertyInput) {
  await requireOrgRole(ctx, "MANAGER");
  const p = await db.property.create({ data: { orgId: ctx.orgId, name: input.name, address: input.address ?? null } });
  // A manager who creates a property gets access to it automatically.
  await db.propertyMember.upsert({
    where: { propertyId_userId: { propertyId: p.id, userId: ctx.userId } },
    create: { propertyId: p.id, userId: ctx.userId },
    update: {},
  });
  return { id: p.id };
}

export async function updateProperty(ctx: Ctx, id: string, input: PropertyInput) {
  await requireOrgRole(ctx, "MANAGER");
  await requirePropertyAccess(ctx, id);
  await db.property.update({ where: { id }, data: { name: input.name, address: input.address ?? null } });
}

export async function deleteProperty(ctx: Ctx, id: string) {
  await requireOrgRole(ctx, "MANAGER");
  await requirePropertyAccess(ctx, id);
  await db.property.delete({ where: { id } });
}

export async function addPropertyMember(ctx: Ctx, propertyId: string, userId: string) {
  await requireOrgRole(ctx, "MANAGER");
  await requirePropertyAccess(ctx, propertyId);
  const isMember = await db.orgMember.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId } } });
  if (!isMember) throw invalid("User is not a member of this organization");
  await db.propertyMember.upsert({
    where: { propertyId_userId: { propertyId, userId } },
    create: { propertyId, userId },
    update: {},
  });
}

export async function removePropertyMember(ctx: Ctx, propertyId: string, userId: string) {
  await requireOrgRole(ctx, "MANAGER");
  await requirePropertyAccess(ctx, propertyId);
  await db.propertyMember.deleteMany({ where: { propertyId, userId } });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/services`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/services/org.ts lib/services/property.ts tests/services/org.test.ts tests/services/property.test.ts
git commit -m "feat: add org and property services"
```

---

### Task 9: Member and invite services

**Files:**
- Create: `lib/services/member.ts`, `lib/services/invite.ts`
- Test: `tests/services/member.test.ts`, `tests/services/invite.test.ts`

**Interfaces:**
- Consumes: `Ctx`, `requireOrgRole`, `db`, `createToken`, `expiresIn`, `isExpired`, `INVITE_TTL_MS`, `sendMail`, `hashPassword`, `normalizePhone`, error helpers.
- Produces:
  - `listMembers(ctx): Promise<{ userId; name; email; phone; role; propertyIds: string[] }[]>` (WORKER may call; sees all members)
  - `changeRole(ctx, userId, role): Promise<void>` (OWNER; cannot demote the last owner)
  - `removeMember(ctx, userId): Promise<void>` (OWNER; cannot remove the last owner; removes their PropertyMember rows in this org)
  - `createInvite(ctx, { email, role, propertyIds }): Promise<{ id: string }>` (MANAGER; MANAGER may not invite OWNER)
  - `listInvites(ctx): Promise<{ id; email; role; expiresAt; acceptedAt }[]>` (MANAGER)
  - `revokeInvite(ctx, id): Promise<void>` (MANAGER)
  - `getInvite(token): Promise<{ id; orgName; email; role; existingUser: boolean } | null>` (public; null if invalid, expired, or accepted)
  - `acceptInvite(token, opts: { userId: string } | { name: string; password: string; phone?: string }): Promise<{ userId: string; orgId: string }>`

- [ ] **Step 1: Write failing tests**

Create `tests/services/member.test.ts`:

```ts
import { expect, test } from "vitest";
import { changeRole, listMembers, removeMember } from "@/lib/services/member";
import { makeMember, makeOrg, makeProperty, makeUser } from "@/tests/helpers/db";
import { db } from "@/lib/db";

async function setup() {
  const org = await makeOrg();
  const owner = await makeUser({ name: "Owner" });
  const worker = await makeUser({ name: "Worker" });
  await makeMember(org.id, owner.id, "OWNER");
  await makeMember(org.id, worker.id, "WORKER");
  const ctx = (userId: string) => ({ userId, orgId: org.id });
  return { org, owner, worker, ctx };
}

test("listMembers includes property ids scoped to this org", async () => {
  const { org, owner, worker, ctx } = await setup();
  const p = await makeProperty(org.id);
  const other = await makeOrg();
  const foreignProp = await makeProperty(other.id);
  await db.propertyMember.createMany({ data: [
    { propertyId: p.id, userId: worker.id },
    { propertyId: foreignProp.id, userId: worker.id },
  ] });
  const rows = await listMembers(ctx(owner.id));
  expect(rows.find((r) => r.userId === worker.id)?.propertyIds).toEqual([p.id]);
});

test("changeRole: owner only, cannot demote last owner", async () => {
  const { owner, worker, ctx } = await setup();
  await expect(changeRole(ctx(worker.id), owner.id, "WORKER")).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(changeRole(ctx(owner.id), owner.id, "MANAGER")).rejects.toMatchObject({ code: "INVALID" });
  await changeRole(ctx(owner.id), worker.id, "OWNER");
  await changeRole(ctx(owner.id), owner.id, "MANAGER"); // now allowed, another owner exists
});

test("removeMember: cannot remove last owner, cleans property memberships", async () => {
  const { org, owner, worker, ctx } = await setup();
  const p = await makeProperty(org.id);
  await db.propertyMember.create({ data: { propertyId: p.id, userId: worker.id } });
  await expect(removeMember(ctx(owner.id), owner.id)).rejects.toMatchObject({ code: "INVALID" });
  await removeMember(ctx(owner.id), worker.id);
  expect(await db.orgMember.count({ where: { orgId: org.id } })).toBe(1);
  expect(await db.propertyMember.count()).toBe(0);
});
```

Create `tests/services/invite.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import * as email from "@/lib/email";
import { acceptInvite, createInvite, getInvite, listInvites, revokeInvite } from "@/lib/services/invite";
import { makeMember, makeOrg, makeProperty, makeUser } from "@/tests/helpers/db";
import { db } from "@/lib/db";
import { authenticate } from "@/lib/services/auth";

async function setup() {
  const org = await makeOrg("Acme");
  const mgr = await makeUser({ name: "Mgr" });
  await makeMember(org.id, mgr.id, "MANAGER");
  const prop = await makeProperty(org.id);
  const ctx = { userId: mgr.id, orgId: org.id };
  const spy = vi.spyOn(email, "sendMail").mockResolvedValue();
  return { org, mgr, prop, ctx, spy };
}

const tokenFrom = (spy: ReturnType<typeof vi.spyOn>) =>
  (spy.mock.calls.at(-1)![0] as { html: string }).html.match(/invite\/([0-9a-f]{64})/)![1];

test("manager cannot invite an owner", async () => {
  const { ctx, prop } = await setup();
  await expect(createInvite(ctx, { email: "x@test.local", role: "OWNER", propertyIds: [prop.id] }))
    .rejects.toMatchObject({ code: "FORBIDDEN" });
});

test("new user accepts invite: user, membership, property membership created", async () => {
  const { ctx, org, prop, spy } = await setup();
  await createInvite(ctx, { email: "New@Test.local", role: "WORKER", propertyIds: [prop.id] });
  const token = tokenFrom(spy);

  const info = await getInvite(token);
  expect(info).toMatchObject({ orgName: "Acme", email: "new@test.local", role: "WORKER", existingUser: false });

  const { userId } = await acceptInvite(token, { name: "Newbie", password: "secret123" });
  expect(await db.orgMember.findUnique({ where: { orgId_userId: { orgId: org.id, userId } } })).toMatchObject({ role: "WORKER" });
  expect(await db.propertyMember.count({ where: { propertyId: prop.id, userId } })).toBe(1);
  expect(await authenticate("new@test.local", "secret123")).not.toBeNull();
  expect(await getInvite(token)).toBeNull(); // accepted
});

test("existing user accepts invite by userId; email must match", async () => {
  const { ctx, org, prop, spy } = await setup();
  const existing = await makeUser({ email: "ex@test.local" });
  const other = await makeUser({ email: "other@test.local" });
  await createInvite(ctx, { email: "ex@test.local", role: "MANAGER", propertyIds: [prop.id] });
  const token = tokenFrom(spy);
  expect((await getInvite(token))?.existingUser).toBe(true);
  await expect(acceptInvite(token, { userId: other.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  const res = await acceptInvite(token, { userId: existing.id });
  expect(res).toEqual({ userId: existing.id, orgId: org.id });
});

test("expired invites are invalid; revoke deletes", async () => {
  const { ctx, prop, spy } = await setup();
  await createInvite(ctx, { email: "a@test.local", role: "WORKER", propertyIds: [prop.id] });
  const token = tokenFrom(spy);
  await db.invite.update({ where: { token }, data: { expiresAt: new Date(Date.now() - 1000) } });
  expect(await getInvite(token)).toBeNull();
  await expect(acceptInvite(token, { userId: ctx.userId })).rejects.toMatchObject({ code: "INVALID" });

  const [inv] = await listInvites(ctx);
  await revokeInvite(ctx, inv.id);
  expect(await listInvites(ctx)).toEqual([]);
});

test("propertyIds outside the org are rejected", async () => {
  const { ctx } = await setup();
  const foreign = await makeProperty((await makeOrg()).id);
  await expect(createInvite(ctx, { email: "a@test.local", role: "WORKER", propertyIds: [foreign.id] }))
    .rejects.toMatchObject({ code: "INVALID" });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/services/member.test.ts tests/services/invite.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement member service**

Create `lib/services/member.ts`:

```ts
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { Ctx, requireOrgRole } from "@/lib/auth/guard";
import { invalid, notFound } from "@/lib/errors";

export async function listMembers(ctx: Ctx) {
  await requireOrgRole(ctx, "WORKER");
  const rows = await db.orgMember.findMany({
    where: { orgId: ctx.orgId },
    include: {
      user: {
        select: {
          id: true, name: true, email: true, phone: true,
          propertyMembers: { where: { property: { orgId: ctx.orgId } }, select: { propertyId: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((m) => ({
    userId: m.user.id,
    name: m.user.name,
    email: m.user.email,
    phone: m.user.phone,
    role: m.role,
    propertyIds: m.user.propertyMembers.map((p) => p.propertyId),
  }));
}

async function assertNotLastOwner(orgId: string, userId: string) {
  const target = await db.orgMember.findUnique({ where: { orgId_userId: { orgId, userId } } });
  if (!target) throw notFound("Member not found");
  if (target.role !== "OWNER") return;
  const owners = await db.orgMember.count({ where: { orgId, role: "OWNER" } });
  if (owners <= 1) throw invalid("An organization must keep at least one owner");
}

export async function changeRole(ctx: Ctx, userId: string, role: Role) {
  await requireOrgRole(ctx, "OWNER");
  if (role !== "OWNER") await assertNotLastOwner(ctx.orgId, userId);
  await db.orgMember.update({ where: { orgId_userId: { orgId: ctx.orgId, userId } }, data: { role } });
}

export async function removeMember(ctx: Ctx, userId: string) {
  await requireOrgRole(ctx, "OWNER");
  await assertNotLastOwner(ctx.orgId, userId);
  await db.$transaction([
    db.propertyMember.deleteMany({ where: { userId, property: { orgId: ctx.orgId } } }),
    db.orgMember.delete({ where: { orgId_userId: { orgId: ctx.orgId, userId } } }),
  ]);
}
```

- [ ] **Step 4: Implement invite service**

Create `lib/services/invite.ts`:

```ts
import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { Ctx, requireOrgRole, roleAtLeast } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { normalizePhone } from "@/lib/auth/phone";
import { createToken, expiresIn, INVITE_TTL_MS, isExpired } from "@/lib/auth/token";
import { sendMail } from "@/lib/email";
import { forbidden, invalid } from "@/lib/errors";

export async function createInvite(ctx: Ctx, input: { email: string; role: Role; propertyIds: string[] }) {
  const myRole = await requireOrgRole(ctx, "MANAGER");
  if (!roleAtLeast(myRole, input.role)) throw forbidden("You cannot invite someone with a higher role than yours");
  const email = input.email.trim().toLowerCase();
  const propertyIds = [...new Set(input.propertyIds)];
  if (propertyIds.length) {
    const count = await db.property.count({ where: { id: { in: propertyIds }, orgId: ctx.orgId } });
    if (count !== propertyIds.length) throw invalid("One or more properties do not belong to this organization");
  }
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    const already = await db.orgMember.findUnique({ where: { orgId_userId: { orgId: ctx.orgId, userId: existing.id } } });
    if (already) throw invalid("That person is already a member");
  }
  const org = await db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
  const token = createToken();
  const invite = await db.invite.create({
    data: { orgId: ctx.orgId, email, role: input.role, propertyIds, token, expiresAt: expiresIn(INVITE_TTL_MS) },
  });
  const url = `${process.env.APP_URL}/invite/${token}`;
  await sendMail({
    to: email,
    subject: `You're invited to ${org.name} on Checkly`,
    html: `<p>You've been invited to join <b>${org.name}</b> as ${input.role.toLowerCase()}.</p><p><a href="${url}">${url}</a></p><p>This link expires in 7 days.</p>`,
  });
  return { id: invite.id };
}

export async function listInvites(ctx: Ctx) {
  await requireOrgRole(ctx, "MANAGER");
  const rows = await db.invite.findMany({
    where: { orgId: ctx.orgId, acceptedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, role: true, expiresAt: true, acceptedAt: true },
  });
  return rows;
}

export async function revokeInvite(ctx: Ctx, id: string) {
  await requireOrgRole(ctx, "MANAGER");
  await db.invite.deleteMany({ where: { id, orgId: ctx.orgId } });
}

async function loadValidInvite(token: string) {
  const inv = await db.invite.findUnique({ where: { token }, include: { org: { select: { name: true } } } });
  if (!inv || inv.acceptedAt || isExpired(inv.expiresAt)) return null;
  return inv;
}

export async function getInvite(token: string) {
  const inv = await loadValidInvite(token);
  if (!inv) return null;
  const existing = await db.user.findUnique({ where: { email: inv.email }, select: { id: true } });
  return { id: inv.id, orgName: inv.org.name, email: inv.email, role: inv.role, existingUser: !!existing };
}

export async function acceptInvite(
  token: string,
  opts: { userId: string } | { name: string; password: string; phone?: string }
) {
  const inv = await loadValidInvite(token);
  if (!inv) throw invalid("This invite is invalid or expired");
  const propertyIds = inv.propertyIds as string[];

  return db.$transaction(async (tx) => {
    let userId: string;
    if ("userId" in opts) {
      const user = await tx.user.findUniqueOrThrow({ where: { id: opts.userId }, select: { email: true } });
      if (user.email !== inv.email) throw forbidden("This invite was sent to a different email address");
      userId = opts.userId;
    } else {
      const existing = await tx.user.findUnique({ where: { email: inv.email }, select: { id: true } });
      if (existing) throw invalid("An account with this email already exists. Sign in to accept.");
      const phone = opts.phone?.trim() ? normalizePhone(opts.phone) : null;
      if (opts.phone?.trim() && !phone) throw invalid("Phone number is not valid");
      const user = await tx.user.create({
        data: { name: opts.name, email: inv.email, phone, passwordHash: await hashPassword(opts.password) },
      });
      userId = user.id;
    }
    await tx.orgMember.upsert({
      where: { orgId_userId: { orgId: inv.orgId, userId } },
      create: { orgId: inv.orgId, userId, role: inv.role },
      update: {},
    });
    if (propertyIds.length) {
      await tx.propertyMember.createMany({
        data: propertyIds.map((propertyId) => ({ propertyId, userId })),
        skipDuplicates: true,
      });
    }
    await tx.invite.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });
    return { userId, orgId: inv.orgId };
  });
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm test tests/services`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add lib/services/member.ts lib/services/invite.ts tests/services/member.test.ts tests/services/invite.test.ts
git commit -m "feat: add member and invite services"
```

---

### Task 10: Server actions

**Files:**
- Create: `actions/auth.ts`, `actions/org.ts`, `actions/property.ts`, `actions/member.ts`, `actions/invite.ts`, `lib/request.ts`
- Test: `tests/unit/schemas.test.ts`

**Interfaces:**
- Consumes: every service from Tasks 6, 8, 9; `run`, `requireUser`, `requireSignedIn`, `rateLimit`, `signIn`, `signOut`, `unstable_update`.
- Produces: server actions listed below, each returning `ActionResult<T>` unless it redirects. Zod schemas exported from the same files for reuse in forms.

Actions are called from forms with `useActionState` or directly from client components. The convention: every action takes typed input (an object), not `FormData`. Forms build the object on the client.

- [ ] **Step 1: Write a schema test**

Create `tests/unit/schemas.test.ts`:

```ts
import { expect, test } from "vitest";
import { signupSchema, loginSchema } from "@/actions/auth";
import { inviteSchema } from "@/actions/invite";

test("signup requires 8-char password and org name", () => {
  expect(signupSchema.safeParse({ name: "A", email: "a@b.co", password: "short", orgName: "X" }).success).toBe(false);
  expect(signupSchema.safeParse({ name: "A", email: "a@b.co", password: "longenough", orgName: "X" }).success).toBe(true);
});

test("login accepts any identifier", () => {
  expect(loginSchema.safeParse({ identifier: "+14155552671", password: "x" }).success).toBe(true);
});

test("invite role is restricted to the enum", () => {
  expect(inviteSchema.safeParse({ email: "a@b.co", role: "GOD", propertyIds: [] }).success).toBe(false);
  expect(inviteSchema.safeParse({ email: "a@b.co", role: "WORKER", propertyIds: ["p1"] }).success).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/unit/schemas.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Request helper**

Create `lib/request.ts`:

```ts
import { headers } from "next/headers";
import { rateLimit } from "@/lib/ratelimit";
import { invalid } from "@/lib/errors";

export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

/** Throws INVALID when the caller exceeds `capacity` calls per window for this bucket name. */
export async function throttle(bucket: string, capacity = 10, refillPerSec = 0.2) {
  const ip = await clientIp();
  if (!rateLimit(`${bucket}:${ip}`, { capacity, refillPerSec })) throw invalid("Too many attempts. Try again in a minute.");
}
```

- [ ] **Step 4: Auth actions**

Create `actions/auth.ts`:

```ts
"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { run } from "@/lib/actions";
import { signIn, signOut } from "@/lib/auth/config";
import { requireSignedIn } from "@/lib/auth/guard";
import { throttle } from "@/lib/request";
import { invalid } from "@/lib/errors";
import * as svc from "@/lib/services/auth";

export const signupSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email(),
  phone: z.string().trim().max(30).optional(),
  password: z.string().min(8).max(200),
  orgName: z.string().trim().min(1).max(100),
});

export const loginSchema = z.object({ identifier: z.string().trim().min(1), password: z.string().min(1) });

export async function signupAction(input: z.infer<typeof signupSchema>) {
  const result = await run(async () => {
    await throttle("signup", 5, 0.05);
    const data = signupSchema.parse(input);
    await svc.signup(data);
    await signIn("credentials", { identifier: data.email, password: data.password, redirect: false });
  });
  if (result.ok) redirect("/");
  return result;
}

export async function loginAction(input: z.infer<typeof loginSchema>, next?: string) {
  const result = await run(async () => {
    await throttle("login", 10, 0.2);
    const data = loginSchema.parse(input);
    try {
      await signIn("credentials", { ...data, redirect: false });
    } catch (e) {
      if (e instanceof AuthError) throw invalid("Incorrect identifier or password");
      throw e;
    }
  });
  if (result.ok) redirect(next && next.startsWith("/") ? next : "/");
  return result;
}

export async function logoutAction() {
  await signOut({ redirectTo: "/login" });
}

export async function forgotPasswordAction(input: { identifier: string }) {
  return run(async () => {
    await throttle("forgot", 5, 0.05);
    await svc.requestPasswordReset(z.string().trim().min(1).parse(input.identifier));
  });
}

export const resetSchema = z.object({ token: z.string().length(64), password: z.string().min(8).max(200) });

export async function resetPasswordAction(input: z.infer<typeof resetSchema>) {
  const result = await run(async () => {
    const data = resetSchema.parse(input);
    await svc.resetPassword(data.token, data.password);
  });
  if (result.ok) redirect("/login?reset=1");
  return result;
}

export const changePasswordSchema = z.object({ current: z.string().min(1), next: z.string().min(8).max(200) });

export async function changePasswordAction(input: z.infer<typeof changePasswordSchema>) {
  return run(async () => {
    const { userId } = await requireSignedIn();
    const data = changePasswordSchema.parse(input);
    await svc.changePassword(userId, data.current, data.next);
  });
}
```

- [ ] **Step 5: Org actions**

Create `actions/org.ts`:

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { run } from "@/lib/actions";
import { unstable_update } from "@/lib/auth/config";
import { requireSignedIn, requireUser } from "@/lib/auth/guard";
import { forbidden } from "@/lib/errors";
import { db } from "@/lib/db";
import * as svc from "@/lib/services/org";

export async function renameOrgAction(input: { name: string }) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.renameOrg(ctx, z.string().trim().min(1).max(100).parse(input.name));
    revalidatePath("/", "layout");
  });
}

export async function switchOrgAction(input: { orgId: string }) {
  return run(async () => {
    const { userId } = await requireSignedIn();
    const orgId = z.string().min(1).parse(input.orgId);
    const member = await db.orgMember.findUnique({ where: { orgId_userId: { orgId, userId } } });
    if (!member) throw forbidden();
    await unstable_update({ activeOrgId: orgId } as never);
    revalidatePath("/", "layout");
  });
}
```

Note: `unstable_update` accepts a partial session; the `as never` cast sidesteps the type since `activeOrgId` is a custom field. The jwt callback in Task 7 validates membership again before writing it into the token.

- [ ] **Step 6: Property actions**

Create `actions/property.ts`:

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { run } from "@/lib/actions";
import { requireUser } from "@/lib/auth/guard";
import * as svc from "@/lib/services/property";

export const propertySchema = z.object({
  name: z.string().trim().min(1).max(100),
  address: z.string().trim().max(200).optional().or(z.literal("")),
});

export async function createPropertyAction(input: z.infer<typeof propertySchema>) {
  const result = await run(async () => {
    const ctx = await requireUser();
    const data = propertySchema.parse(input);
    return svc.createProperty(ctx, { name: data.name, address: data.address || null });
  });
  if (result.ok) redirect(`/properties/${result.data.id}`);
  return result;
}

export async function updatePropertyAction(id: string, input: z.infer<typeof propertySchema>) {
  return run(async () => {
    const ctx = await requireUser();
    const data = propertySchema.parse(input);
    await svc.updateProperty(ctx, id, { name: data.name, address: data.address || null });
    revalidatePath(`/properties/${id}`);
  });
}

export async function deletePropertyAction(id: string) {
  const result = await run(async () => {
    const ctx = await requireUser();
    await svc.deleteProperty(ctx, id);
  });
  if (result.ok) redirect("/");
  return result;
}

export async function addPropertyMemberAction(propertyId: string, userId: string) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.addPropertyMember(ctx, propertyId, userId);
    revalidatePath(`/properties/${propertyId}`);
  });
}

export async function removePropertyMemberAction(propertyId: string, userId: string) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.removePropertyMember(ctx, propertyId, userId);
    revalidatePath(`/properties/${propertyId}`);
  });
}
```

- [ ] **Step 7: Member and invite actions**

Create `actions/member.ts`:

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { run } from "@/lib/actions";
import { requireUser } from "@/lib/auth/guard";
import * as svc from "@/lib/services/member";

const roleSchema = z.enum(["OWNER", "MANAGER", "WORKER"]);

export async function changeRoleAction(userId: string, role: string) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.changeRole(ctx, userId, roleSchema.parse(role));
    revalidatePath("/team");
  });
}

export async function removeMemberAction(userId: string) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.removeMember(ctx, userId);
    revalidatePath("/team");
  });
}
```

Create `actions/invite.ts`:

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { run } from "@/lib/actions";
import { signIn } from "@/lib/auth/config";
import { requireSignedIn, requireUser } from "@/lib/auth/guard";
import { throttle } from "@/lib/request";
import * as svc from "@/lib/services/invite";

export const inviteSchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["OWNER", "MANAGER", "WORKER"]),
  propertyIds: z.array(z.string()).default([]),
});

export async function createInviteAction(input: z.infer<typeof inviteSchema>) {
  return run(async () => {
    await throttle("invite", 20, 0.1);
    const ctx = await requireUser();
    await svc.createInvite(ctx, inviteSchema.parse(input));
    revalidatePath("/team");
  });
}

export async function revokeInviteAction(id: string) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.revokeInvite(ctx, id);
    revalidatePath("/team");
  });
}

export const acceptNewSchema = z.object({
  token: z.string().length(64),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(8).max(200),
  phone: z.string().trim().max(30).optional(),
});

/** New user: creates the account, accepts, signs in. */
export async function acceptInviteNewUserAction(input: z.infer<typeof acceptNewSchema>) {
  const result = await run(async () => {
    const data = acceptNewSchema.parse(input);
    const info = await svc.getInvite(data.token);
    await svc.acceptInvite(data.token, { name: data.name, password: data.password, phone: data.phone });
    await signIn("credentials", { identifier: info!.email, password: data.password, redirect: false });
  });
  if (result.ok) redirect("/");
  return result;
}

/** Existing, signed-in user accepts. */
export async function acceptInviteExistingAction(token: string) {
  const result = await run(async () => {
    const { userId } = await requireSignedIn();
    await svc.acceptInvite(z.string().length(64).parse(token), { userId });
  });
  if (result.ok) redirect("/");
  return result;
}
```

- [ ] **Step 8: Run tests and build**

Run: `pnpm test && pnpm build`
Expected: tests pass, build succeeds (unused actions are fine).

- [ ] **Step 9: Commit**

```bash
git add actions lib/request.ts tests/unit/schemas.test.ts
git commit -m "feat: add server actions for auth, org, property, member, and invite"
```

---

### Task 11: UI kit and auth pages

**Files:**
- Create: `components.json` and `components/ui/*` (via shadcn CLI), `components/form-error.tsx`, `components/submit-button.tsx`
- Create: `app/(auth)/layout.tsx`, `app/(auth)/login/page.tsx`, `app/(auth)/login/login-form.tsx`, `app/(auth)/signup/page.tsx`, `app/(auth)/signup/signup-form.tsx`, `app/(auth)/forgot/page.tsx`, `app/(auth)/forgot/forgot-form.tsx`, `app/(auth)/reset/[token]/page.tsx`, `app/(auth)/reset/[token]/reset-form.tsx`, `app/(auth)/invite/[token]/page.tsx`, `app/(auth)/invite/[token]/accept-form.tsx`
- Modify: `app/page.tsx` (delete the create-next-app placeholder; the dashboard replaces it in Task 12), `app/layout.tsx`

**Interfaces:**
- Consumes: actions from Task 10, `getInvite`, `auth()`.
- Produces: `<FormError message?>`, `<SubmitButton pending>` components used by every form.

- [ ] **Step 1: Install shadcn and base components**

```bash
pnpm dlx shadcn@latest init -d
pnpm dlx shadcn@latest add button input label card select checkbox badge dialog dropdown-menu separator alert
```

Accept defaults (Tailwind 4, CSS variables). Verify `components/ui/button.tsx` exists.

- [ ] **Step 2: Shared form components**

Create `components/form-error.tsx`:

```tsx
export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p role="alert" className="text-sm text-destructive">{message}</p>;
}
```

Create `components/submit-button.tsx`:

```tsx
"use client";
import { Button } from "@/components/ui/button";

export function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Please wait…" : children}
    </Button>
  );
}
```

- [ ] **Step 3: Root layout and auth layout**

Replace `app/layout.tsx`:

```tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Checkly",
  description: "Property checklists for your team",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Checkly" },
};

export const viewport: Viewport = { themeColor: "#0f172a", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
```

Create `app/(auth)/layout.tsx`:

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <h1 className="text-center text-2xl font-semibold">Checkly</h1>
      {children}
    </main>
  );
}
```

Delete `app/page.tsx` (Task 12 creates `app/(app)/page.tsx` at the same route).

- [ ] **Step 4: Login**

Create `app/(auth)/login/login-form.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { loginAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await loginAction(
        { identifier: String(fd.get("identifier")), password: String(fd.get("password")) },
        next
      );
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      <div className="space-y-1">
        <Label htmlFor="identifier">Email or phone</Label>
        <Input id="identifier" name="identifier" autoComplete="username" required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <FormError message={error} />
      <SubmitButton pending={pending}>Sign in</SubmitButton>
      <p className="text-center text-sm text-muted-foreground">
        <Link href="/forgot" className="underline">Forgot password?</Link>
        {" · "}
        <Link href="/signup" className="underline">Create an organization</Link>
      </p>
    </form>
  );
}
```

Create `app/(auth)/login/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/config";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { next, reset } = await searchParams;
  return <LoginForm next={next} notice={reset ? "Password updated. Sign in with your new password." : undefined} />;
}
```

- [ ] **Step 5: Signup**

Create `app/(auth)/signup/signup-form.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { signupAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

export function SignupForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await signupAction({
        name: String(fd.get("name")),
        email: String(fd.get("email")),
        phone: String(fd.get("phone") ?? "") || undefined,
        password: String(fd.get("password")),
        orgName: String(fd.get("orgName")),
      });
      if (res && !res.ok) setError(res.error);
    });
  }

  const field = (id: string, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={id} {...props} />
    </div>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {field("orgName", "Organization name", { required: true })}
      {field("name", "Your name", { required: true, autoComplete: "name" })}
      {field("email", "Email", { type: "email", required: true, autoComplete: "email" })}
      {field("phone", "Phone (optional, with country code)", { type: "tel", placeholder: "+1 415 555 2671", autoComplete: "tel" })}
      {field("password", "Password (8+ characters)", { type: "password", required: true, minLength: 8, autoComplete: "new-password" })}
      <FormError message={error} />
      <SubmitButton pending={pending}>Create account</SubmitButton>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account? <Link href="/login" className="underline">Sign in</Link>
      </p>
    </form>
  );
}
```

Create `app/(auth)/signup/page.tsx`:

```tsx
import { SignupForm } from "./signup-form";
export default function SignupPage() {
  return <SignupForm />;
}
```

- [ ] **Step 6: Forgot and reset**

Create `app/(auth)/forgot/forgot-form.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { forgotPasswordAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

export function ForgotForm() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();

  if (done) return <p className="text-sm">If an account with an email exists for that identifier, a reset link has been sent.</p>;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await forgotPasswordAction({ identifier: String(fd.get("identifier")) });
          if (res.ok) setDone(true); else setError(res.error);
        });
      }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <Label htmlFor="identifier">Email or phone</Label>
        <Input id="identifier" name="identifier" required />
      </div>
      <FormError message={error} />
      <SubmitButton pending={pending}>Send reset link</SubmitButton>
    </form>
  );
}
```

Create `app/(auth)/forgot/page.tsx`:

```tsx
import { ForgotForm } from "./forgot-form";
export default function ForgotPage() {
  return <ForgotForm />;
}
```

Create `app/(auth)/reset/[token]/reset-form.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { resetPasswordAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

export function ResetForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await resetPasswordAction({ token, password: String(fd.get("password")) });
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-4"
    >
      <div className="space-y-1">
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" minLength={8} required autoComplete="new-password" />
      </div>
      <FormError message={error} />
      <SubmitButton pending={pending}>Set password</SubmitButton>
    </form>
  );
}
```

Create `app/(auth)/reset/[token]/page.tsx`:

```tsx
import { ResetForm } from "./reset-form";
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ResetForm token={token} />;
}
```

- [ ] **Step 7: Invite acceptance**

Create `app/(auth)/invite/[token]/accept-form.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { acceptInviteExistingAction, acceptInviteNewUserAction } from "@/actions/invite";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

type Props = { token: string; orgName: string; email: string; role: string; mode: "new" | "signed-in" | "needs-login" };

export function AcceptForm({ token, orgName, email, role, mode }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const intro = <p className="text-sm">You've been invited to <b>{orgName}</b> as {role.toLowerCase()} ({email}).</p>;

  if (mode === "needs-login") {
    return (
      <div className="space-y-4">
        {intro}
        <p className="text-sm text-muted-foreground">Sign in with {email} to accept.</p>
        <Button asChild className="w-full"><a href={`/login?next=/invite/${token}`}>Sign in</a></Button>
      </div>
    );
  }

  if (mode === "signed-in") {
    return (
      <div className="space-y-4">
        {intro}
        <FormError message={error} />
        <Button
          className="w-full"
          disabled={pending}
          onClick={() => start(async () => {
            const res = await acceptInviteExistingAction(token);
            if (res && !res.ok) setError(res.error);
          })}
        >
          Accept invitation
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await acceptInviteNewUserAction({
            token,
            name: String(fd.get("name")),
            password: String(fd.get("password")),
            phone: String(fd.get("phone") ?? "") || undefined,
          });
          if (res && !res.ok) setError(res.error);
        });
      }}
      className="space-y-4"
    >
      {intro}
      <div className="space-y-1"><Label htmlFor="name">Your name</Label><Input id="name" name="name" required /></div>
      <div className="space-y-1"><Label htmlFor="phone">Phone (optional)</Label><Input id="phone" name="phone" type="tel" placeholder="+1 415 555 2671" /></div>
      <div className="space-y-1"><Label htmlFor="password">Password (8+ characters)</Label><Input id="password" name="password" type="password" minLength={8} required /></div>
      <FormError message={error} />
      <SubmitButton pending={pending}>Create account and join</SubmitButton>
    </form>
  );
}
```

Create `app/(auth)/invite/[token]/page.tsx`:

```tsx
import { auth } from "@/lib/auth/config";
import { getInvite } from "@/lib/services/invite";
import { db } from "@/lib/db";
import { AcceptForm } from "./accept-form";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await getInvite(token);
  if (!invite) return <p className="text-center text-sm">This invitation is invalid or has expired.</p>;

  const session = await auth();
  let mode: "new" | "signed-in" | "needs-login" = "new";
  if (invite.existingUser) {
    if (!session?.user) mode = "needs-login";
    else {
      const me = await db.user.findUnique({ where: { id: session.user.id }, select: { email: true } });
      mode = me?.email === invite.email ? "signed-in" : "needs-login";
    }
  }
  return <AcceptForm token={token} orgName={invite.orgName} email={invite.email} role={invite.role} mode={mode} />;
}
```

- [ ] **Step 8: Manual verification**

Run `pnpm dev`. Visit `/signup`, create an account, confirm redirect to `/` (it will 404 until Task 12; that is expected). Visit `/login`, sign out by clearing cookies, sign in with the phone number. Visit `/forgot`, submit, check the terminal for the logged email, follow the reset link, set a new password, sign in.

Run `pnpm build` to confirm no type errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: add auth pages for login, signup, reset, and invite acceptance"
```

---

### Task 12: App shell, dashboard, property pages

**Files:**
- Create: `app/(app)/layout.tsx`, `components/app-nav.tsx`, `components/org-switcher.tsx`, `app/(app)/page.tsx`, `app/(app)/properties/new/page.tsx`, `app/(app)/properties/new/property-form.tsx`, `app/(app)/properties/[id]/page.tsx`, `app/(app)/properties/[id]/members.tsx`, `app/(app)/properties/[id]/danger.tsx`, `app/no-org/page.tsx`

**Interfaces:**
- Consumes: `auth()`, `requireUser`, `requireSignedIn`, `listOrgsForUser`, `listProperties`, `getProperty`, `listMembers`, `requireOrgRole`, `roleAtLeast`, property actions, `switchOrgAction`, `logoutAction`.
- Produces: `<AppNav role>` and `<OrgSwitcher orgs activeOrgId>` reused by later sub-projects. The shell exposes `role` to pages via `requireOrgRole(ctx, "WORKER")`.

- [ ] **Step 1: Shell layout**

Create `components/org-switcher.tsx`:

```tsx
"use client";
import { useTransition } from "react";
import { switchOrgAction } from "@/actions/org";

export function OrgSwitcher({ orgs, activeOrgId }: { orgs: { id: string; name: string }[]; activeOrgId: string }) {
  const [pending, start] = useTransition();
  if (orgs.length <= 1) return <span className="font-medium">{orgs[0]?.name}</span>;
  return (
    <select
      aria-label="Organization"
      className="rounded-md border bg-background px-2 py-1 text-sm"
      value={activeOrgId}
      disabled={pending}
      onChange={(e) => start(async () => { await switchOrgAction({ orgId: e.target.value }); })}
    >
      {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}
```

Create `components/app-nav.tsx`:

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/actions/auth";
import { Role } from "@prisma/client";

const items = (role: Role) => [
  { href: "/", label: "Properties" },
  ...(role !== "WORKER" ? [{ href: "/team", label: "Team" }] : []),
  { href: "/settings", label: "Settings" },
];

export function AppNav({ role }: { role: Role }) {
  const path = usePathname();
  const links = items(role).map((i) => {
    const active = i.href === "/" ? path === "/" || path.startsWith("/properties") : path.startsWith(i.href);
    return (
      <Link key={i.href} href={i.href}
        className={`rounded-md px-3 py-2 text-sm ${active ? "bg-accent font-medium" : "text-muted-foreground"}`}>
        {i.label}
      </Link>
    );
  });
  return (
    <>
      <aside className="hidden w-56 shrink-0 flex-col gap-1 border-r p-3 md:flex">
        <div className="mb-3 px-3 text-lg font-semibold">Checkly</div>
        {links}
        <form action={logoutAction} className="mt-auto"><button className="px-3 py-2 text-sm text-muted-foreground">Sign out</button></form>
      </aside>
      <nav className="fixed inset-x-0 bottom-0 flex justify-around border-t bg-background p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
        {links}
      </nav>
    </>
  );
}
```

Create `app/(app)/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { requireSignedIn } from "@/lib/auth/guard";
import { listOrgsForUser } from "@/lib/services/org";
import { AppNav } from "@/components/app-nav";
import { OrgSwitcher } from "@/components/org-switcher";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId, orgId } = await requireSignedIn();
  const orgs = await listOrgsForUser(userId);
  const active = orgs.find((o) => o.id === orgId) ?? orgs[0];
  if (!active) redirect("/no-org");
  return (
    <div className="flex min-h-dvh">
      <AppNav role={active.role} />
      <div className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <OrgSwitcher orgs={orgs} activeOrgId={active.id} />
          <span className="text-xs uppercase text-muted-foreground">{active.role}</span>
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
```

Create `app/no-org/page.tsx`. It lives outside the `(app)` group so it does not inherit the shell layout that redirects here:

```tsx
import { logoutAction } from "@/actions/auth";
export default function NoOrgPage() {
  return (
    <main className="mx-auto max-w-sm p-8 text-center text-sm">
      <p>You are not a member of any organization. Ask a manager for an invitation.</p>
      <form action={logoutAction} className="mt-4"><button className="underline">Sign out</button></form>
    </main>
  );
}
```

- [ ] **Step 2: Dashboard**

Create `app/(app)/page.tsx`:

```tsx
import Link from "next/link";
import { requireUser, requireOrgRole, roleAtLeast } from "@/lib/auth/guard";
import { listProperties } from "@/lib/services/property";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function DashboardPage() {
  const ctx = await requireUser();
  const role = await requireOrgRole(ctx, "WORKER");
  const properties = await listProperties(ctx);
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Properties</h1>
        {roleAtLeast(role, "MANAGER") && <Button asChild><Link href="/properties/new">New property</Link></Button>}
      </div>
      {properties.length === 0 && <p className="text-sm text-muted-foreground">No properties yet.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {properties.map((p) => (
          <Link key={p.id} href={`/properties/${p.id}`}>
            <Card className="h-full hover:bg-accent/40">
              <CardHeader><CardTitle className="text-base">{p.name}</CardTitle></CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {p.address ?? "No address"} · {p.memberCount} member{p.memberCount === 1 ? "" : "s"}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: New property**

Create `app/(app)/properties/new/property-form.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { createPropertyAction, updatePropertyAction } from "@/actions/property";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

export function PropertyForm({ property }: { property?: { id: string; name: string; address: string | null } }) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const input = { name: String(fd.get("name")), address: String(fd.get("address") ?? "") };
        start(async () => {
          const res = property ? await updatePropertyAction(property.id, input) : await createPropertyAction(input);
          if (res && !res.ok) setError(res.error); else setSaved(true);
        });
      }}
      className="max-w-md space-y-4"
    >
      <div className="space-y-1"><Label htmlFor="name">Name</Label><Input id="name" name="name" defaultValue={property?.name} required /></div>
      <div className="space-y-1"><Label htmlFor="address">Address</Label><Input id="address" name="address" defaultValue={property?.address ?? ""} /></div>
      <FormError message={error} />
      {saved && property && <p className="text-sm text-muted-foreground">Saved.</p>}
      <SubmitButton pending={pending}>{property ? "Save" : "Create property"}</SubmitButton>
    </form>
  );
}
```

Create `app/(app)/properties/new/page.tsx`:

```tsx
import { requireUser, requireOrgRole } from "@/lib/auth/guard";
import { PropertyForm } from "./property-form";

export default async function NewPropertyPage() {
  await requireOrgRole(await requireUser(), "MANAGER");
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">New property</h1>
      <PropertyForm />
    </div>
  );
}
```

- [ ] **Step 4: Property detail with members and delete**

Create `app/(app)/properties/[id]/members.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { addPropertyMemberAction, removePropertyMemberAction } from "@/actions/property";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";

type Member = { userId: string; name: string; email: string | null; phone: string | null };

export function PropertyMembers({ propertyId, members, candidates, canEdit }: {
  propertyId: string; members: Member[]; candidates: Member[]; canEdit: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => { const r = await fn(); if (!r.ok) setError(r.error ?? "Failed"); });

  return (
    <section className="space-y-3">
      <h2 className="font-medium">Members</h2>
      <ul className="divide-y rounded-md border">
        {members.length === 0 && <li className="p-3 text-sm text-muted-foreground">Nobody assigned yet.</li>}
        {members.map((m) => (
          <li key={m.userId} className="flex items-center justify-between p-3 text-sm">
            <span>{m.name} <span className="text-muted-foreground">{m.email ?? m.phone}</span></span>
            {canEdit && (
              <Button variant="ghost" size="sm" disabled={pending}
                onClick={() => act(() => removePropertyMemberAction(propertyId, m.userId))}>Remove</Button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && candidates.length > 0 && (
        <select aria-label="Add member" className="rounded-md border bg-background px-2 py-1 text-sm" disabled={pending} value=""
          onChange={(e) => e.target.value && act(() => addPropertyMemberAction(propertyId, e.target.value))}>
          <option value="">Add a member…</option>
          {candidates.map((c) => <option key={c.userId} value={c.userId}>{c.name}</option>)}
        </select>
      )}
      <FormError message={error} />
    </section>
  );
}
```

Create `app/(app)/properties/[id]/danger.tsx`:

```tsx
"use client";
import { useTransition } from "react";
import { deletePropertyAction } from "@/actions/property";
import { Button } from "@/components/ui/button";

export function DeleteProperty({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="destructive" size="sm" disabled={pending}
      onClick={() => { if (confirm(`Delete "${name}"? This cannot be undone.`)) start(async () => { await deletePropertyAction(id); }); }}>
      Delete property
    </Button>
  );
}
```

Create `app/(app)/properties/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireUser, requireOrgRole, roleAtLeast } from "@/lib/auth/guard";
import { getProperty } from "@/lib/services/property";
import { listMembers } from "@/lib/services/member";
import { AppError } from "@/lib/errors";
import { PropertyForm } from "../new/property-form";
import { PropertyMembers } from "./members";
import { DeleteProperty } from "./danger";

export default async function PropertyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireUser();
  const role = await requireOrgRole(ctx, "WORKER");
  const canEdit = roleAtLeast(role, "MANAGER");
  let property;
  try {
    property = await getProperty(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const assigned = new Set(property.members.map((m) => m.userId));
  const candidates = canEdit
    ? (await listMembers(ctx)).filter((m) => !assigned.has(m.userId)).map(({ userId, name, email, phone }) => ({ userId, name, email, phone }))
    : [];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">{property.name}</h1>
        <p className="text-sm text-muted-foreground">{property.address ?? "No address"}</p>
      </div>
      {canEdit && <PropertyForm property={property} />}
      <PropertyMembers propertyId={property.id} members={property.members} candidates={candidates} canEdit={canEdit} />
      {canEdit && <DeleteProperty id={property.id} name={property.name} />}
    </div>
  );
}
```

- [ ] **Step 5: Manual verification**

`pnpm dev`. Sign in as the owner created in Task 11. Create a property, edit it, open it. Confirm the bottom nav shows below 768px width and the sidebar above. Resize the browser to 400px width and confirm no horizontal scroll.

Run `pnpm build`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add app shell, dashboard, and property pages"
```

---

### Task 13: Team and settings pages

**Files:**
- Create: `app/(app)/team/page.tsx`, `app/(app)/team/invite-form.tsx`, `app/(app)/team/member-row.tsx`, `app/(app)/team/invite-row.tsx`, `app/(app)/error.tsx`, `app/(app)/settings/page.tsx`, `app/(app)/settings/org-form.tsx`, `app/(app)/settings/password-form.tsx`

**Interfaces:**
- Consumes: `listMembers`, `listInvites`, `listProperties`, member/invite/org/auth actions, `roleAtLeast`.

- [ ] **Step 1: Invite form**

Create `app/(app)/team/invite-form.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { createInviteAction } from "@/actions/invite";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

export function InviteForm({ properties, canInviteOwner }: { properties: { id: string; name: string }[]; canInviteOwner: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        start(async () => {
          const res = await createInviteAction({
            email: String(fd.get("email")),
            role: String(fd.get("role")) as "OWNER" | "MANAGER" | "WORKER",
            propertyIds: fd.getAll("propertyIds").map(String),
          });
          if (!res.ok) { setError(res.error); setSent(false); } else { setError(null); setSent(true); form.reset(); }
        });
      }}
      className="max-w-md space-y-4 rounded-md border p-4"
    >
      <h2 className="font-medium">Invite someone</h2>
      <div className="space-y-1"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required /></div>
      <div className="space-y-1">
        <Label htmlFor="role">Role</Label>
        <select id="role" name="role" defaultValue="WORKER" className="w-full rounded-md border bg-background px-2 py-2 text-sm">
          <option value="WORKER">Worker</option>
          <option value="MANAGER">Manager</option>
          {canInviteOwner && <option value="OWNER">Owner</option>}
        </select>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Properties</legend>
        {properties.length === 0 && <p className="text-sm text-muted-foreground">No properties yet.</p>}
        {properties.map((p) => (
          <label key={p.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="propertyIds" value={p.id} /> {p.name}
          </label>
        ))}
      </fieldset>
      <FormError message={error} />
      {sent && <p className="text-sm text-muted-foreground">Invitation sent.</p>}
      <SubmitButton pending={pending}>Send invitation</SubmitButton>
    </form>
  );
}
```

- [ ] **Step 2: Member and invite rows**

Create `app/(app)/team/member-row.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { changeRoleAction, removeMemberAction } from "@/actions/member";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";

export function MemberRow({ member, isOwner, isSelf }: {
  member: { userId: string; name: string; email: string | null; phone: string | null; role: string; propertyCount: number };
  isOwner: boolean; isSelf: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
      <div>
        <div>{member.name}{isSelf && <span className="text-muted-foreground"> (you)</span>}</div>
        <div className="text-muted-foreground">{member.email ?? member.phone} · {member.propertyCount} propert{member.propertyCount === 1 ? "y" : "ies"}</div>
        <FormError message={error} />
      </div>
      <div className="flex items-center gap-2">
        {isOwner ? (
          <select aria-label={`Role for ${member.name}`} className="rounded-md border bg-background px-2 py-1" value={member.role} disabled={pending}
            onChange={(e) => start(async () => { const r = await changeRoleAction(member.userId, e.target.value); if (!r.ok) setError(r.error); })}>
            <option value="OWNER">Owner</option><option value="MANAGER">Manager</option><option value="WORKER">Worker</option>
          </select>
        ) : <span className="text-muted-foreground">{member.role}</span>}
        {isOwner && !isSelf && (
          <Button variant="ghost" size="sm" disabled={pending}
            onClick={() => { if (confirm(`Remove ${member.name}?`)) start(async () => { const r = await removeMemberAction(member.userId); if (!r.ok) setError(r.error); }); }}>
            Remove
          </Button>
        )}
      </div>
    </li>
  );
}
```

Create `app/(app)/team/invite-row.tsx`:

```tsx
"use client";
import { useTransition } from "react";
import { revokeInviteAction } from "@/actions/invite";
import { Button } from "@/components/ui/button";

export function InviteRow({ invite }: { invite: { id: string; email: string; role: string; expiresAt: Date } }) {
  const [pending, start] = useTransition();
  return (
    <li className="flex items-center justify-between p-3 text-sm">
      <span>{invite.email} <span className="text-muted-foreground">· {invite.role.toLowerCase()} · expires {invite.expiresAt.toLocaleDateString()}</span></span>
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => start(async () => { await revokeInviteAction(invite.id); })}>Revoke</Button>
    </li>
  );
}
```

- [ ] **Step 3: Team page**

Create `app/(app)/team/page.tsx`:

```tsx
import { requireUser, requireOrgRole } from "@/lib/auth/guard";
import { listMembers } from "@/lib/services/member";
import { listInvites } from "@/lib/services/invite";
import { listProperties } from "@/lib/services/property";
import { InviteForm } from "./invite-form";
import { MemberRow } from "./member-row";
import { InviteRow } from "./invite-row";

export default async function TeamPage() {
  const ctx = await requireUser();
  const role = await requireOrgRole(ctx, "MANAGER");
  const [members, invites, properties] = await Promise.all([listMembers(ctx), listInvites(ctx), listProperties(ctx)]);
  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Team</h1>
      <ul className="divide-y rounded-md border">
        {members.map((m) => (
          <MemberRow key={m.userId} isOwner={role === "OWNER"} isSelf={m.userId === ctx.userId}
            member={{ ...m, propertyCount: m.propertyIds.length }} />
        ))}
      </ul>
      {invites.length > 0 && (
        <section>
          <h2 className="mb-2 font-medium">Pending invitations</h2>
          <ul className="divide-y rounded-md border">{invites.map((i) => <InviteRow key={i.id} invite={i} />)}</ul>
        </section>
      )}
      <InviteForm properties={properties} canInviteOwner={role === "OWNER"} />
    </div>
  );
}
```

A Worker hitting `/team` gets a FORBIDDEN error from `requireOrgRole`. Create `app/(app)/error.tsx` so it renders as a page rather than a crash:

```tsx
"use client";
export default function AppError({ error }: { error: Error }) {
  const forbidden = error.message === "Forbidden";
  return (
    <div className="p-6 text-sm">
      <p className="font-medium">{forbidden ? "You don't have access to this page." : "Something went wrong."}</p>
    </div>
  );
}
```

- [ ] **Step 4: Settings page**

Create `app/(app)/settings/org-form.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { renameOrgAction } from "@/actions/org";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

export function OrgForm({ name }: { name: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget);
      start(async () => { const r = await renameOrgAction({ name: String(fd.get("name")) }); setError(r.ok ? null : r.error); }); }}
      className="max-w-md space-y-3">
      <h2 className="font-medium">Organization</h2>
      <div className="space-y-1"><Label htmlFor="orgName">Name</Label><Input id="orgName" name="name" defaultValue={name} required /></div>
      <FormError message={error} />
      <SubmitButton pending={pending}>Save</SubmitButton>
    </form>
  );
}
```

Create `app/(app)/settings/password-form.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { changePasswordAction } from "@/actions/auth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

export function PasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  return (
    <form onSubmit={(e) => { e.preventDefault(); const form = e.currentTarget; const fd = new FormData(form);
      start(async () => {
        const r = await changePasswordAction({ current: String(fd.get("current")), next: String(fd.get("next")) });
        if (r.ok) { setDone(true); setError(null); form.reset(); } else { setDone(false); setError(r.error); }
      }); }}
      className="max-w-md space-y-3">
      <h2 className="font-medium">Change password</h2>
      <div className="space-y-1"><Label htmlFor="current">Current password</Label><Input id="current" name="current" type="password" required autoComplete="current-password" /></div>
      <div className="space-y-1"><Label htmlFor="next">New password (8+ characters)</Label><Input id="next" name="next" type="password" minLength={8} required autoComplete="new-password" /></div>
      <FormError message={error} />
      {done && <p className="text-sm text-muted-foreground">Password updated.</p>}
      <SubmitButton pending={pending}>Update password</SubmitButton>
    </form>
  );
}
```

Create `app/(app)/settings/page.tsx`:

```tsx
import { requireUser, requireOrgRole } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { OrgForm } from "./org-form";
import { PasswordForm } from "./password-form";

export default async function SettingsPage() {
  const ctx = await requireUser();
  const role = await requireOrgRole(ctx, "WORKER");
  const org = await db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { name: true } });
  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Settings</h1>
      {role === "OWNER" && <OrgForm name={org.name} />}
      <PasswordForm />
    </div>
  );
}
```

- [ ] **Step 5: Manual verification and build**

`pnpm dev`. As owner: invite a worker with one property, watch the console for the invite link, open it in a private window, create the account, confirm the worker sees only that property and no Team link. Back as owner: change the worker's role, then remove them. Rename the org. Change password.

Run `pnpm build`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add team and settings pages"
```

---

### Task 14: PWA manifest, service worker, install banner

**Files:**
- Create: `app/manifest.ts`, `app/sw.ts`, `public/icons/icon-192.png`, `public/icons/icon-512.png`, `components/install-banner.tsx`
- Modify: `next.config.ts`, `tsconfig.json`, `app/(app)/layout.tsx`, `.gitignore`

**Interfaces:**
- Produces: `/manifest.webmanifest`, `/sw.js` (built by Serwist), `<InstallBanner />`.

- [ ] **Step 1: Icons**

Generate placeholder icons (replace with real artwork later). Requires ImageMagick; if missing, `brew install imagemagick`:

```bash
mkdir -p public/icons
magick -size 512x512 xc:'#0f172a' -fill white -gravity center -pointsize 260 -annotate 0 '✓' public/icons/icon-512.png
magick public/icons/icon-512.png -resize 192x192 public/icons/icon-192.png
```

- [ ] **Step 2: Manifest**

Create `app/manifest.ts`:

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Checkly",
    short_name: "Checkly",
    description: "Property checklists for your team",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0f172a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
```

- [ ] **Step 3: Service worker with Serwist**

Create `app/sw.ts`:

```ts
import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope;

// Precache the built shell. Everything else is network-first via defaultCache; no offline data by design.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
```

Replace `next.config.ts`:

```ts
import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  output: "standalone",
};

export default withSerwist(nextConfig);
```

Add to `tsconfig.json` `compilerOptions.lib`: `"webworker"` (keep the existing entries), and add `"types": ["@serwist/next/typings"]` if the build complains about `WorkerGlobalScope`.

Append to `.gitignore`:

```
public/sw.js
public/sw.js.map
public/swe-worker-*.js
```

- [ ] **Step 4: Install banner**

Create `components/install-banner.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const KEY = "checkly.installDismissed";

export function InstallBanner() {
  const [evt, setEvt] = useState<BIP | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    try { if (localStorage.getItem(KEY)) return; } catch {}
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
    if (standalone) return;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos) setIos(true);
    const handler = (e: Event) => { e.preventDefault(); setEvt(e as BIP); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!evt && !ios) return null;
  const dismiss = () => { try { localStorage.setItem(KEY, "1"); } catch {} setEvt(null); setIos(false); };

  return (
    <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-md border bg-accent/40 p-3 text-sm md:hidden">
      <span>{ios ? "Install: tap Share, then “Add to Home Screen”." : "Install Checkly for quick access."}</span>
      <div className="flex gap-2">
        {evt && <Button size="sm" onClick={async () => { await evt.prompt(); dismiss(); }}>Install</Button>}
        <Button size="sm" variant="ghost" onClick={dismiss}>Not now</Button>
      </div>
    </div>
  );
}
```

In `app/(app)/layout.tsx`, render `<InstallBanner />` directly under the `<header>` element.

- [ ] **Step 5: Verify**

```bash
pnpm build && pnpm start
```

Open `http://localhost:3000/manifest.webmanifest` and confirm JSON. Open DevTools → Application → Service Workers: `sw.js` registered. Lighthouse PWA category: installable. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add PWA manifest, service worker, and install banner"
```

---

### Task 15: Seed script and Dockerfile

**Files:**
- Create: `prisma/seed.ts`, `Dockerfile`, `.dockerignore`
- Modify: `package.json` (prisma seed config)

- [ ] **Step 1: Seed**

Create `prisma/seed.ts`:

```ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../lib/auth/password";

const db = new PrismaClient();

async function main() {
  const passwordHash = await hashPassword("password123");
  const org = await db.org.create({ data: { name: "Seaside Rentals" } });
  const mk = (name: string, email: string, phone?: string) =>
    db.user.upsert({ where: { email }, update: {}, create: { name, email, phone, passwordHash } });
  const owner = await mk("Olivia Owner", "owner@example.com", "+14155550100");
  const manager = await mk("Max Manager", "manager@example.com");
  const w1 = await mk("Wendy Worker", "wendy@example.com", "+14155550101");
  const w2 = await mk("Walt Worker", "walt@example.com");
  await db.orgMember.createMany({ data: [
    { orgId: org.id, userId: owner.id, role: "OWNER" },
    { orgId: org.id, userId: manager.id, role: "MANAGER" },
    { orgId: org.id, userId: w1.id, role: "WORKER" },
    { orgId: org.id, userId: w2.id, role: "WORKER" },
  ] });
  const villa = await db.property.create({ data: { orgId: org.id, name: "Villa Azul", address: "12 Ocean Dr" } });
  const loft = await db.property.create({ data: { orgId: org.id, name: "Harbor Loft", address: "3 Pier St" } });
  await db.propertyMember.createMany({ data: [
    { propertyId: villa.id, userId: manager.id },
    { propertyId: loft.id, userId: manager.id },
    { propertyId: villa.id, userId: w1.id },
    { propertyId: loft.id, userId: w2.id },
  ] });
  console.log("Seeded. Login: owner@example.com / password123 (also manager@, wendy@, walt@)");
}

main().finally(() => db.$disconnect());
```

Add to `package.json` top level:

```json
"prisma": { "seed": "tsx prisma/seed.ts" }
```

Run: `pnpm prisma migrate reset --force` (drops, migrates, seeds). Sign in as `owner@example.com` and confirm two properties.

- [ ] **Step 2: Dockerfile**

Create `.dockerignore`:

```
node_modules
.next
.git
.env
.env.*
coverage
playwright-report
test-results
```

Create `Dockerfile`:

```dockerfile
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate && pnpm build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
EXPOSE 3000
CMD ["node", "server.js"]
```

Migrations run separately before deploy: `pnpm prisma migrate deploy` against the production `DATABASE_URL`.

Verify: `docker build -t checkly .` succeeds.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: add seed script and Dockerfile"
```

---

### Task 16: Playwright smoke test

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`

- [ ] **Step 1: Install browser and config**

```bash
pnpm exec playwright install chromium
```

Create `playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3100", trace: "retain-on-failure" },
  webServer: {
    command: "pnpm db:push:test && dotenv -e .env -- sh -c 'DATABASE_URL=$DATABASE_URL_TEST APP_URL=http://localhost:3100 pnpm dev -p 3100'",
    url: "http://localhost:3100/login",
    reuseExistingServer: false,
    stdout: "pipe",
    timeout: 120_000,
  },
});
```

Because the dev server logs invite emails to stdout, the test reads the invite token from the test database directly instead of parsing logs.

- [ ] **Step 2: Write the smoke test**

Create `e2e/smoke.spec.ts`:

```ts
import "dotenv/config";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL_TEST });
const stamp = Date.now();
const ownerEmail = `owner${stamp}@test.local`;
const workerEmail = `worker${stamp}@test.local`;

test("owner signs up, creates property, invites worker; worker sees only that property", async ({ page, browser }) => {
  await page.goto("/signup");
  await page.fill("#orgName", "E2E Org");
  await page.fill("#name", "Owner");
  await page.fill("#email", ownerEmail);
  await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Properties" })).toBeVisible();

  await page.getByRole("link", { name: "New property" }).click();
  await page.fill("#name", "Villa One");
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Villa One" })).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", { name: "New property" }).click();
  await page.fill("#name", "Villa Two");
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Villa Two" })).toBeVisible();

  await page.goto("/team");
  await page.fill("#email", workerEmail);
  await page.selectOption("#role", "WORKER");
  await page.getByLabel("Villa One").check();
  await page.click("button[type=submit]");
  await expect(page.getByText("Invitation sent.")).toBeVisible();

  const invite = await db.invite.findFirstOrThrow({ where: { email: workerEmail } });

  const ctx = await browser.newContext();
  const worker = await ctx.newPage();
  await worker.goto(`/invite/${invite.token}`);
  await worker.fill("#name", "Worker");
  await worker.fill("#password", "password123");
  await worker.click("button[type=submit]");
  await expect(worker.getByRole("heading", { name: "Properties" })).toBeVisible();
  await expect(worker.getByText("Villa One")).toBeVisible();
  await expect(worker.getByText("Villa Two")).toHaveCount(0);
  await expect(worker.getByRole("link", { name: "Team" })).toHaveCount(0);
  await ctx.close();
});
```

- [ ] **Step 3: Run**

Run: `pnpm e2e`
Expected: 1 passed. If the signup redirect lands before the dashboard heading renders, increase the `expect` timeout rather than adding sleeps.

- [ ] **Step 4: Commit**

```bash
git add playwright.config.ts e2e
git commit -m "test: add playwright smoke test for signup, property, and invite flow"
```

---

### Task 17: README and final check

**Files:**
- Create: `README.md`

- [ ] **Step 1: README**

Create `README.md`:

```markdown
# Checkly

Property checklists for your team. Managers create properties and invite staff on the web; workers use the installable PWA on their phones.

## Development

```bash
cp .env.example .env            # then set AUTH_SECRET: openssl rand -hex 32
docker compose up -d            # Postgres + MinIO
docker compose exec db psql -U checkly -c 'CREATE DATABASE checkly_test;'
pnpm install
pnpm db:migrate
pnpm db:seed                    # owner@example.com / password123
pnpm dev
```

## Tests

```bash
pnpm test        # vitest: unit + services against checkly_test
pnpm e2e         # playwright smoke
```

## Deploy

Build the image with `docker build -t checkly .`, run `pnpm prisma migrate deploy` against the production database, then run the image with `DATABASE_URL`, `AUTH_SECRET`, `APP_URL`, `RESEND_API_KEY`, `EMAIL_FROM` set.
```

- [ ] **Step 2: Full verification**

```bash
pnpm lint && pnpm test && pnpm build && pnpm e2e
```

Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README"
```
