# Checkly — Sub-project 2: Checklists

Date: 2026-09-14
Status: approved design, awaiting implementation plan
Builds on: `docs/superpowers/specs/2026-09-12-foundation-design.md` (merged to main at 343b2e9)

## Product context

Managers build reusable checklist templates, assign them at a property to specific workers with a due time, and review what comes back. Workers complete their own copy on the phone, item by item, with photos and videos. Scheduling (recurrence) and notifications are sub-project 3; this sub-project exposes the single `assign` entry point that recurrence will call.

Decisions carried over: online only; fixed roles OWNER > MANAGER > WORKER; one instance per assigned user; MinIO for object storage; services own authorization; org id comes from the session only.

## Scope

In scope:

- Org-wide checklist templates with ordered, typed items: CHECKBOX, TEXT, NUMBER, PHOTO, VIDEO, SELECT. Per item: label, required flag; SELECT has an option list; NUMBER has optional min/max.
- Template builder UI (create, edit, archive).
- Manual assignment: template + property + one or more workers + due date/time. Creates one instance per worker with a frozen copy of the items.
- Worker completion UI with autosave per item and an explicit Submit.
- Photo upload (one per PHOTO item, max 5 MB, client-side resize to 1600 px) and video upload (one per VIDEO item, max 100 MB, no transcoding) via presigned PUT to S3-compatible storage (MinIO in dev).
- Manager review: instance detail with answers and media; Approve, or Reject with a required comment which reopens the instance for the same worker.
- Worker home `/today`; property page gains a Checklists tab with status filters.

Out of scope:

- Recurrence, due-time reminders, push, email (sub-project 3).
- Multiple media files per item, media transcoding, thumbnails, lifecycle cleanup of storage.
- Managers answering on behalf of workers; reassigning an instance; comment threads; approval history beyond the last review.
- Item help text, section headers, conditional items.
- Offline capture.

## Data model

Prisma additions. Every table with `orgId` is scoped by it in every query.

```
enum ItemType       { CHECKBOX TEXT NUMBER PHOTO VIDEO SELECT }
enum InstanceStatus { OPEN SUBMITTED APPROVED REJECTED }

ChecklistTemplate  id, orgId, name, description?, archivedAt?, createdAt, updatedAt
                   @@index(orgId)
TemplateItem       id, templateId, order Int, type ItemType, label, required Bool,
                   options String[] (SELECT only, else empty), min Float?, max Float? (NUMBER only)
                   @@unique(templateId, order); onDelete Cascade from template

ChecklistInstance  id, orgId, propertyId, templateId? (onDelete SetNull), templateName (copied),
                   assigneeId (User, onDelete Restrict), assignedById (User, onDelete Restrict),
                   dueAt DateTime, status InstanceStatus default OPEN,
                   submittedAt?, reviewedAt?, reviewedById? (User, onDelete SetNull), reviewComment?,
                   createdAt
                   @@index(orgId, assigneeId, status) @@index(propertyId, status)
                   property onDelete Cascade
InstanceItem       id, instanceId (onDelete Cascade), order, type, label, required, options, min, max
                   (frozen copy of the template item at assignment time),
                   checked Bool?, text String?, number Float?, choice String?,
                   fileKey String?, fileType String?, answeredAt?
                   @@unique(instanceId, order)
```

Rules:

- Templates are archived, not deleted, from the UI. Archived templates are hidden from the assign picker and the default template list. A hard delete (only via DB) sets `templateId` null on instances; `templateName` keeps the display name.
- Answer columns are per type; only the column matching the item's type is written. "Answered" means: CHECKBOX `checked === true`; TEXT non-empty `text`; NUMBER `number` not null; SELECT `choice` not null; PHOTO/VIDEO `fileKey` not null.
- Overdue is derived: `dueAt < now` and status in OPEN or REJECTED. Never stored.
- One review comment per instance. A new review overwrites the previous comment.
- Removing a user from an org deletes their OPEN and REJECTED instances in that org and keeps SUBMITTED and APPROVED ones for history. This happens inside `removeMember`'s existing transaction.

