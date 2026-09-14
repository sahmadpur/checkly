# Checklists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Managers build reusable checklist templates, assign them at a property to workers with a due time, and review submissions; workers complete their own copy on the phone with autosave, photos and videos.

**Architecture:** Same shape as the foundation: Prisma models, service functions in `lib/services/*` that take `Ctx` and enforce authorization, thin server actions through `run()`, server-component pages with small client forms. Items are relational; assignment freezes a copy of the template items into `InstanceItem` rows. Media goes straight from the phone to S3-compatible storage (MinIO) via presigned PUT; Next never proxies bytes.

**Tech Stack:** Next 16.3 (App Router, `next build --webpack`), React 19, Prisma 7.10 (`@prisma/adapter-pg`), Postgres, Auth.js v5, zod 4, Tailwind 4 + shadcn (Base UI: `Button` uses `render`, no `asChild`), `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, MinIO, Vitest 5 on real Postgres, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-14-checklists-design.md`

## Global Constraints

- Every query that touches org data filters by `orgId` from `ctx`, never from client input. Services are the authorization boundary; pages and actions only call them.
- Roles OWNER > MANAGER > WORKER via `requireOrgRole`; property scoping via `requirePropertyAccess` (owner sees all, others need a PropertyMember row; NOT_FOUND on miss).
- Item types exactly `CHECKBOX | TEXT | NUMBER | PHOTO | VIDEO | SELECT`. Instance statuses exactly `OPEN | SUBMITTED | APPROVED | REJECTED`.
- Transitions: OPEN→SUBMITTED (submit), SUBMITTED→APPROVED|REJECTED (review), REJECTED→SUBMITTED (submit). `answerItem` only in OPEN or REJECTED. REJECTED review requires a non-empty comment. Illegal transition → INVALID naming the current status.
- "Answered": CHECKBOX `checked === true`; TEXT non-empty; NUMBER not null; SELECT not null; PHOTO/VIDEO `fileKey` not null. `submit` with missing required → INVALID `Missing: <label>, <label>`.
- Overdue is derived (`dueAt < now` and status OPEN or REJECTED), never stored.
- Media: one file per item. Photo max 5 MB, types `image/jpeg`, `image/png`, `image/webp`, presigned PUT 5 min, client resize to 1600 px long edge JPEG q0.8. Video max 100 MB, types `video/mp4`, `video/quicktime`, `video/webm`, presigned PUT 10 min, no transcoding. Key `org/<orgId>/instances/<instanceId>/<itemId>.<ext>`. `answerItem` accepts a `fileKey` only if it starts with `org/<ctx.orgId>/instances/<instanceId>/<itemId>.`. Downloads via presigned GET, 15 min. Bucket private.
- Removing a member deletes their OPEN and REJECTED instances in that org and keeps SUBMITTED and APPROVED.
- Server actions return `ActionResult` via `run()`; zod validates every input; schemas live in `actions/*.schemas.ts` (never exported from `"use server"` files). Prisma error text never reaches the client.
- Tests run against real Postgres (`checkly_test`, truncated before each test); no Prisma mocks. Storage test skips when `S3_ENDPOINT` is unset.
- pnpm; conventional commits; every commit message ends with the two attribution lines given by the controller.

## File Structure

```
prisma/schema.prisma                         + enums ItemType, InstanceStatus; models ChecklistTemplate, TemplateItem, ChecklistInstance, InstanceItem
prisma/migrations/<ts>_checklists/
tests/helpers/db.ts                          resetDb truncates new tables; makeTemplate, makeInstance helpers
lib/services/template.ts                     template CRUD + archive
lib/services/instance.ts                     assign, lists, get, answerItem, submit, review, counts
lib/services/member.ts                       removeMember deletes OPEN/REJECTED instances
lib/storage.ts                               S3 client, presignUpload, presignDownload, deleteObject, mediaKey
lib/media.ts                                 allow-lists, size caps, ext by mime (shared by server + client)
scripts/storage-init.ts                      creates the bucket
lib/client/resize-image.ts                   canvas resize
lib/client/upload.ts                         XHR PUT with progress
actions/template.ts, actions/template.schemas.ts
actions/instance.ts, actions/instance.schemas.ts
app/(app)/templates/page.tsx, new/page.tsx, [id]/page.tsx, template-builder.tsx
app/(app)/properties/[id]/page.tsx           + Checklists section
app/(app)/properties/[id]/checklists.tsx     instance list with status filter
app/(app)/properties/[id]/assign-dialog.tsx  assign form
app/(app)/checklists/[id]/page.tsx           detail: fill form (assignee) or review view (manager)
app/(app)/checklists/[id]/fill-form.tsx      worker autosave form
app/(app)/checklists/[id]/media-item.tsx     capture + upload + preview
app/(app)/checklists/[id]/review-form.tsx    approve / reject
app/(app)/today/page.tsx                     worker home
app/(app)/page.tsx                           worker → /today redirect; open/overdue counts on cards
components/app-nav.tsx                       Today for workers, Templates for managers
components/status-badge.tsx                  status chip
tests/services/template.test.ts, instance.test.ts, storage.test.ts; tests/unit/media.test.ts, checklist-schemas.test.ts
e2e/checklist.spec.ts, e2e/fixtures/photo.jpg
docker-compose.yml, .env.example, .github/workflows/ci.yml, README.md, package.json
```

---

### Task 1: Schema, migration, test helpers

**Files:**
- Modify: `prisma/schema.prisma` (append), `tests/helpers/db.ts`
- Create: migration via `prisma migrate dev`
- Test: `tests/services/checklist-schema.test.ts`

**Interfaces:**
- Produces: Prisma models `ChecklistTemplate`, `TemplateItem`, `ChecklistInstance`, `InstanceItem`; enums `ItemType`, `InstanceStatus` from `@prisma/client`. Helpers `makeTemplate(orgId, items?)`, `makeInstance({ orgId, propertyId, assigneeId, assignedById, items?, dueAt?, status? })` from `@/tests/helpers/db`.

- [ ] **Step 1: Append to `prisma/schema.prisma`**

Add relation fields on existing models: on `Org` add `templates ChecklistTemplate[]` and `instances ChecklistInstance[]`; on `Property` add `instances ChecklistInstance[]`; on `User` add `assignedInstances ChecklistInstance[] @relation("Assignee")`, `createdInstances ChecklistInstance[] @relation("AssignedBy")`, `reviewedInstances ChecklistInstance[] @relation("ReviewedBy")`. Then append:

```prisma
enum ItemType {
  CHECKBOX
  TEXT
  NUMBER
  PHOTO
  VIDEO
  SELECT
}

enum InstanceStatus {
  OPEN
  SUBMITTED
  APPROVED
  REJECTED
}

model ChecklistTemplate {
  id          String              @id @default(cuid())
  orgId       String
  name        String
  description String?
  archivedAt  DateTime?
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt
  org         Org                 @relation(fields: [orgId], references: [id], onDelete: Cascade)
  items       TemplateItem[]
  instances   ChecklistInstance[]

  @@index([orgId])
}

model TemplateItem {
  id         String            @id @default(cuid())
  templateId String
  order      Int
  type       ItemType
  label      String
  required   Boolean           @default(true)
  options    String[]          @default([])
  min        Float?
  max        Float?
  template   ChecklistTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)

  @@unique([templateId, order])
}

model ChecklistInstance {
  id            String             @id @default(cuid())
  orgId         String
  propertyId    String
  templateId    String?
  templateName  String
  assigneeId    String
  assignedById  String
  dueAt         DateTime
  status        InstanceStatus     @default(OPEN)
  submittedAt   DateTime?
  reviewedAt    DateTime?
  reviewedById  String?
  reviewComment String?
  createdAt     DateTime           @default(now())
  org           Org                @relation(fields: [orgId], references: [id], onDelete: Cascade)
  property      Property           @relation(fields: [propertyId], references: [id], onDelete: Cascade)
  template      ChecklistTemplate? @relation(fields: [templateId], references: [id], onDelete: SetNull)
  assignee      User               @relation("Assignee", fields: [assigneeId], references: [id], onDelete: Restrict)
  assignedBy    User               @relation("AssignedBy", fields: [assignedById], references: [id], onDelete: Restrict)
  reviewedBy    User?              @relation("ReviewedBy", fields: [reviewedById], references: [id], onDelete: SetNull)
  items         InstanceItem[]

  @@index([orgId, assigneeId, status])
  @@index([propertyId, status])
}

model InstanceItem {
  id         String            @id @default(cuid())
  instanceId String
  order      Int
  type       ItemType
  label      String
  required   Boolean
  options    String[]          @default([])
  min        Float?
  max        Float?
  checked    Boolean?
  text       String?
  number     Float?
  choice     String?
  fileKey    String?
  fileType   String?
  answeredAt DateTime?
  instance   ChecklistInstance @relation(fields: [instanceId], references: [id], onDelete: Cascade)

  @@unique([instanceId, order])
}
```

- [ ] **Step 2: Migrate**

```bash
pnpm prisma migrate dev --name checklists
pnpm db:push:test
```

Expected: folder `prisma/migrations/<ts>_checklists` created; test DB updated.

- [ ] **Step 3: Update test helpers**

In `tests/helpers/db.ts`, change `resetDb` to:

```ts
export async function resetDb() {
  await db.$executeRawUnsafe(
    'TRUNCATE "InstanceItem","ChecklistInstance","TemplateItem","ChecklistTemplate","PasswordReset","Invite","PropertyMember","Property","OrgMember","User","Org" CASCADE'
  );
}
```

Append:

```ts
import { InstanceStatus, ItemType } from "@prisma/client";

export type ItemSeed = { type: ItemType; label: string; required?: boolean; options?: string[]; min?: number; max?: number };

export const defaultItems: ItemSeed[] = [
  { type: "CHECKBOX", label: "Beds made" },
  { type: "TEXT", label: "Notes", required: false },
  { type: "NUMBER", label: "Towels left", min: 0, max: 20 },
  { type: "SELECT", label: "Condition", options: ["Good", "Fair", "Poor"] },
  { type: "PHOTO", label: "Bathroom photo" },
];

export async function makeTemplate(orgId: string, items: ItemSeed[] = defaultItems, name = "Checkout clean") {
  return db.checklistTemplate.create({
    data: {
      orgId, name,
      items: { create: items.map((it, i) => ({ order: i, type: it.type, label: it.label, required: it.required ?? true, options: it.options ?? [], min: it.min ?? null, max: it.max ?? null })) },
    },
    include: { items: { orderBy: { order: "asc" } } },
  });
}

export async function makeInstance(input: {
  orgId: string; propertyId: string; assigneeId: string; assignedById: string;
  items?: ItemSeed[]; dueAt?: Date; status?: InstanceStatus; templateName?: string;
}) {
  const items = input.items ?? defaultItems;
  return db.checklistInstance.create({
    data: {
      orgId: input.orgId, propertyId: input.propertyId, assigneeId: input.assigneeId, assignedById: input.assignedById,
      templateName: input.templateName ?? "Checkout clean", dueAt: input.dueAt ?? new Date(Date.now() + 3600_000),
      status: input.status ?? "OPEN",
      items: { create: items.map((it, i) => ({ order: i, type: it.type, label: it.label, required: it.required ?? true, options: it.options ?? [], min: it.min ?? null, max: it.max ?? null })) },
    },
    include: { items: { orderBy: { order: "asc" } } },
  });
}
```

- [ ] **Step 4: Schema test**

Create `tests/services/checklist-schema.test.ts`:

```ts
import { expect, test } from "vitest";
import { db } from "@/lib/db";
import { makeInstance, makeMember, makeOrg, makeProperty, makeTemplate, makeUser } from "@/tests/helpers/db";

test("deleting a template sets instance.templateId null and keeps templateName", async () => {
  const org = await makeOrg();
  const u = await makeUser();
  await makeMember(org.id, u.id, "OWNER");
  const prop = await makeProperty(org.id);
  const tpl = await makeTemplate(org.id);
  const inst = await db.checklistInstance.create({
    data: { orgId: org.id, propertyId: prop.id, templateId: tpl.id, templateName: tpl.name, assigneeId: u.id, assignedById: u.id, dueAt: new Date() },
  });
  await db.checklistTemplate.delete({ where: { id: tpl.id } });
  const after = await db.checklistInstance.findUniqueOrThrow({ where: { id: inst.id } });
  expect(after.templateId).toBeNull();
  expect(after.templateName).toBe("Checkout clean");
});

test("deleting a property cascades instances and items; deleting an assignee is blocked", async () => {
  const org = await makeOrg();
  const u = await makeUser();
  await makeMember(org.id, u.id, "OWNER");
  const prop = await makeProperty(org.id);
  await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: u.id, assignedById: u.id });
  await expect(db.user.delete({ where: { id: u.id } })).rejects.toThrow();
  await db.property.delete({ where: { id: prop.id } });
  expect(await db.checklistInstance.count()).toBe(0);
  expect(await db.instanceItem.count()).toBe(0);
});
```

- [ ] **Step 5: Run**

Run: `pnpm test`
Expected: all previous tests plus 2 new pass.

- [ ] **Step 6: Commit**

```bash
git add prisma tests/helpers/db.ts tests/services/checklist-schema.test.ts
git commit -m "feat: add checklist template and instance schema"
```

---

### Task 2: Template service

**Files:**
- Create: `lib/services/template.ts`
- Test: `tests/services/template.test.ts`

