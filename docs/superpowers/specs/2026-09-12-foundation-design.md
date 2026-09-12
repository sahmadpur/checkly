# Checkly — Sub-project 1: Foundation

Date: 2026-09-12
Status: approved design, awaiting implementation plan

## Product context

Checkly is a multi-tenant SaaS for property operations. Managers on a desktop web app create properties, invite staff, build checklists, assign them to workers, and schedule them. Workers use an installable PWA on their phones to see and complete their checklists.

The full product is decomposed into three sub-projects, built in order:

1. **Foundation** (this spec): repo, data model, auth, orgs, properties, membership, invites, PWA shell.
2. **Checklists**: templates with typed items (checkbox, text, number, photo, select), instances, worker completion UI, photo upload to MinIO.
3. **Scheduling and notifications**: recurrence rules (daily, weekly on chosen days, monthly on date) with a custom due time per checklist, instance generation, overdue state, web push and email notifications.

Decisions that shape all three, already made:

- Online only. PWA is installable with a cached shell but does not work offline.
- Fixed roles: Owner, Manager, Worker.
- One checklist instance per assigned user.
- No billing in v1. Orgs are isolated; a plan field can be added later.
- Stack: Next.js (App Router), Postgres, Prisma, Auth.js v5, Tailwind + shadcn/ui, MinIO for object storage, Resend for email.

## Scope of this sub-project

In scope:

- Signup creates a user, an org, and an Owner membership.
- Login with email or phone number plus password.
- Password reset via email link.
- Org CRUD (rename), org switcher for users in multiple orgs.
- Property CRUD.
- Team page: list org members, change role, remove member.
- Invite flow: email, role, and property list; link with token; acceptance creates or reuses the user.
- Property membership management.
- Responsive app shell serving both desktop managers and phone workers.
- PWA manifest and service worker (shell precache only).
- Docker Compose dev environment, seed script, Dockerfile.

Out of scope (later sub-projects or later versions):

- Checklists, scheduling, notifications, push subscriptions.
- Custom roles, per-property roles, audit log, soft delete.
- Email or SMS verification of identifiers.
- Billing.
- OAuth providers.

## Data model

Prisma schema, Postgres.

```
Org             id, name, createdAt
User            id, email?, phone?, passwordHash, name, createdAt
                @@unique(email) @@unique(phone)
                App-level rule: at least one of email or phone required.
OrgMember       id, orgId, userId, role (OWNER | MANAGER | WORKER)
                @@unique(orgId, userId)
Property        id, orgId, name, address?, createdAt
PropertyMember  id, propertyId, userId
                @@unique(propertyId, userId)
Invite          id, orgId, email, role, propertyIds (Json string[]),
                token (unique), expiresAt, acceptedAt?, createdAt
PasswordReset   id, userId, token (unique), expiresAt, usedAt?
```

Rules:

- Role is per org, stored on OrgMember. A user has exactly one role per org.
- Property visibility: Owners see every property in the org. Managers and Workers see only properties where a PropertyMember row exists.
- A user may belong to many orgs. The session carries `activeOrgId`.
- Deleting a property cascades to PropertyMember. Deleting an org member cascades to their PropertyMember rows in that org.
- Phone numbers are stored in E.164 format.
- Invite tokens and reset tokens are random 32-byte values, hex encoded, stored as-is. Expiry: invites 7 days, resets 1 hour.

## Auth

- Auth.js v5 with the Credentials provider. JWT session strategy, no session table.
- Login form: one `identifier` field and a `password` field. If the identifier contains `@`, look up by email. Otherwise normalize with `libphonenumber-js` to E.164 and look up by phone. Compare with bcrypt.
- JWT payload: `userId`, `activeOrgId`. Switching org is a server action that validates membership and re-issues the token.
- Signup: public form with name, email, password, optional phone, org name. Creates User, Org, OrgMember(OWNER) in one transaction. Logs in immediately.
- Invite acceptance at `/invite/[token]`: if the invite email matches an existing user, the user logs in (or is already logged in) and accepts. Otherwise a form collects name, password, optional phone and creates the user. Either way, OrgMember and PropertyMember rows are created and `acceptedAt` is set.
- Password reset: request form takes an identifier; if a user with an email exists, send a link. Always show the same confirmation message. Reset page sets the new password and marks the token used.
- No email or phone verification in v1. Invites prove email ownership for invited users.