## Permissions and state machine

Services take `Ctx` from the session and call the existing guards.

```
lib/services/template.ts
  listTemplates(ctx, { includeArchived? })                  MANAGER+
  getTemplate(ctx, id)                                      MANAGER+
  createTemplate(ctx, { name, description?, items[] })      MANAGER+
  updateTemplate(ctx, id, { name, description?, items[] })  MANAGER+; replaces the item list wholesale in one transaction
  archiveTemplate(ctx, id) / unarchiveTemplate(ctx, id)     MANAGER+

lib/services/instance.ts
  assign(ctx, { templateId, propertyId, assigneeIds[], dueAt })
        MANAGER+ and requirePropertyAccess(propertyId); template must belong to the org and not be archived;
        every assignee must be a PropertyMember of that property (INVALID otherwise);
        creates one instance plus frozen items per assignee in one transaction; returns instance ids.
  listForProperty(ctx, propertyId, { status? })            requirePropertyAccess
  listMine(ctx, { status? })                               any org member; assigneeId = ctx.userId
  getInstance(ctx, id)                                     assignee, or MANAGER+ with property access; else NOT_FOUND
  answerItem(ctx, instanceId, itemId, value)               assignee only; status OPEN or REJECTED
  submit(ctx, instanceId)                                  assignee; status OPEN or REJECTED; all required items answered
  review(ctx, instanceId, decision: APPROVED | REJECTED, comment?)
        MANAGER+ with property access; status SUBMITTED; REJECTED requires a non-empty comment
```

Transitions:

```
OPEN ──submit──▶ SUBMITTED ──review(APPROVED)──▶ APPROVED   (terminal)
  ▲                   └──────review(REJECTED)──▶ REJECTED ──submit──▶ SUBMITTED
  └── answerItem is allowed only in OPEN and REJECTED
```

- `answerItem` validates the value with a zod discriminated union keyed by the frozen item type: CHECKBOX boolean; TEXT string max 2000; NUMBER finite number within min/max when set; SELECT one of `options`; PHOTO/VIDEO `{ fileKey, fileType }` where the key must equal the key this server issued for that item. It writes only that column and `answeredAt`.
- `submit` with missing required items throws INVALID with the message `Missing: <label>, <label>`.
- An illegal transition throws INVALID naming the current status.
- Owners have manager rights everywhere, as in the foundation.

## Media upload

`lib/storage.ts` wraps `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. MinIO is S3-compatible; R2 or AWS are drop-in later.

Environment: `S3_ENDPOINT`, `S3_REGION` (default `us-east-1`), `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE` (`true` for MinIO).

Functions: `presignUpload({ key, contentType, maxBytes, expiresSec })`, `presignDownload(key, expiresSec)`, `deleteObject(key)`. A script `scripts/storage-init.ts` (`pnpm storage:init`) creates the private bucket and sets a CORS rule allowing PUT from `APP_URL`.

Flow:

1. Worker picks or captures a file. For PHOTO the client resizes to max 1600 px on the long edge, JPEG quality 0.8, via canvas. For VIDEO the file is sent as-is.
2. `requestUploadAction(instanceId, itemId, contentType, sizeBytes)` checks: assignee, status OPEN or REJECTED, item type matches the content type family, size within the cap (5 MB photo, 100 MB video), content type in the allow list (`image/jpeg`, `image/png`, `image/webp`; `video/mp4`, `video/quicktime`, `video/webm`). Returns `{ url, key }` with key `org/<orgId>/instances/<instanceId>/<itemId>.<ext>` and a presigned PUT valid 5 minutes (photo) or 10 minutes (video), content-length capped.
3. Client PUTs with `XMLHttpRequest` to get upload progress. On success it calls `answerItemAction` with `{ fileKey, fileType }`. Re-upload overwrites the same key.
4. Viewing: the instance page calls `presignDownload` per media item (15 minutes). Photos render as `<img>`; videos as `<video controls playsinline>` plus a download link. iPhone `.mov` may not play in desktop Chrome; the download link is the fallback.

Failures: a failed PUT records nothing; a failed `answerItem` after a successful PUT leaves an orphan object (accepted; `ponytail:` comment, cleanup job later). Storage is never proxied through Next.

## UI and routes

Manager:

```
/(app)/templates            list: name, item count, archived filter; New template
/(app)/templates/new        builder
/(app)/templates/[id]       builder (edit), Archive / Unarchive
/(app)/properties/[id]      gains a Checklists tab: instances with status filter (Open, Overdue, Submitted, Approved, Rejected)
                            and an Assign dialog (template, workers of this property, due date/time)