**Interfaces:**
- Consumes: `Ctx`, `requireOrgRole` from `@/lib/auth/guard`; `db`; `invalid`, `notFound` from `@/lib/errors`.
- Produces:
  - `type ItemInput = { type: ItemType; label: string; required: boolean; options: string[]; min: number | null; max: number | null }`
  - `type TemplateSummary = { id; name; description; archivedAt; itemCount }`
  - `type TemplateDetail = { id; name; description; archivedAt; items: (ItemInput & { id: string; order: number })[] }`
  - `listTemplates(ctx, opts?: { includeArchived?: boolean }): Promise<TemplateSummary[]>` (MANAGER+)
  - `getTemplate(ctx, id): Promise<TemplateDetail>` (MANAGER+; NOT_FOUND cross-org)
  - `createTemplate(ctx, { name, description?, items }): Promise<{ id }>` (MANAGER+)
  - `updateTemplate(ctx, id, { name, description?, items }): Promise<void>` (MANAGER+; replaces items wholesale)
  - `archiveTemplate(ctx, id)`, `unarchiveTemplate(ctx, id)` (MANAGER+)
  - `validateItems(items: ItemInput[]): void` throws INVALID: empty list; SELECT with < 2 options or duplicate options; NUMBER with min > max; non-SELECT with options; non-NUMBER with min/max.

- [ ] **Step 1: Write failing tests**

Create `tests/services/template.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { db } from "@/lib/db";
import { archiveTemplate, createTemplate, getTemplate, listTemplates, updateTemplate, ItemInput } from "@/lib/services/template";
import { makeMember, makeOrg, makeUser } from "@/tests/helpers/db";

const item = (p: Partial<ItemInput> & Pick<ItemInput, "type" | "label">): ItemInput =>
  ({ required: true, options: [], min: null, max: null, ...p });

async function setup() {
  const org = await makeOrg();
  const mgr = await makeUser();
  const worker = await makeUser();
  await makeMember(org.id, mgr.id, "MANAGER");
  await makeMember(org.id, worker.id, "WORKER");
  return { org, ctx: { userId: mgr.id, orgId: org.id }, wctx: { userId: worker.id, orgId: org.id } };
}

describe("templates", () => {
  test("create, get, list; worker forbidden", async () => {
    const { ctx, wctx } = await setup();
    const { id } = await createTemplate(ctx, {
      name: "Clean", items: [item({ type: "CHECKBOX", label: "Beds" }), item({ type: "SELECT", label: "State", options: ["Good", "Bad"] })],
    });
    const t = await getTemplate(ctx, id);
    expect(t.items.map((i) => [i.order, i.type, i.label])).toEqual([[0, "CHECKBOX", "Beds"], [1, "SELECT", "State"]]);
    expect((await listTemplates(ctx)).map((t) => [t.name, t.itemCount])).toEqual([["Clean", 2]]);
    await expect(listTemplates(wctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("update replaces items wholesale", async () => {
    const { ctx } = await setup();
    const { id } = await createTemplate(ctx, { name: "A", items: [item({ type: "CHECKBOX", label: "One" }), item({ type: "TEXT", label: "Two" })] });
    await updateTemplate(ctx, id, { name: "B", items: [item({ type: "NUMBER", label: "Count", min: 0, max: 5 })] });
    const t = await getTemplate(ctx, id);
    expect(t.name).toBe("B");
    expect(t.items.map((i) => i.label)).toEqual(["Count"]);
    expect(await db.templateItem.count({ where: { templateId: id } })).toBe(1);
  });

  test("validation: empty items, bad select, bad number range", async () => {
    const { ctx } = await setup();
    await expect(createTemplate(ctx, { name: "X", items: [] })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createTemplate(ctx, { name: "X", items: [item({ type: "SELECT", label: "S", options: ["only"] })] })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createTemplate(ctx, { name: "X", items: [item({ type: "SELECT", label: "S", options: ["a", "a"] })] })).rejects.toMatchObject({ code: "INVALID" });
    await expect(createTemplate(ctx, { name: "X", items: [item({ type: "NUMBER", label: "N", min: 5, max: 1 })] })).rejects.toMatchObject({ code: "INVALID" });
  });

  test("archive hides from default list; cross-org is NOT_FOUND", async () => {
    const { ctx } = await setup();
    const other = await setup();
    const { id } = await createTemplate(ctx, { name: "A", items: [item({ type: "CHECKBOX", label: "One" })] });
    await archiveTemplate(ctx, id);
    expect(await listTemplates(ctx)).toEqual([]);
    expect((await listTemplates(ctx, { includeArchived: true })).length).toBe(1);
    await expect(getTemplate(other.ctx, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(archiveTemplate(other.ctx, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/services/template.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `lib/services/template.ts`:

```ts
import { ItemType } from "@prisma/client";
import { db } from "@/lib/db";
import { Ctx, requireOrgRole } from "@/lib/auth/guard";
import { invalid, notFound } from "@/lib/errors";

export type ItemInput = { type: ItemType; label: string; required: boolean; options: string[]; min: number | null; max: number | null };
export type TemplateInput = { name: string; description?: string | null; items: ItemInput[] };

export function validateItems(items: ItemInput[]) {
  if (items.length === 0) throw invalid("Add at least one item");
  for (const it of items) {
    if (!it.label.trim()) throw invalid("Every item needs a label");
    if (it.type === "SELECT") {
      const opts = it.options.map((o) => o.trim()).filter(Boolean);
      if (opts.length < 2) throw invalid(`"${it.label}" needs at least two options`);
      if (new Set(opts).size !== opts.length) throw invalid(`"${it.label}" has duplicate options`);
    } else if (it.options.length) throw invalid(`"${it.label}" cannot have options`);
    if (it.type === "NUMBER") {
      if (it.min != null && it.max != null && it.min > it.max) throw invalid(`"${it.label}": min is greater than max`);
    } else if (it.min != null || it.max != null) throw invalid(`"${it.label}" cannot have min or max`);
  }
}

const toRows = (items: ItemInput[]) =>
  items.map((it, i) => ({
    order: i, type: it.type, label: it.label.trim(), required: it.required,
    options: it.type === "SELECT" ? it.options.map((o) => o.trim()).filter(Boolean) : [],
    min: it.type === "NUMBER" ? it.min : null, max: it.type === "NUMBER" ? it.max : null,
  }));

async function ownedTemplate(ctx: Ctx, id: string) {
  const t = await db.checklistTemplate.findFirst({ where: { id, orgId: ctx.orgId }, select: { id: true } });
  if (!t) throw notFound("Template not found");
  return t;
}

export async function listTemplates(ctx: Ctx, opts: { includeArchived?: boolean } = {}) {
  await requireOrgRole(ctx, "MANAGER");
  const rows = await db.checklistTemplate.findMany({
    where: { orgId: ctx.orgId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
    orderBy: { name: "asc" },
    include: { _count: { select: { items: true } } },
  });
  return rows.map((t) => ({ id: t.id, name: t.name, description: t.description, archivedAt: t.archivedAt, itemCount: t._count.items }));
}

export async function getTemplate(ctx: Ctx, id: string) {
  await requireOrgRole(ctx, "MANAGER");
  const t = await db.checklistTemplate.findFirst({
    where: { id, orgId: ctx.orgId },
    include: { items: { orderBy: { order: "asc" } } },
  });
  if (!t) throw notFound("Template not found");
  return {
    id: t.id, name: t.name, description: t.description, archivedAt: t.archivedAt,
    items: t.items.map((i) => ({ id: i.id, order: i.order, type: i.type, label: i.label, required: i.required, options: i.options, min: i.min, max: i.max })),
  };
}

export async function createTemplate(ctx: Ctx, input: TemplateInput) {
  await requireOrgRole(ctx, "MANAGER");
  validateItems(input.items);
  const t = await db.checklistTemplate.create({
    data: { orgId: ctx.orgId, name: input.name.trim(), description: input.description?.trim() || null, items: { create: toRows(input.items) } },
    select: { id: true },
  });
  return { id: t.id };
}

export async function updateTemplate(ctx: Ctx, id: string, input: TemplateInput) {
  await requireOrgRole(ctx, "MANAGER");
  await ownedTemplate(ctx, id);
  validateItems(input.items);
  await db.$transaction([
    db.templateItem.deleteMany({ where: { templateId: id } }),
    db.checklistTemplate.update({
      where: { id },
      data: { name: input.name.trim(), description: input.description?.trim() || null, items: { create: toRows(input.items) } },
    }),
  ]);
}

export async function archiveTemplate(ctx: Ctx, id: string) {
  await requireOrgRole(ctx, "MANAGER");
  await ownedTemplate(ctx, id);
  await db.checklistTemplate.update({ where: { id }, data: { archivedAt: new Date() } });
}

export async function unarchiveTemplate(ctx: Ctx, id: string) {
  await requireOrgRole(ctx, "MANAGER");
  await ownedTemplate(ctx, id);
  await db.checklistTemplate.update({ where: { id }, data: { archivedAt: null } });
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/services/template.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/services/template.ts tests/services/template.test.ts
git commit -m "feat: add checklist template service"
```

---

### Task 3: Instance service — assign, lists, get, counts

**Files:**
- Create: `lib/services/instance.ts`
- Test: `tests/services/instance.test.ts`

**Interfaces:**
- Consumes: guards, `db`, errors; `makeTemplate`, `makeInstance` helpers.
- Produces:
  - `type InstanceSummary = { id; templateName; propertyId; propertyName; assigneeId; assigneeName; dueAt: Date; status: InstanceStatus; overdue: boolean; submittedAt: Date | null }`
  - `type InstanceDetail = InstanceSummary & { reviewComment: string | null; reviewedAt: Date | null; reviewedByName: string | null; canFill: boolean; canReview: boolean; items: InstanceItemRow[] }` where `InstanceItemRow = { id; order; type; label; required; options; min; max; checked; text; number; choice; fileKey; fileType; answeredAt }`
  - `assign(ctx, { templateId, propertyId, assigneeIds: string[], dueAt: Date }): Promise<{ ids: string[] }>`
  - `listForProperty(ctx, propertyId, opts?: { status?: InstanceStatus | "OVERDUE" }): Promise<InstanceSummary[]>`
  - `listMine(ctx): Promise<InstanceSummary[]>` (all statuses; APPROVED only from the last 7 days)
  - `getInstance(ctx, id): Promise<InstanceDetail>`
  - `instanceCounts(ctx, propertyIds: string[]): Promise<Record<string, { open: number; overdue: number }>>`
  - `isOverdue(i: { dueAt: Date; status: InstanceStatus }, now?: Date): boolean`

- [ ] **Step 1: Write failing tests**

Create `tests/services/instance.test.ts` (Task 4 appends more `describe` blocks to this file):

```ts
import { describe, expect, test } from "vitest";
import { db } from "@/lib/db";
import { assign, getInstance, instanceCounts, isOverdue, listForProperty, listMine } from "@/lib/services/instance";
import { makeInstance, makeMember, makeOrg, makeProperty, makeTemplate, makeUser } from "@/tests/helpers/db";

export async function setup() {
  const org = await makeOrg();
  const owner = await makeUser({ name: "Owner" });
  const mgr = await makeUser({ name: "Mgr" });
  const w1 = await makeUser({ name: "W1" });
  const w2 = await makeUser({ name: "W2" });
  const outsider = await makeUser({ name: "Out" });
  await makeMember(org.id, owner.id, "OWNER");
  await makeMember(org.id, mgr.id, "MANAGER");
  await makeMember(org.id, w1.id, "WORKER");
  await makeMember(org.id, w2.id, "WORKER");
  await makeMember(org.id, outsider.id, "WORKER");
  const prop = await makeProperty(org.id, "Villa");
  await db.propertyMember.createMany({ data: [mgr.id, w1.id, w2.id].map((userId) => ({ propertyId: prop.id, userId })) });
  const tpl = await makeTemplate(org.id);
  const ctx = (userId: string) => ({ userId, orgId: org.id });
  const due = new Date(Date.now() + 3600_000);
  return { org, owner, mgr, w1, w2, outsider, prop, tpl, ctx, due };
}

describe("assign", () => {
  test("creates one instance per worker with frozen items", async () => {
    const { mgr, w1, w2, prop, tpl, ctx, due } = await setup();
    const { ids } = await assign(ctx(mgr.id), { templateId: tpl.id, propertyId: prop.id, assigneeIds: [w1.id, w2.id], dueAt: due });
    expect(ids).toHaveLength(2);
    const inst = await getInstance(ctx(w1.id), ids[0]);
    expect(inst.items.map((i) => [i.order, i.type, i.label, i.required])).toEqual(tpl.items.map((i) => [i.order, i.type, i.label, i.required]));
    expect(inst.templateName).toBe("Checkout clean");
    expect(inst.status).toBe("OPEN");
    // editing the template afterwards does not touch the instance
    await db.templateItem.deleteMany({ where: { templateId: tpl.id } });
    expect((await getInstance(ctx(w1.id), ids[0])).items).toHaveLength(5);
  });

  test("rejects non-member assignee, archived template, worker caller, manager without property access", async () => {
    const { org, mgr, w1, outsider, prop, tpl, ctx, due } = await setup();
    await expect(assign(ctx(mgr.id), { templateId: tpl.id, propertyId: prop.id, assigneeIds: [outsider.id], dueAt: due })).rejects.toMatchObject({ code: "INVALID" });
    await expect(assign(ctx(w1.id), { templateId: tpl.id, propertyId: prop.id, assigneeIds: [w1.id], dueAt: due })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await makeProperty(org.id, "Other");
    await expect(assign(ctx(mgr.id), { templateId: tpl.id, propertyId: other.id, assigneeIds: [w1.id], dueAt: due })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.checklistTemplate.update({ where: { id: tpl.id }, data: { archivedAt: new Date() } });
    await expect(assign(ctx(mgr.id), { templateId: tpl.id, propertyId: prop.id, assigneeIds: [w1.id], dueAt: due })).rejects.toMatchObject({ code: "INVALID" });
  });
});

describe("lists and access", () => {
  test("listMine shows only my instances; listForProperty needs property access; overdue filter", async () => {
    const { org, owner, mgr, w1, w2, prop, ctx } = await setup();
    const past = new Date(Date.now() - 3600_000);
    const a = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id, dueAt: past });
    await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w2.id, assignedById: mgr.id });
    expect((await listMine(ctx(w1.id))).map((i) => i.id)).toEqual([a.id]);
    expect((await listMine(ctx(w1.id)))[0].overdue).toBe(true);
    expect(await listForProperty(ctx(owner.id), prop.id)).toHaveLength(2);
    expect((await listForProperty(ctx(mgr.id), prop.id, { status: "OVERDUE" })).map((i) => i.id)).toEqual([a.id]);
    const stranger = await makeUser();
    await makeMember(org.id, stranger.id, "MANAGER");
    await expect(listForProperty(ctx(stranger.id), prop.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("getInstance: assignee and managers with access; others NOT_FOUND; canFill/canReview flags", async () => {
    const { org, mgr, w1, w2, prop, ctx } = await setup();
    const a = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id });
    expect((await getInstance(ctx(w1.id), a.id)).canFill).toBe(true);
    expect((await getInstance(ctx(mgr.id), a.id)).canFill).toBe(false);
    await expect(getInstance(ctx(w2.id), a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const otherOrg = await makeOrg();
    const foreign = await makeUser();
    await makeMember(otherOrg.id, foreign.id, "OWNER");
    await expect(getInstance({ userId: foreign.id, orgId: otherOrg.id }, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.checklistInstance.update({ where: { id: a.id }, data: { status: "SUBMITTED" } });
    expect((await getInstance(ctx(mgr.id), a.id)).canReview).toBe(true);
    expect((await getInstance(ctx(w1.id), a.id)).canFill).toBe(false);
  });

  test("listMine hides APPROVED older than 7 days; instanceCounts", async () => {
    const { org, mgr, w1, prop, ctx } = await setup();
    const old = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id, status: "APPROVED" });
    await db.checklistInstance.update({ where: { id: old.id }, data: { reviewedAt: new Date(Date.now() - 8 * 86400_000) } });
    const recent = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id, status: "APPROVED" });
    await db.checklistInstance.update({ where: { id: recent.id }, data: { reviewedAt: new Date() } });
    await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id, dueAt: new Date(Date.now() - 1000) });
    expect((await listMine(ctx(w1.id))).map((i) => i.id).sort()).toEqual([recent.id].concat((await db.checklistInstance.findMany({ where: { status: "OPEN" } })).map((i) => i.id)).sort());
    expect(await instanceCounts(ctx(mgr.id), [prop.id])).toEqual({ [prop.id]: { open: 1, overdue: 1 } });
  });
});