## Authorization

Single module `lib/auth/guard.ts`:

```ts
requireUser()                        // returns session or redirects to /login
requireOrgRole(minRole)              // OWNER > MANAGER > WORKER; uses activeOrgId; throws Forbidden
requirePropertyAccess(propertyId)    // Owner: any property in active org; else PropertyMember row must exist
```

Rules:

- Every server action calls one of these first.
- Every Prisma query filters by `orgId` taken from the session, never from client input.
- Permissions by role:
  - Owner: everything, including deleting the org and changing roles.
  - Manager: create and edit properties, invite Managers and Workers, manage property membership.
  - Worker: read own properties only.
- Rate limiting: in-memory token bucket per IP on login, signup, invite send, and reset request. Single instance in v1. Marked with a `ponytail:` comment noting Redis as the upgrade path.

## App structure

Routes (App Router):

```
/login  /signup  /forgot  /reset/[token]  /invite/[token]
/(app)/                    dashboard: property list, org switcher
/(app)/properties/[id]     property detail, members tab
/(app)/team                org members, invite form, role edit
/(app)/settings            org name, profile, password change
```

Files:

```
prisma/schema.prisma
prisma/seed.ts
lib/db.ts
lib/auth/config.ts        Auth.js configuration
lib/auth/guard.ts
lib/auth/password.ts      bcrypt hash and compare
lib/auth/phone.ts         normalize to E.164
lib/ratelimit.ts
lib/email.ts              sendMail(to, subject, html) via Resend; logs to console if no API key
actions/auth.ts  actions/org.ts  actions/property.ts  actions/member.ts  actions/invite.ts
app/(auth)/...
app/(app)/...
app/api/auth/[...nextauth]/route.ts
app/manifest.webmanifest
```

UI:

- Tailwind and shadcn/ui. Mobile first. Bottom navigation below the `md` breakpoint, sidebar above it.
- One app serves both audiences. Workers see a reduced navigation. Sub-project 2 adds `/today` as the worker home.

PWA:

- `manifest.webmanifest` with name, icons, `display: standalone`, theme color.
- Service worker via `@serwist/next`: precache the app shell, network-first for everything else. No offline data.
- Dismissible install banner on mobile for users who have not installed the app.

## Error handling

- Server actions return `{ ok: true, data }` or `{ ok: false, error: string }`. They never throw to the client except for the auth redirect.
- Zod validates every action input.
- Unauthenticated: redirect to `/login`. Wrong role: `{ ok: false, error: "Forbidden" }`, pages render a 403 state.
- Unique constraint violations on email or phone map to a friendly message. Prisma error text never reaches the client.

## Testing

- Vitest. Unit tests for `guard.ts`, `phone.ts`, token creation and expiry, and each action module.
- Action tests run against a real Postgres in Docker using `DATABASE_URL_TEST`. No Prisma mocking. Tables are truncated between tests.
- One Playwright smoke test: signup, create property, send invite, accept invite in a fresh browser context, confirm the worker sees only the assigned property. Runs in CI.
- No component unit tests.

## Dev setup and deploy

- `docker-compose.yml` with Postgres 16 and MinIO. MinIO is unused until sub-project 2 but lives in the same file.
- `pnpm install`, `pnpm prisma migrate dev`, `pnpm prisma db seed`, `pnpm dev`.
- Seed: one org, one Owner, one Manager, two Workers, two properties, memberships wired up.
- Environment variables: `DATABASE_URL`, `DATABASE_URL_TEST`, `AUTH_SECRET`, `APP_URL`, `RESEND_API_KEY` (optional), `EMAIL_FROM`.
- Dockerfile for the Next.js app. No host-specific code.