/(app)/checklists/[id]      instance detail: frozen items with answers and media; Approve / Reject with comment when SUBMITTED
```

Builder: client component holding the item array in local state. Add item chooses a type. Each row: type badge, label input, required toggle, move up / move down buttons (no drag-and-drop library), remove. SELECT shows a textarea with one option per line; NUMBER shows min and max inputs. Save sends the whole list. No autosave.

Worker (phone first):

```
/(app)/today                sections: Due today, Overdue, Needs rework (REJECTED), Upcoming, Done (last 7 days)
/(app)/checklists/[id]      same route; renders the fill form when the viewer is the assignee and status is OPEN or REJECTED
```

Fill form: one card per item with large tap targets. CHECKBOX is a full-width toggle button; TEXT a textarea; NUMBER `<input type="number" inputmode="decimal">`; SELECT native `<select>`; PHOTO and VIDEO a capture input with preview and progress bar. Every change calls `answerItemAction` through `useTransition` with a saving indicator; a failure shows inline and keeps the local value. Sticky footer shows "N of M required done" and Submit, disabled until complete. A REJECTED instance shows the manager's comment in a banner.

Navigation: workers' bottom nav becomes Today, Properties, Settings; managers' sidebar adds Templates. After login, workers land on `/today`, managers on `/`. Property cards on the dashboard show open and overdue counts.

## Errors

- Same `ActionResult` contract and `run()` wrapper. Zod validates every action input.
- Validation and transition errors are INVALID with a specific message; access errors are FORBIDDEN or NOT_FOUND as in the foundation; storage client failures surface as the generic message.
- Autosave is last write wins per item. No versioning.

## Testing

- Vitest against Postgres, no mocks:
  - `tests/services/template.test.ts`: create, update replaces items wholesale, archive hides from picker, cross-org NOT_FOUND, WORKER forbidden.
  - `tests/services/instance.test.ts`: assign creates one instance per worker with frozen items; non-member assignee rejected; archived template rejected; answer validation per type incl. min/max and select membership; submit blocks on required with the missing labels; full state machine including reject then answer then resubmit then approve; illegal transitions; assignee-only answering; manager without property access denied; cross-org NOT_FOUND.
  - `tests/services/member.test.ts`: removeMember deletes OPEN and REJECTED instances, keeps SUBMITTED and APPROVED.
- `tests/services/storage.test.ts`: presign PUT, real `fetch` PUT of a small buffer to MinIO, presign GET reads it back. Skips when `S3_ENDPOINT` is unset; CI adds a MinIO service so it runs there.
- Playwright: extend the smoke: manager builds a template (checkbox, text, photo), assigns it to the worker with a due time; worker completes all three (photo via `setInputFiles` on a fixture JPEG) and submits; manager rejects with a comment; worker sees the rework banner and resubmits; manager approves.

## Migration and rollout

- One Prisma migration adding two enums and four tables. No backfill.
- New env vars in `.env.example`, compose `app` service, CI (MinIO service plus `pnpm storage:init`), README.
- `instance.assign` is the single entry point sub-project 3 will call from the scheduler.