test("isOverdue", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  expect(isOverdue({ dueAt: new Date("2026-01-01T11:00:00Z"), status: "OPEN" }, now)).toBe(true);
  expect(isOverdue({ dueAt: new Date("2026-01-01T11:00:00Z"), status: "REJECTED" }, now)).toBe(true);
  expect(isOverdue({ dueAt: new Date("2026-01-01T11:00:00Z"), status: "SUBMITTED" }, now)).toBe(false);
  expect(isOverdue({ dueAt: new Date("2026-01-01T13:00:00Z"), status: "OPEN" }, now)).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test tests/services/instance.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Create `lib/services/instance.ts` (Task 4 appends answer/submit/review to this file):

```ts
import { InstanceStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { Ctx, requireOrgRole, requirePropertyAccess, roleAtLeast } from "@/lib/auth/guard";
import { invalid, notFound } from "@/lib/errors";

export const isOverdue = (i: { dueAt: Date; status: InstanceStatus }, now = new Date()) =>
  (i.status === "OPEN" || i.status === "REJECTED") && i.dueAt.getTime() < now.getTime();

const summarySelect = {
  id: true, templateName: true, propertyId: true, assigneeId: true, dueAt: true, status: true, submittedAt: true,
  property: { select: { name: true } }, assignee: { select: { name: true } },
} satisfies Prisma.ChecklistInstanceSelect;

type SummaryRow = Prisma.ChecklistInstanceGetPayload<{ select: typeof summarySelect }>;

const toSummary = (r: SummaryRow) => ({
  id: r.id, templateName: r.templateName, propertyId: r.propertyId, propertyName: r.property.name,
  assigneeId: r.assigneeId, assigneeName: r.assignee.name, dueAt: r.dueAt, status: r.status,
  overdue: isOverdue(r), submittedAt: r.submittedAt,
});
export type InstanceSummary = ReturnType<typeof toSummary>;

export async function assign(ctx: Ctx, input: { templateId: string; propertyId: string; assigneeIds: string[]; dueAt: Date }) {
  await requireOrgRole(ctx, "MANAGER");
  await requirePropertyAccess(ctx, input.propertyId);
  const assigneeIds = [...new Set(input.assigneeIds)];
  if (assigneeIds.length === 0) throw invalid("Pick at least one worker");
  const tpl = await db.checklistTemplate.findFirst({
    where: { id: input.templateId, orgId: ctx.orgId },
    include: { items: { orderBy: { order: "asc" } } },
  });
  if (!tpl) throw notFound("Template not found");
  if (tpl.archivedAt) throw invalid("Template is archived");
  if (tpl.items.length === 0) throw invalid("Template has no items");
  const members = await db.propertyMember.count({ where: { propertyId: input.propertyId, userId: { in: assigneeIds } } });
  if (members !== assigneeIds.length) throw invalid("Every assignee must be a member of this property");

  const frozen = tpl.items.map((i) => ({ order: i.order, type: i.type, label: i.label, required: i.required, options: i.options, min: i.min, max: i.max }));
  const ids = await db.$transaction(async (tx) => {
    const out: string[] = [];
    for (const assigneeId of assigneeIds) {
      const row = await tx.checklistInstance.create({
        data: {
          orgId: ctx.orgId, propertyId: input.propertyId, templateId: tpl.id, templateName: tpl.name,
          assigneeId, assignedById: ctx.userId, dueAt: input.dueAt, items: { create: frozen },
        },
        select: { id: true },
      });
      out.push(row.id);
    }
    return out;
  });
  return { ids };
}

export async function listForProperty(ctx: Ctx, propertyId: string, opts: { status?: InstanceStatus | "OVERDUE" } = {}) {
  await requirePropertyAccess(ctx, propertyId);
  const where: Prisma.ChecklistInstanceWhereInput = { orgId: ctx.orgId, propertyId };
  if (opts.status === "OVERDUE") Object.assign(where, { status: { in: ["OPEN", "REJECTED"] }, dueAt: { lt: new Date() } });
  else if (opts.status) where.status = opts.status;
  const rows = await db.checklistInstance.findMany({ where, select: summarySelect, orderBy: { dueAt: "asc" } });
  return rows.map(toSummary);
}

export async function listMine(ctx: Ctx) {
  await requireOrgRole(ctx, "WORKER");
  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const rows = await db.checklistInstance.findMany({
    where: {
      orgId: ctx.orgId, assigneeId: ctx.userId,
      OR: [{ status: { not: "APPROVED" } }, { status: "APPROVED", reviewedAt: { gte: weekAgo } }],
    },
    select: summarySelect,
    orderBy: { dueAt: "asc" },
  });
  return rows.map(toSummary);
}

export async function getInstance(ctx: Ctx, id: string) {
  const role = await requireOrgRole(ctx, "WORKER");
  const r = await db.checklistInstance.findFirst({
    where: { id, orgId: ctx.orgId },
    include: {
      property: { select: { name: true, members: { where: { userId: ctx.userId }, select: { userId: true } } } },
      assignee: { select: { name: true } },
      reviewedBy: { select: { name: true } },
      items: { orderBy: { order: "asc" } },
    },
  });
  if (!r) throw notFound("Checklist not found");
  const isAssignee = r.assigneeId === ctx.userId;
  const managerAccess = roleAtLeast(role, "MANAGER") && (role === "OWNER" || r.property.members.length > 0);
  if (!isAssignee && !managerAccess) throw notFound("Checklist not found");
  return {
    ...toSummary({ ...r, property: { name: r.property.name } }),
    reviewComment: r.reviewComment, reviewedAt: r.reviewedAt, reviewedByName: r.reviewedBy?.name ?? null,
    canFill: isAssignee && (r.status === "OPEN" || r.status === "REJECTED"),
    canReview: managerAccess && r.status === "SUBMITTED",
    items: r.items.map((i) => ({
      id: i.id, order: i.order, type: i.type, label: i.label, required: i.required, options: i.options, min: i.min, max: i.max,
      checked: i.checked, text: i.text, number: i.number, choice: i.choice, fileKey: i.fileKey, fileType: i.fileType, answeredAt: i.answeredAt,
    })),
  };
}
export type InstanceDetail = Awaited<ReturnType<typeof getInstance>>;
export type InstanceItemRow = InstanceDetail["items"][number];

export async function instanceCounts(ctx: Ctx, propertyIds: string[]) {
  await requireOrgRole(ctx, "WORKER");
  const rows = await db.checklistInstance.findMany({
    where: { orgId: ctx.orgId, propertyId: { in: propertyIds }, status: { in: ["OPEN", "REJECTED"] } },
    select: { propertyId: true, dueAt: true, status: true },
  });
  const out: Record<string, { open: number; overdue: number }> = {};
  for (const id of propertyIds) out[id] = { open: 0, overdue: 0 };
  for (const r of rows) {
    out[r.propertyId].open += 1;
    if (isOverdue(r)) out[r.propertyId].overdue += 1;
  }
  return out;
}
```

Note: `instanceCounts` is called from the dashboard with ids the caller already listed via `listProperties`, so it only needs org scoping (present in the query).

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/services/instance.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add lib/services/instance.ts tests/services/instance.test.ts
git commit -m "feat: add checklist instance assignment, lists, and access"
```

---

### Task 4: Instance service — answer, submit, review; member removal

**Files:**
- Create: `lib/media.ts`
- Modify: `lib/services/instance.ts` (append), `lib/services/member.ts` (removeMember), `tests/services/instance.test.ts` (append), `tests/services/member.test.ts` (append)
- Test: `tests/unit/media.test.ts`

**Interfaces:**
- Produces in `lib/media.ts` (shared by server and client, no Node imports):
  - `PHOTO_TYPES = ["image/jpeg","image/png","image/webp"]`, `VIDEO_TYPES = ["video/mp4","video/quicktime","video/webm"]`, `PHOTO_MAX_BYTES = 5*1024*1024`, `VIDEO_MAX_BYTES = 100*1024*1024`
  - `extForMime(mime): string | null` (`jpg|png|webp|mp4|mov|webm`)
  - `mediaKey(orgId, instanceId, itemId, ext): string` → `org/<orgId>/instances/<instanceId>/<itemId>.<ext>`
  - `mediaKeyPrefix(orgId, instanceId, itemId): string` → same without `.<ext>`
  - `mediaRule(type: "PHOTO" | "VIDEO"): { types: string[]; maxBytes: number; presignSec: number }` (300 / 600)
- Produces in `lib/services/instance.ts`:
  - `type AnswerValue = { type: "CHECKBOX"; checked: boolean } | { type: "TEXT"; text: string } | { type: "NUMBER"; number: number } | { type: "SELECT"; choice: string } | { type: "PHOTO" | "VIDEO"; fileKey: string; fileType: string }`
  - `answerItem(ctx, instanceId, itemId, value: AnswerValue): Promise<void>`
  - `submit(ctx, instanceId): Promise<void>`
  - `review(ctx, instanceId, decision: "APPROVED" | "REJECTED", comment?: string): Promise<void>`
  - `isAnswered(item: InstanceItemRow): boolean`

- [ ] **Step 1: Media helper test**

Create `tests/unit/media.test.ts`:

```ts
import { expect, test } from "vitest";
import { extForMime, mediaKey, mediaKeyPrefix, mediaRule } from "@/lib/media";

test("ext and keys", () => {
  expect(extForMime("image/jpeg")).toBe("jpg");
  expect(extForMime("video/quicktime")).toBe("mov");
  expect(extForMime("text/plain")).toBeNull();
  expect(mediaKey("o1", "i1", "t1", "jpg")).toBe("org/o1/instances/i1/t1.jpg");
  expect(mediaKey("o1", "i1", "t1", "jpg").startsWith(mediaKeyPrefix("o1", "i1", "t1"))).toBe(true);
});

test("rules", () => {
  expect(mediaRule("PHOTO")).toEqual({ types: ["image/jpeg", "image/png", "image/webp"], maxBytes: 5 * 1024 * 1024, presignSec: 300 });
  expect(mediaRule("VIDEO").maxBytes).toBe(100 * 1024 * 1024);
});
```

Create `lib/media.ts`:

```ts
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 100 * 1024 * 1024;

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
};
export const extForMime = (mime: string) => EXT[mime] ?? null;

export const mediaKeyPrefix = (orgId: string, instanceId: string, itemId: string) => `org/${orgId}/instances/${instanceId}/${itemId}.`;
export const mediaKey = (orgId: string, instanceId: string, itemId: string, ext: string) => `${mediaKeyPrefix(orgId, instanceId, itemId)}${ext}`;

export function mediaRule(type: "PHOTO" | "VIDEO") {
  return type === "PHOTO"
    ? { types: [...PHOTO_TYPES], maxBytes: PHOTO_MAX_BYTES, presignSec: 300 }
    : { types: [...VIDEO_TYPES], maxBytes: VIDEO_MAX_BYTES, presignSec: 600 };
}
```

Run: `pnpm test tests/unit/media.test.ts` → 2 passed.

- [ ] **Step 2: Write failing service tests**

Append to `tests/services/instance.test.ts` (add `answerItem, submit, review` to the import from `@/lib/services/instance`, and `removeMember` from `@/lib/services/member`):

```ts
describe("answer, submit, review", () => {
  test("answer validation per type; only assignee; only OPEN/REJECTED", async () => {
    const { org, mgr, w1, w2, prop, ctx } = await setup();
    const inst = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id });
    const [cb, txt, num, sel, photo] = inst.items;
    await answerItem(ctx(w1.id), inst.id, cb.id, { type: "CHECKBOX", checked: true });
    await answerItem(ctx(w1.id), inst.id, num.id, { type: "NUMBER", number: 3 });
    await expect(answerItem(ctx(w1.id), inst.id, num.id, { type: "NUMBER", number: 21 })).rejects.toMatchObject({ code: "INVALID" });
    await expect(answerItem(ctx(w1.id), inst.id, sel.id, { type: "SELECT", choice: "Great" })).rejects.toMatchObject({ code: "INVALID" });
    await answerItem(ctx(w1.id), inst.id, sel.id, { type: "SELECT", choice: "Good" });
    await expect(answerItem(ctx(w1.id), inst.id, txt.id, { type: "NUMBER", number: 1 })).rejects.toMatchObject({ code: "INVALID" }); // type mismatch
    await expect(answerItem(ctx(w1.id), inst.id, photo.id, { type: "PHOTO", fileKey: "org/x/evil.jpg", fileType: "image/jpeg" })).rejects.toMatchObject({ code: "INVALID" });
    await answerItem(ctx(w1.id), inst.id, photo.id, { type: "PHOTO", fileKey: `org/${org.id}/instances/${inst.id}/${photo.id}.jpg`, fileType: "image/jpeg" });
    await expect(answerItem(ctx(w2.id), inst.id, cb.id, { type: "CHECKBOX", checked: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(answerItem(ctx(mgr.id), inst.id, cb.id, { type: "CHECKBOX", checked: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const d = await getInstance(ctx(w1.id), inst.id);
    expect(d.items.map((i) => i.answeredAt !== null)).toEqual([true, false, true, true, true]);
    await db.checklistInstance.update({ where: { id: inst.id }, data: { status: "SUBMITTED" } });
    await expect(answerItem(ctx(w1.id), inst.id, cb.id, { type: "CHECKBOX", checked: false })).rejects.toMatchObject({ code: "INVALID" });
  });

  test("submit requires required items; lists missing labels", async () => {
    const { org, mgr, w1, prop, ctx } = await setup();
    const inst = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id });
    await expect(submit(ctx(w1.id), inst.id)).rejects.toThrow("Missing: Beds made, Towels left, Condition, Bathroom photo");
    const [cb, , num, sel, photo] = inst.items;
    await answerItem(ctx(w1.id), inst.id, cb.id, { type: "CHECKBOX", checked: true });
    await answerItem(ctx(w1.id), inst.id, num.id, { type: "NUMBER", number: 3 });
    await answerItem(ctx(w1.id), inst.id, sel.id, { type: "SELECT", choice: "Good" });
    await answerItem(ctx(w1.id), inst.id, photo.id, { type: "PHOTO", fileKey: `org/${org.id}/instances/${inst.id}/${photo.id}.jpg`, fileType: "image/jpeg" });
    await submit(ctx(w1.id), inst.id);
    const d = await getInstance(ctx(w1.id), inst.id);
    expect(d.status).toBe("SUBMITTED");
    expect(d.submittedAt).not.toBeNull();
    await expect(submit(ctx(w1.id), inst.id)).rejects.toThrow("SUBMITTED");
  });

  test("review: reject reopens with comment; resubmit; approve is terminal; permissions", async () => {
    const { org, mgr, w1, w2, prop, ctx } = await setup();
    const inst = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id, status: "SUBMITTED", items: [{ type: "CHECKBOX", label: "A" }] });
    await db.instanceItem.update({ where: { id: inst.items[0].id }, data: { checked: true, answeredAt: new Date() } });
    await expect(review(ctx(w1.id), inst.id, "APPROVED")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(review(ctx(mgr.id), inst.id, "REJECTED", "  ")).rejects.toMatchObject({ code: "INVALID" });
    await review(ctx(mgr.id), inst.id, "REJECTED", "Redo the beds");
    let d = await getInstance(ctx(w1.id), inst.id);
    expect([d.status, d.reviewComment, d.reviewedByName, d.canFill]).toEqual(["REJECTED", "Redo the beds", "Mgr", true]);
    await answerItem(ctx(w1.id), inst.id, inst.items[0].id, { type: "CHECKBOX", checked: true });
    await submit(ctx(w1.id), inst.id);
    await review(ctx(mgr.id), inst.id, "APPROVED");
    d = await getInstance(ctx(mgr.id), inst.id);
    expect([d.status, d.canReview]).toEqual(["APPROVED", false]);
    await expect(review(ctx(mgr.id), inst.id, "REJECTED", "x")).rejects.toThrow("APPROVED");
    const stranger = await makeUser();
    await makeMember(org.id, stranger.id, "MANAGER");
    const inst2 = await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w2.id, assignedById: mgr.id, status: "SUBMITTED" });
    await expect(review(ctx(stranger.id), inst2.id, "APPROVED")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("removeMember", () => {
  test("deletes OPEN and REJECTED instances, keeps SUBMITTED and APPROVED", async () => {
    const { org, owner, mgr, w1, prop, ctx } = await setup();
    for (const status of ["OPEN", "REJECTED", "SUBMITTED", "APPROVED"] as const) {
      await makeInstance({ orgId: org.id, propertyId: prop.id, assigneeId: w1.id, assignedById: mgr.id, status });
    }
    await removeMember(ctx(owner.id), w1.id);
    const left = await db.checklistInstance.findMany({ where: { assigneeId: w1.id }, select: { status: true } });
    expect(left.map((i) => i.status).sort()).toEqual(["APPROVED", "SUBMITTED"]);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm test tests/services/instance.test.ts`
Expected: FAIL, `answerItem` not exported.

- [ ] **Step 4: Implement**

Append to `lib/services/instance.ts` (add `forbidden` to the errors import and `import { mediaKeyPrefix, mediaRule } from "@/lib/media";`):

```ts
export type AnswerValue =
  | { type: "CHECKBOX"; checked: boolean }
  | { type: "TEXT"; text: string }
  | { type: "NUMBER"; number: number }
  | { type: "SELECT"; choice: string }
  | { type: "PHOTO" | "VIDEO"; fileKey: string; fileType: string };

export function isAnswered(i: { type: ItemType; checked: boolean | null; text: string | null; number: number | null; choice: string | null; fileKey: string | null }) {
  switch (i.type) {
    case "CHECKBOX": return i.checked === true;
    case "TEXT": return !!i.text?.trim();
    case "NUMBER": return i.number !== null;
    case "SELECT": return i.choice !== null;
    case "PHOTO":
    case "VIDEO": return i.fileKey !== null;
  }
}

/** Loads an instance the caller may act on as its assignee. NOT_FOUND hides existence from everyone else. */
async function ownInstance(ctx: Ctx, instanceId: string) {
  const role = await requireOrgRole(ctx, "WORKER");
  const inst = await db.checklistInstance.findFirst({ where: { id: instanceId, orgId: ctx.orgId }, select: { id: true, assigneeId: true, status: true } });
  if (!inst) throw notFound("Checklist not found");
  if (inst.assigneeId !== ctx.userId) {
    // A manager who can see it gets FORBIDDEN (they cannot answer for workers); anyone else NOT_FOUND.
    if (roleAtLeast(role, "MANAGER")) throw forbidden("Only the assignee can fill in this checklist");
    throw notFound("Checklist not found");
  }
  return inst;
}

const assertFillable = (status: InstanceStatus) => {
  if (status !== "OPEN" && status !== "REJECTED") throw invalid(`Checklist is ${status} and cannot be edited`);
};

export async function answerItem(ctx: Ctx, instanceId: string, itemId: string, value: AnswerValue) {
  const inst = await ownInstance(ctx, instanceId);
  assertFillable(inst.status);
  const item = await db.instanceItem.findFirst({ where: { id: itemId, instanceId } });
  if (!item) throw notFound("Item not found");
  if (item.type !== value.type) throw invalid(`"${item.label}" expects a ${item.type.toLowerCase()} answer`);

  const data: Prisma.InstanceItemUpdateInput = { answeredAt: new Date() };
  switch (value.type) {
    case "CHECKBOX": data.checked = value.checked; break;
    case "TEXT": data.text = value.text.slice(0, 2000); break;
    case "NUMBER":
      if (!Number.isFinite(value.number)) throw invalid(`"${item.label}" must be a number`);
      if (item.min != null && value.number < item.min) throw invalid(`"${item.label}" must be at least ${item.min}`);
      if (item.max != null && value.number > item.max) throw invalid(`"${item.label}" must be at most ${item.max}`);
      data.number = value.number; break;
    case "SELECT":
      if (!item.options.includes(value.choice)) throw invalid(`"${value.choice}" is not an option for "${item.label}"`);
      data.choice = value.choice; break;
    case "PHOTO":
    case "VIDEO": {
      if (!value.fileKey.startsWith(mediaKeyPrefix(ctx.orgId, instanceId, itemId))) throw invalid("Invalid file key");
      if (!mediaRule(value.type).types.includes(value.fileType)) throw invalid("Unsupported file type");
      data.fileKey = value.fileKey; data.fileType = value.fileType; break;
    }
  }
  await db.instanceItem.update({ where: { id: itemId }, data });
}

export async function submit(ctx: Ctx, instanceId: string) {
  const inst = await ownInstance(ctx, instanceId);
  assertFillable(inst.status);
  const items = await db.instanceItem.findMany({ where: { instanceId }, orderBy: { order: "asc" } });
  const missing = items.filter((i) => i.required && !isAnswered(i)).map((i) => i.label);
  if (missing.length) throw invalid(`Missing: ${missing.join(", ")}`);
  await db.checklistInstance.update({ where: { id: instanceId }, data: { status: "SUBMITTED", submittedAt: new Date() } });
}

export async function review(ctx: Ctx, instanceId: string, decision: "APPROVED" | "REJECTED", comment?: string) {
  const role = await requireOrgRole(ctx, "MANAGER");
  const inst = await db.checklistInstance.findFirst({
    where: { id: instanceId, orgId: ctx.orgId },
    select: { id: true, status: true, propertyId: true, property: { select: { members: { where: { userId: ctx.userId }, select: { userId: true } } } } },
  });
  if (!inst || (role !== "OWNER" && inst.property.members.length === 0)) throw notFound("Checklist not found");
  if (inst.status !== "SUBMITTED") throw invalid(`Checklist is ${inst.status}; only submitted checklists can be reviewed`);
  const text = comment?.trim() || null;
  if (decision === "REJECTED" && !text) throw invalid("A comment is required when rejecting");
  await db.checklistInstance.update({
    where: { id: instanceId },
    data: { status: decision, reviewedAt: new Date(), reviewedById: ctx.userId, reviewComment: text },
  });
}
```

Add `ItemType` to the `@prisma/client` import at the top of the file.

In `lib/services/member.ts` `removeMember`, inside the transaction before `propertyMember.deleteMany`, add:

```ts
      await tx.checklistInstance.deleteMany({ where: { orgId: ctx.orgId, assigneeId: userId, status: { in: ["OPEN", "REJECTED"] } } });
```

- [ ] **Step 5: Run tests**

Run: `pnpm test tests/services/instance.test.ts tests/services/member.test.ts`
Expected: all pass. Then full `pnpm test`.

- [ ] **Step 6: Commit**

```bash
git add lib/media.ts lib/services/instance.ts lib/services/member.ts tests
git commit -m "feat: add checklist answering, submission, review, and member cleanup"
```

---

### Task 5: Storage (S3/MinIO) library, init script, env, compose, CI

**Files:**
- Create: `lib/storage.ts`, `scripts/storage-init.ts`
- Modify: `.env.example`, `docker-compose.yml`, `.github/workflows/ci.yml`, `package.json` (script + deps), `README.md`
- Test: `tests/services/storage.test.ts`

**Interfaces:**
- Produces: `presignUpload({ key, contentType, contentLength, expiresSec }): Promise<string>`, `presignDownload(key, expiresSec = 900): Promise<string>`, `deleteObject(key): Promise<void>`, `storageConfigured(): boolean` from `@/lib/storage`.

- [ ] **Step 1: Deps and env**

```bash
pnpm add @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

Append to `.env.example`:

```
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET=checkly
S3_ACCESS_KEY=minio
S3_SECRET_KEY=minio12345
S3_FORCE_PATH_STYLE=true
```

Copy the same six lines into your local `.env`.

In `docker-compose.yml`:
- `minio` service: add `MINIO_API_CORS_ALLOW_ORIGIN: "*"` to `environment` (MinIO has no per-bucket CORS API; this env is the dev switch).
- `app` service: add `S3_ENDPOINT: http://minio:9000` (server-side calls inside the compose network), `S3_PUBLIC_ENDPOINT: ${S3_PUBLIC_ENDPOINT:-http://localhost:9000}` (host used in presigned URLs handed to browsers, which must reach the published port), and `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE` via `${VAR:-default}` with the `.env.example` defaults.

Add `S3_PUBLIC_ENDPOINT=` (empty) to `.env.example` with the comment `# host browsers use for presigned URLs when it differs from S3_ENDPOINT (compose, LAN)`.

`lib/storage.ts` builds two clients when `S3_PUBLIC_ENDPOINT` is set (one for presigning with the public endpoint, one for direct calls); when unset both use `S3_ENDPOINT`.

Add script to `package.json`: `"storage:init": "tsx scripts/storage-init.ts"`.

- [ ] **Step 2: Failing storage test**

Create `tests/services/storage.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { presignDownload, presignUpload, storageConfigured } from "@/lib/storage";

describe.skipIf(!storageConfigured())("storage", () => {
  test("presigned PUT then GET round-trips a small buffer", async () => {
    const key = `test/${Date.now()}.txt`;
    const body = Buffer.from("hello checkly");
    const put = await presignUpload({ key, contentType: "text/plain", contentLength: body.length, expiresSec: 60 });
    const res = await fetch(put, { method: "PUT", body, headers: { "Content-Type": "text/plain", "Content-Length": String(body.length) } });
    expect(res.status).toBe(200);
    const get = await presignDownload(key, 60);
    expect(await (await fetch(get)).text()).toBe("hello checkly");
  });

  test("PUT with a different content length is rejected", async () => {
    const key = `test/${Date.now()}-len.txt`;
    const put = await presignUpload({ key, contentType: "text/plain", contentLength: 5, expiresSec: 60 });
    const res = await fetch(put, { method: "PUT", body: Buffer.from("way more than five bytes"), headers: { "Content-Type": "text/plain" } });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
```

Run: `pnpm test tests/services/storage.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement storage**

Create `lib/storage.ts`:

```ts
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const env = () => ({
  endpoint: process.env.S3_ENDPOINT,
  publicEndpoint: process.env.S3_PUBLIC_ENDPOINT || process.env.S3_ENDPOINT,
  region: process.env.S3_REGION || "us-east-1",
  bucket: process.env.S3_BUCKET || "checkly",
  accessKeyId: process.env.S3_ACCESS_KEY || "",
  secretAccessKey: process.env.S3_SECRET_KEY || "",
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
});

export const storageConfigured = () => !!process.env.S3_ENDPOINT;

function client(endpoint: string | undefined) {
  const e = env();
  return new S3Client({
    endpoint, region: e.region, forcePathStyle: e.forcePathStyle,
    credentials: { accessKeyId: e.accessKeyId, secretAccessKey: e.secretAccessKey },
  });
}

let internal: S3Client | undefined;
let publicClient: S3Client | undefined;
const internalClient = () => (internal ??= client(env().endpoint));
const presignClient = () => (publicClient ??= client(env().publicEndpoint));

/** Presigned PUT. The signature binds content type and exact length, so an oversized upload is refused by storage. */
export async function presignUpload(p: { key: string; contentType: string; contentLength: number; expiresSec: number }) {
  const cmd = new PutObjectCommand({ Bucket: env().bucket, Key: p.key, ContentType: p.contentType, ContentLength: p.contentLength });
  return getSignedUrl(presignClient(), cmd, { expiresIn: p.expiresSec, signableHeaders: new Set(["content-type", "content-length"]) });
}

export async function presignDownload(key: string, expiresSec = 900) {
  return getSignedUrl(presignClient(), new GetObjectCommand({ Bucket: env().bucket, Key: key }), { expiresIn: expiresSec });
}

export async function deleteObject(key: string) {
  await internalClient().send(new DeleteObjectCommand({ Bucket: env().bucket, Key: key }));
}

export async function ensureBucket() {
  const c = internalClient();
  const Bucket = env().bucket;
  try {
    await c.send(new HeadBucketCommand({ Bucket }));
  } catch {
    await c.send(new CreateBucketCommand({ Bucket }));
  }
}
```

Create `scripts/storage-init.ts`:

```ts
import "dotenv/config";
import { ensureBucket, storageConfigured } from "../lib/storage";

if (!storageConfigured()) {
  console.log("S3_ENDPOINT not set; skipping bucket init");
} else {
  ensureBucket().then(() => console.log(`Bucket "${process.env.S3_BUCKET || "checkly"}" ready`));
}
```

Run: `pnpm storage:init` → "Bucket "checkly" ready". Then `pnpm test tests/services/storage.test.ts` → 2 passed. If the second test returns 200, MinIO ignored the signed `content-length`; then drop that test and note it in the report (the server-side size check in Task 6 still applies).

- [ ] **Step 4: CI**

In `.github/workflows/ci.yml` add a service:

```yaml
      minio:
        image: minio/minio:latest
        env:
          MINIO_ROOT_USER: minio
          MINIO_ROOT_PASSWORD: minio12345
          MINIO_API_CORS_ALLOW_ORIGIN: "*"
        ports:
          - 9000:9000
        options: >-
          --health-cmd "curl -f http://localhost:9000/minio/health/live"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
```

GitHub service containers cannot take a `command`; MinIO's image needs `server /data`. If the service fails to start, replace it with a step before tests: `docker run -d -p 9000:9000 -e MINIO_ROOT_USER=minio -e MINIO_ROOT_PASSWORD=minio12345 -e MINIO_API_CORS_ALLOW_ORIGIN='*' minio/minio server /data` and a short wait loop on the health URL. Then in the `.env` construction step append the six `S3_*` lines (`S3_ENDPOINT=http://localhost:9000`), and add `- run: pnpm storage:init` after `pnpm db:push:test`.

- [ ] **Step 5: README**

Add to Development: `pnpm storage:init` after `docker compose up -d`. Add a "Media storage" paragraph: S3-compatible, MinIO in dev, the `S3_*` vars, `S3_PUBLIC_ENDPOINT` for the compose `app` service, uploads go browser → storage via presigned URLs so the public endpoint must be reachable from the phone; on a LAN set `S3_PUBLIC_ENDPOINT=http://<your-lan-ip>:9000` and `APP_URL` accordingly.

- [ ] **Step 6: Verify and commit**

Run: `pnpm lint && pnpm test && pnpm build`
Expected: green.

```bash
git add -A
git commit -m "feat: add S3-compatible storage client, bucket init, and MinIO wiring"
```

---

### Task 6: Server actions and schemas

**Files:**
- Create: `actions/template.schemas.ts`, `actions/template.ts`, `actions/instance.schemas.ts`, `actions/instance.ts`
- Test: `tests/unit/checklist-schemas.test.ts`

**Interfaces:**
- Consumes: services from Tasks 2–5, `run`, `requireUser`, `presignUpload`, `mediaRule`, `extForMime`, `mediaKey`.
- Produces (all `ActionResult` unless they redirect):
  - `templateSchema` (`{ name, description?, items: itemSchema[] }`), `itemSchema`, `assignSchema` (`{ templateId, propertyId, assigneeIds: string[], dueAt: string ISO }`), `answerSchema` (discriminated union on `type`), `reviewSchema` (`{ decision, comment? }`), `uploadRequestSchema` (`{ instanceId, itemId, contentType, sizeBytes }`).
  - `createTemplateAction(input)` → redirects to `/templates/<id>`; `updateTemplateAction(id, input)`; `archiveTemplateAction(id)`; `unarchiveTemplateAction(id)`.
  - `assignChecklistAction(input)`; `answerItemAction(instanceId, itemId, value)`; `submitChecklistAction(instanceId)`; `reviewChecklistAction(instanceId, input)`; `requestUploadAction(input)` → `{ url, key }`.

- [ ] **Step 1: Schema tests**

Create `tests/unit/checklist-schemas.test.ts`:

```ts
import { expect, test } from "vitest";
import { templateSchema } from "@/actions/template.schemas";
import { answerSchema, assignSchema, uploadRequestSchema } from "@/actions/instance.schemas";

test("template schema coerces item fields", () => {
  const r = templateSchema.safeParse({ name: " A ", items: [{ type: "NUMBER", label: "N", required: true, options: [], min: "1", max: null }] });
  expect(r.success).toBe(true);
  if (r.success) expect(r.data.items[0].min).toBe(1);
  expect(templateSchema.safeParse({ name: "", items: [] }).success).toBe(false);
});

test("assign schema parses ISO dueAt into a Date", () => {
  const r = assignSchema.safeParse({ templateId: "t", propertyId: "p", assigneeIds: ["u"], dueAt: "2026-09-20T10:00:00.000Z" });
  expect(r.success && r.data.dueAt instanceof Date).toBe(true);
  expect(assignSchema.safeParse({ templateId: "t", propertyId: "p", assigneeIds: [], dueAt: "x" }).success).toBe(false);
});

test("answer schema is a discriminated union", () => {
  expect(answerSchema.safeParse({ type: "CHECKBOX", checked: true }).success).toBe(true);
  expect(answerSchema.safeParse({ type: "NUMBER", number: "3" }).success).toBe(false);
  expect(answerSchema.safeParse({ type: "PHOTO", fileKey: "k", fileType: "image/jpeg" }).success).toBe(true);
  expect(answerSchema.safeParse({ type: "SELECT" }).success).toBe(false);
});

test("upload request bounds", () => {
  expect(uploadRequestSchema.safeParse({ instanceId: "i", itemId: "t", contentType: "image/jpeg", sizeBytes: 100 }).success).toBe(true);
  expect(uploadRequestSchema.safeParse({ instanceId: "i", itemId: "t", contentType: "image/jpeg", sizeBytes: 0 }).success).toBe(false);
});
```

- [ ] **Step 2: Schemas**

Create `actions/template.schemas.ts`:

```ts
import { z } from "zod";

export const itemSchema = z.object({
  type: z.enum(["CHECKBOX", "TEXT", "NUMBER", "PHOTO", "VIDEO", "SELECT"]),
  label: z.string().trim().min(1).max(200),
  required: z.boolean(),
  options: z.array(z.string().trim().max(100)).default([]),
  min: z.coerce.number().nullable().default(null),
  max: z.coerce.number().nullable().default(null),
});

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional().or(z.literal("")),
  items: z.array(itemSchema).min(1).max(100),
});
export type TemplateFormInput = z.input<typeof templateSchema>;
```

Create `actions/instance.schemas.ts`:

```ts
import { z } from "zod";

export const assignSchema = z.object({
  templateId: z.string().min(1),
  propertyId: z.string().min(1),
  assigneeIds: z.array(z.string().min(1)).min(1),
  dueAt: z.string().datetime().transform((s) => new Date(s)),
});

export const answerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CHECKBOX"), checked: z.boolean() }),
  z.object({ type: z.literal("TEXT"), text: z.string().max(2000) }),
  z.object({ type: z.literal("NUMBER"), number: z.number() }),
  z.object({ type: z.literal("SELECT"), choice: z.string().min(1) }),
  z.object({ type: z.literal("PHOTO"), fileKey: z.string().min(1), fileType: z.string().min(1) }),
  z.object({ type: z.literal("VIDEO"), fileKey: z.string().min(1), fileType: z.string().min(1) }),
]);

export const reviewSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  comment: z.string().trim().max(2000).optional(),
});

export const uploadRequestSchema = z.object({
  instanceId: z.string().min(1),
  itemId: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().positive(),
});
```

Note: `z.coerce.number().nullable()` turns `null` into `0` in zod 4? Verify at the REPL: `z.coerce.number().nullable().parse(null)`. If it yields `0`, use `z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().nullable())` for `min`/`max` instead, and keep the test expectation (`"1"` → `1`, `null` → `null`).

- [ ] **Step 3: Actions**

Create `actions/template.ts`:

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { run } from "@/lib/actions";
import { requireUser } from "@/lib/auth/guard";
import * as svc from "@/lib/services/template";
import { templateSchema } from "@/actions/template.schemas";

const toInput = (d: z.infer<typeof templateSchema>) => ({ name: d.name, description: d.description || null, items: d.items });

export async function createTemplateAction(input: z.input<typeof templateSchema>) {
  const result = await run(async () => {
    const ctx = await requireUser();
    return svc.createTemplate(ctx, toInput(templateSchema.parse(input)));
  });
  if (result.ok) redirect(`/templates/${result.data.id}`);
  return result;
}

export async function updateTemplateAction(id: string, input: z.input<typeof templateSchema>) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.updateTemplate(ctx, id, toInput(templateSchema.parse(input)));
    revalidatePath(`/templates/${id}`);
    revalidatePath("/templates");
  });
}

export async function archiveTemplateAction(id: string) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.archiveTemplate(ctx, id);
    revalidatePath("/templates");
    revalidatePath(`/templates/${id}`);
  });
}

export async function unarchiveTemplateAction(id: string) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.unarchiveTemplate(ctx, id);
    revalidatePath("/templates");
    revalidatePath(`/templates/${id}`);
  });
}
```

Create `actions/instance.ts`:

```ts
"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { run } from "@/lib/actions";
import { requireUser } from "@/lib/auth/guard";
import { invalid } from "@/lib/errors";
import { extForMime, mediaKey, mediaRule } from "@/lib/media";
import { presignUpload } from "@/lib/storage";
import * as svc from "@/lib/services/instance";
import { answerSchema, assignSchema, reviewSchema, uploadRequestSchema } from "@/actions/instance.schemas";

export async function assignChecklistAction(input: z.input<typeof assignSchema>) {
  return run(async () => {
    const ctx = await requireUser();
    const data = assignSchema.parse(input);
    const out = await svc.assign(ctx, data);
    revalidatePath(`/properties/${data.propertyId}`);
    return out;
  });
}

export async function answerItemAction(instanceId: string, itemId: string, value: z.input<typeof answerSchema>) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.answerItem(ctx, instanceId, itemId, answerSchema.parse(value));
  });
}

export async function submitChecklistAction(instanceId: string) {
  return run(async () => {
    const ctx = await requireUser();
    await svc.submit(ctx, instanceId);
    revalidatePath(`/checklists/${instanceId}`);
    revalidatePath("/today");
  });
}

export async function reviewChecklistAction(instanceId: string, input: z.input<typeof reviewSchema>) {
  return run(async () => {
    const ctx = await requireUser();
    const data = reviewSchema.parse(input);
    await svc.review(ctx, instanceId, data.decision, data.comment);
    revalidatePath(`/checklists/${instanceId}`);
  });
}

/** Issues a presigned PUT for a PHOTO or VIDEO item. The key is deterministic per item, so re-uploads overwrite. */
export async function requestUploadAction(input: z.input<typeof uploadRequestSchema>) {
  return run(async () => {
    const ctx = await requireUser();
    const data = uploadRequestSchema.parse(input);
    const inst = await svc.getInstance(ctx, data.instanceId);
    if (!inst.canFill) throw invalid("This checklist cannot be edited");
    const item = inst.items.find((i) => i.id === data.itemId);
    if (!item || (item.type !== "PHOTO" && item.type !== "VIDEO")) throw invalid("Item does not accept files");
    const rule = mediaRule(item.type);
    if (!rule.types.includes(data.contentType)) throw invalid(`Unsupported file type ${data.contentType}`);
    if (data.sizeBytes > rule.maxBytes) throw invalid(`File is too large (max ${Math.round(rule.maxBytes / 1024 / 1024)} MB)`);
    const key = mediaKey(ctx.orgId, data.instanceId, data.itemId, extForMime(data.contentType)!);
    const url = await presignUpload({ key, contentType: data.contentType, contentLength: data.sizeBytes, expiresSec: rule.presignSec });
    return { url, key };
  });
}
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm test tests/unit && pnpm build && pnpm lint`
Expected: green (build enforces the "use server" export rule).

```bash
git add actions tests/unit/checklist-schemas.test.ts
git commit -m "feat: add checklist template and instance server actions"
```

---

### Task 7: Template list and builder UI

**Files:**
- Create: `app/(app)/templates/page.tsx`, `app/(app)/templates/new/page.tsx`, `app/(app)/templates/[id]/page.tsx`, `app/(app)/templates/template-builder.tsx`, `app/(app)/templates/[id]/archive-button.tsx`, `components/forbidden.tsx`
- Modify: `components/app-nav.tsx` (Templates link for MANAGER+)

**Interfaces:**
- Consumes: `listTemplates`, `getTemplate`, `TemplateDetail`; template actions; `templateSchema` input type.
- Produces: `<Forbidden />` (the "You don't have access to this page." block reused by later pages); `<TemplateBuilder template? />`.

- [ ] **Step 1: Shared forbidden block**

Create `components/forbidden.tsx`:

```tsx
export function Forbidden() {
  return (
    <div className="p-6 text-sm">
      <p className="font-medium">You don&apos;t have access to this page.</p>
    </div>
  );
}
```

- [ ] **Step 2: Nav**

In `components/app-nav.tsx`, change `items` to:

```ts
const items = (role: Role) => [
  ...(role === "WORKER" ? [{ href: "/today", label: "Today" }] : []),
  { href: "/", label: "Properties" },
  ...(role !== "WORKER" ? [{ href: "/templates", label: "Templates" }, { href: "/team", label: "Team" }] : []),
  { href: "/settings", label: "Settings" },
];
```

and the active check to `const active = i.href === "/" ? path === "/" || path.startsWith("/properties") : path.startsWith(i.href);` (unchanged) — `/today` and `/templates` work with `startsWith`.

- [ ] **Step 3: Builder (client)**

Create `app/(app)/templates/template-builder.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { createTemplateAction, updateTemplateAction } from "@/actions/template";
import type { TemplateFormInput } from "@/actions/template.schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";

type Item = TemplateFormInput["items"][number];
const TYPES: { value: Item["type"]; label: string }[] = [
  { value: "CHECKBOX", label: "Checkbox" }, { value: "TEXT", label: "Text" }, { value: "NUMBER", label: "Number" },
  { value: "SELECT", label: "Choice" }, { value: "PHOTO", label: "Photo" }, { value: "VIDEO", label: "Video" },
];
const blank = (type: Item["type"]): Item => ({ type, label: "", required: true, options: [], min: null, max: null });

export function TemplateBuilder({ template }: { template?: { id: string; name: string; description: string | null; items: Item[] } }) {
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [items, setItems] = useState<Item[]>(template?.items ?? [blank("CHECKBOX")]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  const update = (i: number, patch: Partial<Item>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (i: number, dir: -1 | 1) => setItems((xs) => {
    const j = i + dir; if (j < 0 || j >= xs.length) return xs;
    const copy = [...xs]; [copy[i], copy[j]] = [copy[j], copy[i]]; return copy;
  });
  const remove = (i: number) => setItems((xs) => xs.filter((_, j) => j !== i));

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const input: TemplateFormInput = { name, description, items };
    start(async () => {
      const res = template ? await updateTemplateAction(template.id, input) : await createTemplateAction(input);
      if (res && !res.ok) { setError(res.error); setSaved(false); } else { setError(null); setSaved(true); }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="name">Name</Label><Input id="name" value={name} onChange={(e) => setName(e.target.value)} required /></div>
        <div className="space-y-1"><Label htmlFor="description">Description</Label><Input id="description" value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      </div>

      <ol className="space-y-3">
        {items.map((it, i) => (
          <li key={i} className="space-y-2 rounded-md border p-3" data-testid="item-row">
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Item type" className="rounded-md border bg-background px-2 py-1 text-sm" value={it.type}
                onChange={(e) => update(i, { ...blank(e.target.value as Item["type"]), label: it.label, required: it.required })}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <Input aria-label="Item label" placeholder="Label" value={it.label} onChange={(e) => update(i, { label: e.target.value })} className="min-w-40 flex-1" required />
              <label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={it.required} onChange={(e) => update(i, { required: e.target.checked })} /> Required</label>
              <div className="ml-auto flex gap-1">
                <Button type="button" variant="ghost" size="sm" aria-label="Move up" onClick={() => move(i, -1)} disabled={i === 0}>↑</Button>
                <Button type="button" variant="ghost" size="sm" aria-label="Move down" onClick={() => move(i, 1)} disabled={i === items.length - 1}>↓</Button>
                <Button type="button" variant="ghost" size="sm" aria-label="Remove item" onClick={() => remove(i)}>✕</Button>
              </div>
            </div>
            {it.type === "SELECT" && (
              <textarea aria-label="Options, one per line" className="w-full rounded-md border bg-background p-2 text-sm" rows={3} placeholder="One option per line"
                value={it.options.join("\n")} onChange={(e) => update(i, { options: e.target.value.split("\n") })} />
            )}
            {it.type === "NUMBER" && (
              <div className="flex gap-2">
                <Input aria-label="Min" type="number" placeholder="Min" value={it.min ?? ""} onChange={(e) => update(i, { min: e.target.value === "" ? null : Number(e.target.value) })} className="w-28" />
                <Input aria-label="Max" type="number" placeholder="Max" value={it.max ?? ""} onChange={(e) => update(i, { max: e.target.value === "" ? null : Number(e.target.value) })} className="w-28" />
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-2">
        {TYPES.map((t) => (
          <Button key={t.value} type="button" variant="outline" size="sm" onClick={() => setItems((xs) => [...xs, blank(t.value)])}>+ {t.label}</Button>
        ))}
      </div>

      <FormError message={error} />
      {saved && template && <p className="text-sm text-muted-foreground">Saved.</p>}
      <div className="max-w-xs"><SubmitButton pending={pending}>{template ? "Save" : "Create template"}</SubmitButton></div>
    </form>
  );
}
```

`SELECT` options are split on newlines; the service trims and drops blanks. Changing type resets type-specific fields but keeps label/required.

- [ ] **Step 4: Pages**

Create `app/(app)/templates/page.tsx`:

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/auth/guard";
import { listTemplates } from "@/lib/services/template";
import { AppError } from "@/lib/errors";
import { Forbidden } from "@/components/forbidden";
import { Button } from "@/components/ui/button";

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const ctx = await requireUser();
  const { archived } = await searchParams;
  let templates;
  try {
    templates = await listTemplates(ctx, { includeArchived: archived === "1" });
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") return <Forbidden />;
    throw e;
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Templates</h1>
        <Button render={<Link href="/templates/new" />}>New template</Button>
      </div>
      <p className="text-sm">
        <Link className="underline" href={archived === "1" ? "/templates" : "/templates?archived=1"}>{archived === "1" ? "Hide archived" : "Show archived"}</Link>
      </p>
      {templates.length === 0 && <p className="text-sm text-muted-foreground">No templates yet.</p>}
      <ul className="divide-y rounded-md border">
        {templates.map((t) => (
          <li key={t.id} className="flex items-center justify-between p-3 text-sm">
            <Link href={`/templates/${t.id}`} className="font-medium">{t.name}</Link>
            <span className="text-muted-foreground">{t.itemCount} item{t.itemCount === 1 ? "" : "s"}{t.archivedAt ? " · archived" : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Create `app/(app)/templates/new/page.tsx`:

```tsx
import { requireUser, requireOrgRole } from "@/lib/auth/guard";
import { AppError } from "@/lib/errors";
import { Forbidden } from "@/components/forbidden";
import { TemplateBuilder } from "../template-builder";

export default async function NewTemplatePage() {
  try {
    await requireOrgRole(await requireUser(), "MANAGER");
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") return <Forbidden />;
    throw e;
  }
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">New template</h1>
      <TemplateBuilder />
    </div>
  );
}
```

Create `app/(app)/templates/[id]/archive-button.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { archiveTemplateAction, unarchiveTemplateAction } from "@/actions/template";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";

export function ArchiveButton({ id, archived }: { id: string; archived: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-1">
      <Button variant="outline" size="sm" disabled={pending}
        onClick={() => start(async () => { const r = await (archived ? unarchiveTemplateAction(id) : archiveTemplateAction(id)); if (!r.ok) setError(r.error); })}>
        {archived ? "Unarchive" : "Archive"}
      </Button>
      <FormError message={error} />
    </div>
  );
}
```

Create `app/(app)/templates/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guard";
import { getTemplate } from "@/lib/services/template";
import { AppError } from "@/lib/errors";
import { Forbidden } from "@/components/forbidden";
import { TemplateBuilder } from "../template-builder";
import { ArchiveButton } from "./archive-button";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireUser();
  let t;
  try {
    t = await getTemplate(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") return <Forbidden />;
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t.name}{t.archivedAt ? " (archived)" : ""}</h1>
        <ArchiveButton id={t.id} archived={!!t.archivedAt} />
      </div>
      <TemplateBuilder template={{ id: t.id, name: t.name, description: t.description, items: t.items.map(({ type, label, required, options, min, max }) => ({ type, label, required, options, min, max })) }} />
    </div>
  );
}
```

- [ ] **Step 5: Verify**

`pnpm build && pnpm lint`. Then `pnpm dev`, sign in as manager@example.com / password123, create a template with one of each type (SELECT with three options, NUMBER with min/max), reorder, save, reload, edit, archive, show archived, unarchive. Playwright at 375 px: no horizontal scroll. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add template list and builder pages"
```

---

### Task 8: Property page — Checklists section and Assign form

**Files:**
- Create: `app/(app)/properties/[id]/checklists.tsx`, `app/(app)/properties/[id]/assign-form.tsx`, `components/status-badge.tsx`, `lib/format.ts`
- Modify: `app/(app)/properties/[id]/page.tsx`

**Interfaces:**
- Consumes: `listForProperty`, `InstanceSummary`, `listTemplates`, `assignChecklistAction`.
- Produces: `<StatusBadge status overdue />`; `formatDateTime(d: Date): string` and `toLocalInputValue(d: Date): string` in `lib/format.ts`.

- [ ] **Step 1: Helpers**

Create `lib/format.ts`:

```ts
export const formatDateTime = (d: Date) =>
  d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Value for <input type="datetime-local">, in the browser's local time. */
export function toLocalInputValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

Create `components/status-badge.tsx`:

```tsx
import type { InstanceStatus } from "@prisma/client";

const STYLES: Record<InstanceStatus | "OVERDUE", string> = {
  OPEN: "bg-muted text-foreground",
  OVERDUE: "bg-destructive/15 text-destructive",
  SUBMITTED: "bg-blue-100 text-blue-900",
  APPROVED: "bg-green-100 text-green-900",
  REJECTED: "bg-amber-100 text-amber-900",
};
const LABELS: Record<InstanceStatus | "OVERDUE", string> = { OPEN: "Open", OVERDUE: "Overdue", SUBMITTED: "Submitted", APPROVED: "Approved", REJECTED: "Needs rework" };

export function StatusBadge({ status, overdue }: { status: InstanceStatus; overdue: boolean }) {
  const key = overdue ? "OVERDUE" : status;
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLES[key]}`}>{LABELS[key]}</span>;
}
```

- [ ] **Step 2: Instance list (server component)**

Create `app/(app)/properties/[id]/checklists.tsx`:

```tsx
import Link from "next/link";
import type { InstanceSummary } from "@/lib/services/instance";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/format";

const FILTERS = [["", "All"], ["OPEN", "Open"], ["OVERDUE", "Overdue"], ["SUBMITTED", "Submitted"], ["APPROVED", "Approved"], ["REJECTED", "Rejected"]] as const;

export function PropertyChecklists({ propertyId, instances, filter }: { propertyId: string; instances: InstanceSummary[]; filter: string }) {
  return (
    <section className="space-y-3">
      <h2 className="font-medium">Checklists</h2>
      <nav className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map(([value, label]) => (
          <Link key={value} href={value ? `/properties/${propertyId}?status=${value}` : `/properties/${propertyId}`}
            className={`rounded-md px-2 py-1 ${filter === value ? "bg-accent font-medium" : "text-muted-foreground"}`}>{label}</Link>
        ))}
      </nav>
      <ul className="divide-y rounded-md border">
        {instances.length === 0 && <li className="p-3 text-sm text-muted-foreground">No checklists.</li>}
        {instances.map((i) => (
          <li key={i.id} className="p-3 text-sm">
            <Link href={`/checklists/${i.id}`} className="flex flex-wrap items-center justify-between gap-2">
              <span><span className="font-medium">{i.templateName}</span> <span className="text-muted-foreground">· {i.assigneeName}</span></span>
              <span className="flex items-center gap-2 text-muted-foreground">{formatDateTime(i.dueAt)} <StatusBadge status={i.status} overdue={i.overdue} /></span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 3: Assign form (client)**

Create `app/(app)/properties/[id]/assign-form.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { assignChecklistAction } from "@/actions/instance";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";
import { toLocalInputValue } from "@/lib/format";

type Opt = { id: string; name: string };

export function AssignForm({ propertyId, templates, workers }: { propertyId: string; templates: Opt[]; workers: Opt[] }) {
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const defaultDue = toLocalInputValue(new Date(Date.now() + 24 * 3600_000));
  if (templates.length === 0) return <p className="text-sm text-muted-foreground">Create a template first.</p>;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        const local = String(fd.get("dueAt"));
        start(async () => {
          const r = await assignChecklistAction({
            templateId: String(fd.get("templateId")), propertyId,
            assigneeIds: fd.getAll("assigneeIds").map(String),
            dueAt: new Date(local).toISOString(),
          });
          if (!r.ok) { setError(r.error); setDone(null); } else { setError(null); setDone(`Assigned to ${r.data.ids.length} worker${r.data.ids.length === 1 ? "" : "s"}.`); form.reset(); }
        });
      }}
      className="max-w-md space-y-3 rounded-md border p-4"
    >
      <h3 className="font-medium">Assign checklist</h3>
      <div className="space-y-1">
        <Label htmlFor="templateId">Template</Label>
        <select id="templateId" name="templateId" className="w-full rounded-md border bg-background px-2 py-2 text-sm" required>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Workers</legend>
        {workers.length === 0 && <p className="text-sm text-muted-foreground">Add members to this property first.</p>}
        {workers.map((w) => (
          <label key={w.id} className="flex items-center gap-2 text-sm"><input type="checkbox" name="assigneeIds" value={w.id} /> {w.name}</label>
        ))}
      </fieldset>
      <div className="space-y-1">
        <Label htmlFor="dueAt">Due</Label>
        <input id="dueAt" name="dueAt" type="datetime-local" defaultValue={defaultDue} required className="w-full rounded-md border bg-background px-2 py-2 text-sm" />
      </div>
      <FormError message={error} />
      {done && <p className="text-sm text-muted-foreground">{done}</p>}
      <SubmitButton pending={pending}>Assign</SubmitButton>
    </form>
  );
}
```

- [ ] **Step 4: Wire into the property page**

In `app/(app)/properties/[id]/page.tsx`: accept `searchParams: Promise<{ status?: string }>`; after loading `property`, add:

```ts
  const { status } = await searchParams;
  const filter = ["OPEN", "OVERDUE", "SUBMITTED", "APPROVED", "REJECTED"].includes(status ?? "") ? status! : "";
  const instances = await listForProperty(ctx, id, filter ? { status: filter as InstanceStatus | "OVERDUE" } : {});
  const templates = canEdit ? await listTemplates(ctx) : [];
```

Imports: `listForProperty` from `@/lib/services/instance`, `listTemplates` from `@/lib/services/template`, `InstanceStatus` type from `@prisma/client`, `PropertyChecklists`, `AssignForm`. Render below the members section:

```tsx
      <PropertyChecklists propertyId={property.id} instances={instances} filter={filter} />
      {canEdit && <AssignForm propertyId={property.id} templates={templates.map((t) => ({ id: t.id, name: t.name }))} workers={property.members.map((m) => ({ id: m.userId, name: m.name }))} />}
```

Workers listed for assignment are the property's members (any role); the service enforces membership.

- [ ] **Step 5: Verify**

`pnpm build && pnpm lint && pnpm test`. `pnpm dev`: as manager, open Villa Azul, assign the template to Wendy with a due time; the list shows it as Open; set due in the past via a second assignment and confirm the Overdue filter. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add property checklist list and assignment"
```

---

### Task 9: Instance detail page and manager review

**Files:**
- Create: `app/(app)/checklists/[id]/page.tsx`, `app/(app)/checklists/[id]/review-form.tsx`, `app/(app)/checklists/[id]/answer-view.tsx`
- Test: none new (services covered); manual verification

**Interfaces:**
- Consumes: `getInstance`, `InstanceDetail`, `presignDownload`, `storageConfigured`, `reviewChecklistAction`, `StatusBadge`, `formatDateTime`.
- Produces: the page renders `<FillForm>` (Task 10) when `canFill`, else the read-only view; `mediaUrls: Record<itemId, string>` computed server-side and passed to both.

- [ ] **Step 1: Read-only answer view**

Create `app/(app)/checklists/[id]/answer-view.tsx`:

```tsx
import type { InstanceItemRow } from "@/lib/services/instance";
import { isAnswered } from "@/lib/services/instance";

export function AnswerView({ items, mediaUrls }: { items: InstanceItemRow[]; mediaUrls: Record<string, string> }) {
  return (
    <ol className="space-y-3">
      {items.map((i) => (
        <li key={i.id} className="rounded-md border p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">{i.label}{i.required && <span className="text-destructive"> *</span>}</span>
            {!isAnswered(i) && <span className="text-xs text-muted-foreground">Not answered</span>}
          </div>
          <div className="mt-1">
            {i.type === "CHECKBOX" && (i.checked ? "✓ Done" : "")}
            {i.type === "TEXT" && <p className="whitespace-pre-wrap">{i.text}</p>}
            {i.type === "NUMBER" && i.number !== null && String(i.number)}
            {i.type === "SELECT" && i.choice}
            {i.type === "PHOTO" && i.fileKey && (mediaUrls[i.id]
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={mediaUrls[i.id]} alt={i.label} className="max-h-80 rounded-md" />
              : <span className="text-muted-foreground">Photo unavailable</span>)}
            {i.type === "VIDEO" && i.fileKey && (mediaUrls[i.id]
              ? <div className="space-y-1"><video controls playsInline src={mediaUrls[i.id]} className="max-h-80 w-full rounded-md" /><a className="text-xs underline" href={mediaUrls[i.id]} download>Download video</a></div>
              : <span className="text-muted-foreground">Video unavailable</span>)}
          </div>
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 2: Review form (client)**

Create `app/(app)/checklists/[id]/review-form.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { reviewChecklistAction } from "@/actions/instance";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";

export function ReviewForm({ instanceId }: { instanceId: string }) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const decide = (decision: "APPROVED" | "REJECTED") =>
    start(async () => { const r = await reviewChecklistAction(instanceId, { decision, comment }); if (!r.ok) setError(r.error); });
  return (
    <section className="space-y-2 rounded-md border p-4">
      <h2 className="font-medium">Review</h2>
      <textarea aria-label="Review comment" className="w-full rounded-md border bg-background p-2 text-sm" rows={3}
        placeholder="Comment (required when rejecting)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <FormError message={error} />
      <div className="flex gap-2">
        <Button disabled={pending} onClick={() => decide("APPROVED")}>Approve</Button>
        <Button variant="destructive" disabled={pending} onClick={() => decide("REJECTED")}>Reject</Button>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Page**

Create `app/(app)/checklists/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guard";
import { getInstance } from "@/lib/services/instance";
import { presignDownload, storageConfigured } from "@/lib/storage";
import { AppError } from "@/lib/errors";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/format";
import { AnswerView } from "./answer-view";
import { ReviewForm } from "./review-form";
import { FillForm } from "./fill-form";

export default async function ChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireUser();
  let inst;
  try {
    inst = await getInstance(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const mediaUrls: Record<string, string> = {};
  if (storageConfigured()) {
    for (const i of inst.items) if (i.fileKey) mediaUrls[i.id] = await presignDownload(i.fileKey);
  }
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground"><Link href={`/properties/${inst.propertyId}`} className="underline">{inst.propertyName}</Link> · {inst.assigneeName}</p>
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold">{inst.templateName} <StatusBadge status={inst.status} overdue={inst.overdue} /></h1>
        <p className="text-sm text-muted-foreground">Due {formatDateTime(inst.dueAt)}</p>
      </div>
      {inst.status === "REJECTED" && inst.reviewComment && (
        <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="font-medium">Needs rework{inst.reviewedByName ? ` · ${inst.reviewedByName}` : ""}</p>
          <p className="whitespace-pre-wrap">{inst.reviewComment}</p>
        </div>
      )}
      {inst.status === "APPROVED" && inst.reviewComment && <p className="text-sm text-muted-foreground">Reviewer note: {inst.reviewComment}</p>}
      {inst.canFill ? <FillForm instance={inst} mediaUrls={mediaUrls} /> : <AnswerView items={inst.items} mediaUrls={mediaUrls} />}
      {inst.canReview && <ReviewForm instanceId={inst.id} />}
    </div>
  );
}
```

Until Task 10 lands, create a stub `app/(app)/checklists/[id]/fill-form.tsx` so the build passes:

```tsx
import type { InstanceDetail } from "@/lib/services/instance";
import { AnswerView } from "./answer-view";
export function FillForm({ instance, mediaUrls }: { instance: InstanceDetail; mediaUrls: Record<string, string> }) {
  return <AnswerView items={instance.items} mediaUrls={mediaUrls} />;
}
```

- [ ] **Step 4: Verify**

`pnpm build && pnpm lint`. `pnpm dev`: as manager open an assigned checklist from Villa Azul → read-only view, no review form (OPEN). Flip its status to SUBMITTED via Prisma (`pnpm tsx -e` or psql) and reload → Review form; reject with a comment → status Needs rework and banner; set SUBMITTED again and approve. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add checklist detail page with manager review"
```

---

### Task 10: Worker fill form, media upload, Today page, dashboard counts

**Files:**
- Create: `lib/client/resize-image.ts`, `lib/client/upload.ts`, `app/(app)/checklists/[id]/media-item.tsx`, `app/(app)/today/page.tsx`
- Modify: `app/(app)/checklists/[id]/fill-form.tsx` (replace stub), `app/(app)/page.tsx`

**Interfaces:**
- Consumes: `answerItemAction`, `submitChecklistAction`, `requestUploadAction`, `InstanceDetail`, `InstanceItemRow`, `isAnswered` (pure function — import from `@/lib/services/instance` is server-only because of `db`; so copy the pure helper into `lib/media.ts` as `isItemAnswered` and use it in both places), `listMine`, `instanceCounts`, `mediaRule`, `PHOTO_TYPES`, `VIDEO_TYPES`.
- Produces: `resizeImage(file: File, maxEdge = 1600, quality = 0.8): Promise<Blob>`; `uploadWithProgress(url, blob, contentType, onProgress): Promise<void>` (rejects on non-2xx).

- [ ] **Step 1: Move the pure "answered" check to `lib/media.ts`**

Append to `lib/media.ts`:

```ts
export function isItemAnswered(i: { type: string; checked: boolean | null; text: string | null; number: number | null; choice: string | null; fileKey: string | null }) {
  switch (i.type) {
    case "CHECKBOX": return i.checked === true;
    case "TEXT": return !!i.text?.trim();
    case "NUMBER": return i.number !== null;
    case "SELECT": return i.choice !== null;
    default: return i.fileKey !== null;
  }
}
```

In `lib/services/instance.ts` replace the body of `isAnswered` with `return isItemAnswered(i);` (keep the export). In `answer-view.tsx` import `isItemAnswered` from `@/lib/media` instead.

- [ ] **Step 2: Client helpers**

Create `lib/client/resize-image.ts`:

```ts
/** Downscale to maxEdge on the long side and re-encode as JPEG. Falls back to the original file if decoding fails. */
export async function resizeImage(file: File, maxEdge = 1600, quality = 0.8): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.type === "image/jpeg") return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", quality));
  } catch {
    return file;
  }
}
```

Create `lib/client/upload.ts`:

```ts
export function uploadWithProgress(url: string, body: Blob, contentType: string, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error("Upload failed (network)"));
    xhr.send(body);
  });
}
```

- [ ] **Step 3: Media item (client)**

Create `app/(app)/checklists/[id]/media-item.tsx`:

```tsx
"use client";
import { useState } from "react";
import { answerItemAction, requestUploadAction } from "@/actions/instance";
import { mediaRule } from "@/lib/media";
import { resizeImage } from "@/lib/client/resize-image";
import { uploadWithProgress } from "@/lib/client/upload";
import { FormError } from "@/components/form-error";

type Props = { instanceId: string; itemId: string; type: "PHOTO" | "VIDEO"; existingUrl?: string; onSaved: () => void };

export function MediaItem({ instanceId, itemId, type, existingUrl, onSaved }: Props) {
  const [preview, setPreview] = useState<string | undefined>(existingUrl);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rule = mediaRule(type);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const blob = type === "PHOTO" ? await resizeImage(file) : file;
      const contentType = type === "PHOTO" ? "image/jpeg" : file.type;
      if (!rule.types.includes(contentType)) throw new Error(`Unsupported file type ${contentType || "(unknown)"}`);
      if (blob.size > rule.maxBytes) throw new Error(`File is too large (max ${Math.round(rule.maxBytes / 1024 / 1024)} MB)`);
      setProgress(0);
      const req = await requestUploadAction({ instanceId, itemId, contentType, sizeBytes: blob.size });
      if (!req.ok) throw new Error(req.error);
      await uploadWithProgress(req.data.url, blob, contentType, setProgress);
      const saved = await answerItemAction(instanceId, itemId, { type, fileKey: req.data.key, fileType: contentType });
      if (!saved.ok) throw new Error(saved.error);
      setPreview(URL.createObjectURL(blob));
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="space-y-2">
      {preview && (type === "PHOTO"
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={preview} alt="" className="max-h-64 rounded-md" />
        : <video controls playsInline src={preview} className="max-h-64 w-full rounded-md" />)}
      <label className="block">
        <span className="sr-only">{type === "PHOTO" ? "Take photo" : "Record video"}</span>
        <input type="file" accept={type === "PHOTO" ? "image/*" : "video/*"} capture="environment" disabled={progress !== null}
          onChange={(e) => onFile(e.target.files?.[0])}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-primary-foreground" />
      </label>
      {progress !== null && <progress className="w-full" value={progress} max={100}>{progress}%</progress>}
      <FormError message={error} />
    </div>
  );
}
```

- [ ] **Step 4: Fill form (client)**

Replace `app/(app)/checklists/[id]/fill-form.tsx`:

```tsx
"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerItemAction, submitChecklistAction } from "@/actions/instance";
import type { InstanceDetail, InstanceItemRow } from "@/lib/services/instance";
import { isItemAnswered } from "@/lib/media";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/form-error";
import { MediaItem } from "./media-item";

export function FillForm({ instance, mediaUrls }: { instance: InstanceDetail; mediaUrls: Record<string, string> }) {
  const router = useRouter();
  const [items, setItems] = useState<InstanceItemRow[]>(instance.items);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const patch = (id: string, p: Partial<InstanceItemRow>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));

  async function save(item: InstanceItemRow, value: Parameters<typeof answerItemAction>[2], local: Partial<InstanceItemRow>) {
    patch(item.id, local);
    setSaving((s) => ({ ...s, [item.id]: true }));
    const r = await answerItemAction(instance.id, item.id, value);
    setSaving((s) => ({ ...s, [item.id]: false }));
    setErrors((e) => ({ ...e, [item.id]: r.ok ? "" : r.error }));
    if (r.ok) patch(item.id, { answeredAt: new Date() });
  }

  const required = items.filter((i) => i.required);
  const done = required.filter(isItemAnswered).length;
  const complete = done === required.length;

  return (
    <div className="space-y-4 pb-24">
      <ol className="space-y-3">
        {items.map((i) => (
          <li key={i.id} className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{i.label}{i.required && <span className="text-destructive"> *</span>}</span>
              <span className="text-xs text-muted-foreground">{saving[i.id] ? "Saving…" : isItemAnswered(i) ? "Saved" : ""}</span>
            </div>
            {i.type === "CHECKBOX" && (
              <Button type="button" variant={i.checked ? "default" : "outline"} className="w-full justify-start"
                onClick={() => save(i, { type: "CHECKBOX", checked: !i.checked }, { checked: !i.checked })}>
                {i.checked ? "✓ Done" : "Mark done"}
              </Button>
            )}
            {i.type === "TEXT" && (
              <textarea className="w-full rounded-md border bg-background p-2 text-sm" rows={3} defaultValue={i.text ?? ""}
                onBlur={(e) => { if (e.target.value !== (i.text ?? "")) save(i, { type: "TEXT", text: e.target.value }, { text: e.target.value }); }} />
            )}
            {i.type === "NUMBER" && (
              <input type="number" inputMode="decimal" step="any" min={i.min ?? undefined} max={i.max ?? undefined} defaultValue={i.number ?? ""}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                onBlur={(e) => { if (e.target.value !== "") { const n = Number(e.target.value); save(i, { type: "NUMBER", number: n }, { number: n }); } }} />
            )}
            {i.type === "SELECT" && (
              <select className="w-full rounded-md border bg-background px-2 py-2 text-sm" value={i.choice ?? ""}
                onChange={(e) => save(i, { type: "SELECT", choice: e.target.value }, { choice: e.target.value })}>
                <option value="" disabled>Choose…</option>
                {i.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {(i.type === "PHOTO" || i.type === "VIDEO") && (
              <MediaItem instanceId={instance.id} itemId={i.id} type={i.type} existingUrl={mediaUrls[i.id]}
                onSaved={() => patch(i.id, { fileKey: "set", answeredAt: new Date() })} />
            )}
            <FormError message={errors[i.id]} />
          </li>
        ))}
      </ol>

      <div className="fixed inset-x-0 bottom-16 z-10 border-t bg-background p-3 md:bottom-0 md:left-56">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">{done} of {required.length} required done</span>
          <Button disabled={!complete || pending}
            onClick={() => start(async () => { const r = await submitChecklistAction(instance.id); if (!r.ok) setSubmitError(r.error); else router.refresh(); })}>
            Submit
          </Button>
        </div>
        <FormError message={submitError} />
      </div>
    </div>
  );
}
```

The sticky footer sits above the mobile bottom nav (`bottom-16`) and clears the desktop sidebar (`md:left-56`); the `pb-24` wrapper keeps the last item reachable.

- [ ] **Step 5: Today page**

Create `app/(app)/today/page.tsx`:

```tsx
import Link from "next/link";
import { requireUser } from "@/lib/auth/guard";
import { listMine, InstanceSummary } from "@/lib/services/instance";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/format";

function bucket(all: InstanceSummary[]) {
  const now = new Date();
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
  const out = { overdue: [] as InstanceSummary[], rework: [] as InstanceSummary[], today: [] as InstanceSummary[], upcoming: [] as InstanceSummary[], done: [] as InstanceSummary[] };
  for (const i of all) {
    if (i.status === "REJECTED") out.rework.push(i);
    else if (i.status === "SUBMITTED" || i.status === "APPROVED") out.done.push(i);
    else if (i.overdue) out.overdue.push(i);
    else if (i.dueAt <= endOfDay) out.today.push(i);
    else out.upcoming.push(i);
  }
  return out;
}

function Section({ title, items }: { title: string; items: InstanceSummary[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="font-medium">{title}</h2>
      <ul className="divide-y rounded-md border">
        {items.map((i) => (
          <li key={i.id}>
            <Link href={`/checklists/${i.id}`} className="flex items-center justify-between gap-2 p-3 text-sm">
              <span><span className="font-medium">{i.templateName}</span> <span className="text-muted-foreground">· {i.propertyName}</span></span>
              <span className="flex items-center gap-2 text-muted-foreground">{formatDateTime(i.dueAt)} <StatusBadge status={i.status} overdue={i.overdue} /></span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function TodayPage() {
  const ctx = await requireUser();
  const b = bucket(await listMine(ctx));
  const empty = Object.values(b).every((x) => x.length === 0);
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Today</h1>
      {empty && <p className="text-sm text-muted-foreground">Nothing assigned to you.</p>}
      <Section title="Overdue" items={b.overdue} />
      <Section title="Needs rework" items={b.rework} />
      <Section title="Due today" items={b.today} />
      <Section title="Upcoming" items={b.upcoming} />
      <Section title="Done" items={b.done} />
    </div>
  );
}
```

- [ ] **Step 6: Dashboard redirect and counts**

In `app/(app)/page.tsx`: after `const role = await requireOrgRole(ctx, "WORKER");` add `if (role === "WORKER") redirect("/today");` (import `redirect` from `next/navigation`). After `listProperties`, add `const counts = await instanceCounts(ctx, properties.map((p) => p.id));` (import from `@/lib/services/instance`) and in each card's `CardContent` append:

```tsx
                {counts[p.id].open > 0 && <> · {counts[p.id].open} open</>}
                {counts[p.id].overdue > 0 && <span className="text-destructive"> · {counts[p.id].overdue} overdue</span>}
```

Also in `actions/auth.ts` `loginAction`: leave as is — `/` redirects workers to `/today` on load.

- [ ] **Step 7: Verify**

`pnpm build && pnpm lint && pnpm test`. `pnpm dev` with MinIO running and `pnpm storage:init` done: sign in as wendy@example.com (worker) → lands on /today → open the assigned checklist → tick the checkbox, type notes (blur), enter a number out of range (see inline error) then in range, choose an option, upload a photo (use Playwright `setInputFiles` with a small JPEG; the preview appears; DevTools network shows a PUT to :9000), Submit → status Submitted. As manager: open it, reject with a comment; as worker: Needs rework banner, resubmit; manager approves. Playwright 375 px screenshot of the fill form saved to the SDD workspace; confirm no horizontal scroll and the footer does not cover the bottom nav. Stop the server.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add worker checklist fill form, media upload, and today page"
```

---

### Task 11: E2E checklist flow, CI, README

**Files:**
- Create: `e2e/checklist.spec.ts`, `e2e/fixtures/photo.jpg`
- Modify: `README.md`, `.github/workflows/ci.yml` (only if Task 5 left anything out)

- [ ] **Step 1: Fixture**

Generate a small JPEG with the installed Chromium (no ImageMagick): a throwaway Playwright script in the scratchpad that renders a 200×150 colored div and screenshots it as `e2e/fixtures/photo.jpg` (`type: "jpeg"`). Commit the fixture (a few KB).

- [ ] **Step 2: Spec**

Create `e2e/checklist.spec.ts`:

```ts
import "dotenv/config";
import { test, expect } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import path from "node:path";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL_TEST }) });
test.afterAll(async () => { await db.$disconnect(); });
const stamp = Date.now();
const ownerEmail = `cl-owner${stamp}@test.local`;
const workerEmail = `cl-worker${stamp}@test.local`;

test("template → assign → fill with photo → reject → resubmit → approve", async ({ page, browser }) => {
  test.skip(!process.env.S3_ENDPOINT, "needs MinIO");

  // Owner signs up, creates a property, invites the worker
  await page.goto("/signup");
  await page.fill("#orgName", "CL Org"); await page.fill("#name", "Owner"); await page.fill("#email", ownerEmail); await page.fill("#password", "password123");
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Properties" })).toBeVisible();
  await page.getByRole("link", { name: "New property" }).click();
  await page.fill("#name", "Villa E2E"); await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Villa E2E" })).toBeVisible();
  const propertyUrl = page.url();
  await page.goto("/team");
  await page.fill("#email", workerEmail); await page.selectOption("#role", "WORKER"); await page.getByLabel("Villa E2E").check();
  await page.click("button[type=submit]");
  await expect(page.getByText("Invitation sent.")).toBeVisible();
  const invite = await db.invite.findFirstOrThrow({ where: { email: workerEmail } });

  // Worker accepts
  const wctx = await browser.newContext();
  const worker = await wctx.newPage();
  await worker.goto(`/invite/${invite.token}`);
  await worker.fill("#name", "Worker"); await worker.fill("#password", "password123"); await worker.click("button[type=submit]");
  await expect(worker.getByRole("heading", { name: "Today" })).toBeVisible();

  // Owner builds a template: checkbox, text (optional), photo
  await page.goto("/templates/new");
  await page.fill("#name", "Clean E2E");
  await page.getByLabel("Item label").first().fill("Beds made");
  await page.getByRole("button", { name: "+ Text" }).click();
  await page.getByLabel("Item label").nth(1).fill("Notes");
  await page.getByLabel("Required").nth(1).uncheck();
  await page.getByRole("button", { name: "+ Photo" }).click();
  await page.getByLabel("Item label").nth(2).fill("Bathroom");
  await page.click("button[type=submit]");
  await expect(page.getByRole("heading", { name: "Clean E2E" })).toBeVisible();

  // Owner assigns it to the worker
  await page.goto(propertyUrl);
  await page.selectOption("#templateId", { label: "Clean E2E" });
  await page.getByLabel("Worker").check();
  await page.getByRole("button", { name: "Assign" }).click();
  await expect(page.getByText("Assigned to 1 worker.")).toBeVisible();

  // Worker fills it in
  await worker.goto("/today");
  await worker.getByRole("link", { name: /Clean E2E/ }).click();
  await worker.getByRole("button", { name: "Mark done" }).click();
  await expect(worker.getByText("✓ Done")).toBeVisible();
  await worker.setInputFiles('input[type=file]', path.join(__dirname, "fixtures/photo.jpg"));
  await expect(worker.getByText("2 of 2 required done")).toBeVisible({ timeout: 15_000 });
  await worker.getByRole("button", { name: "Submit" }).click();
  await expect(worker.getByText("Submitted")).toBeVisible();

  // Owner rejects, worker resubmits, owner approves
  const inst = await db.checklistInstance.findFirstOrThrow({ where: { templateName: "Clean E2E" } });
  await page.goto(`/checklists/${inst.id}`);
  await page.getByLabel("Review comment").fill("Redo the beds");
  await page.getByRole("button", { name: "Reject" }).click();
  await expect(page.getByText("Needs rework")).toBeVisible();
  await worker.reload();
  await expect(worker.getByText("Redo the beds")).toBeVisible();
  await worker.getByRole("button", { name: "Submit" }).click();
  await expect(worker.getByText("Submitted")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved")).toBeVisible();
  await wctx.close();
});
```

Adjust locators to the real markup if a selector misses (e.g. the `Required` checkbox label, the worker checkbox label in the assign form is the worker's name "Worker"). Fix locators, not the app, unless the app is wrong.

- [ ] **Step 3: Run**

Run: `pnpm e2e`
Expected: 2 passed (smoke + checklist).

- [ ] **Step 4: README and CI**

README: add a "Checklists" paragraph to the feature list (templates → assign → worker fills on phone → review), mention `pnpm storage:init` in setup and that e2e needs MinIO. Confirm CI already has the MinIO service and `storage:init` from Task 5; if not, add them.

- [ ] **Step 5: Full check and commit**

Run: `pnpm lint && pnpm test && pnpm build && pnpm e2e`
Expected: all green.

```bash
git add -A
git commit -m "test: add checklist end-to-end flow"
```
