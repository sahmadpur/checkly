import { InstanceStatus, ItemType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { Ctx, requireOrgRole, requirePropertyAccess, roleAtLeast } from "@/lib/auth/guard";
import { forbidden, invalid, notFound } from "@/lib/errors";
import { extForMime, isItemAnswered, mediaKey, mediaRule } from "@/lib/media";
import { objectExists, presignUpload, storageConfigured } from "@/lib/storage";
import { copyParams } from "@/lib/notifications/copy";
import { notify, recipientsForSubmitted } from "@/lib/services/notification";

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

export type CreateInstancesInput = { orgId: string; propertyId: string; templateId: string; assigneeIds: string[]; dueAt: Date; assignedById: string; scheduleId?: string | null };

/** Creates one instance per assignee with frozen items and ASSIGNED notifications. No session; callers authorize. */
export async function createInstances(input: CreateInstancesInput, tx?: Prisma.TransactionClient) {
  const assigneeIds = [...new Set(input.assigneeIds)];
  if (assigneeIds.length === 0) throw invalid("pickWorker");
  if (assigneeIds.length > 50) throw invalid("maxWorkers", { max: 50 });
  const client = tx ?? db;
  const tpl = await client.checklistTemplate.findFirst({ where: { id: input.templateId, orgId: input.orgId }, include: { items: { orderBy: { order: "asc" } } } });
  if (!tpl) throw notFound("templateNotFound");
  if (tpl.archivedAt) throw invalid("templateArchived");
  if (tpl.items.length === 0) throw invalid("templateNoItems");
  const [members, property, org] = await Promise.all([
    client.propertyMember.count({ where: { propertyId: input.propertyId, userId: { in: assigneeIds } } }),
    client.property.findFirst({ where: { id: input.propertyId, orgId: input.orgId }, select: { name: true } }),
    client.org.findUniqueOrThrow({ where: { id: input.orgId }, select: { timezone: true } }),
  ]);
  if (!property) throw notFound("propertyNotFound");
  if (members !== assigneeIds.length) throw invalid("assigneeNotMember");
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
      const params = copyParams({ template: tpl.name, property: property.name, dueAt: input.dueAt, tz: org.timezone });
      await notify([{ orgId: input.orgId, userId: assigneeId, type: "ASSIGNED", instanceId: row.id, url: `/checklists/${row.id}`, params }], t);
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

export type StatusFilter = InstanceStatus | "OVERDUE";

const statusWhere = (status?: StatusFilter): Prisma.ChecklistInstanceWhereInput =>
  status === "OVERDUE" ? { status: { in: ["OPEN", "REJECTED"] }, dueAt: { lt: new Date() } } : status ? { status } : {};

export async function listForProperty(ctx: Ctx, propertyId: string, opts: { status?: StatusFilter } = {}) {
  const { role } = await requirePropertyAccess(ctx, propertyId);
  // Workers only ever see their own work; managers and owners see the whole property.
  const where: Prisma.ChecklistInstanceWhereInput = { orgId: ctx.orgId, propertyId, ...(role === "WORKER" ? { assigneeId: ctx.userId } : {}), ...statusWhere(opts.status) };
  const rows = await db.checklistInstance.findMany({ where, select: summarySelect, orderBy: { dueAt: "asc" } });
  return rows.map(toSummary);
}

/** Every instance a manager or owner may see: owners the whole org, managers only properties they belong to. */
export async function listAll(ctx: Ctx, opts: { status?: StatusFilter } = {}) {
  const role = await requireOrgRole(ctx, "MANAGER");
  const where: Prisma.ChecklistInstanceWhereInput = {
    orgId: ctx.orgId,
    ...(role === "OWNER" ? {} : { property: { members: { some: { userId: ctx.userId } } } }),
    ...statusWhere(opts.status),
  };
  // ponytail: no pagination; cap at 500 rows, add cursor paging when an org outgrows it.
  const rows = await db.checklistInstance.findMany({ where, select: summarySelect, orderBy: { dueAt: "asc" }, take: 500 });
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
      schedule: { select: { name: true } },
      items: { orderBy: { order: "asc" } },
    },
  });
  if (!r) throw notFound("checklistNotFound");
  const isAssignee = r.assigneeId === ctx.userId;
  const managerAccess = roleAtLeast(role, "MANAGER") && (role === "OWNER" || r.property.members.length > 0);
  if (!isAssignee && !managerAccess) throw notFound("checklistNotFound");
  return {
    ...toSummary({ ...r, property: { name: r.property.name } }),
    reviewComment: r.reviewComment, reviewedAt: r.reviewedAt, reviewedByName: r.reviewedBy?.name ?? null,
    scheduleName: r.schedule?.name ?? null,
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
  const role = await requireOrgRole(ctx, "WORKER");
  const rows = await db.checklistInstance.findMany({
    where: {
      orgId: ctx.orgId, propertyId: { in: propertyIds }, status: { in: ["OPEN", "REJECTED"] },
      ...(role === "WORKER" ? { assigneeId: ctx.userId } : {}),
    },
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

export type AnswerValue =
  | { type: "CHECKBOX"; checked: boolean }
  | { type: "TEXT"; text: string }
  | { type: "NUMBER"; number: number }
  | { type: "SELECT"; choice: string }
  | { type: "PHOTO" | "VIDEO"; fileKey: string; fileType: string };

export function isAnswered(i: { type: ItemType; checked: boolean | null; text: string | null; number: number | null; choice: string | null; fileKey: string | null }) {
  return isItemAnswered(i);
}

/** Loads an instance the caller may act on as its assignee. NOT_FOUND hides existence from everyone else. */
async function ownInstance(ctx: Ctx, instanceId: string) {
  const role = await requireOrgRole(ctx, "WORKER");
  const inst = await db.checklistInstance.findFirst({
    where: { id: instanceId, orgId: ctx.orgId },
    select: { id: true, assigneeId: true, status: true, property: { select: { members: { where: { userId: ctx.userId }, select: { userId: true } } } } },
  });
  if (!inst) throw notFound("checklistNotFound");
  if (inst.assigneeId !== ctx.userId) {
    // A manager with access to the instance's property gets FORBIDDEN (they cannot answer for workers); everyone else NOT_FOUND, to avoid leaking existence.
    const managerAccess = roleAtLeast(role, "MANAGER") && (role === "OWNER" || inst.property.members.length > 0);
    if (managerAccess) throw forbidden("onlyAssignee");
    throw notFound("checklistNotFound");
  }
  return inst;
}

const assertFillable = (status: InstanceStatus) => {
  if (status !== "OPEN" && status !== "REJECTED") throw invalid("statusNotEditable", { status });
};

export async function answerItem(ctx: Ctx, instanceId: string, itemId: string, value: AnswerValue) {
  const inst = await ownInstance(ctx, instanceId);
  assertFillable(inst.status);
  const item = await db.instanceItem.findFirst({ where: { id: itemId, instanceId } });
  if (!item) throw notFound("itemNotFound");
  if (item.type !== value.type) throw invalid("itemTypeMismatch", { label: item.label, type: item.type.toLowerCase() });

  const data: Prisma.InstanceItemUpdateManyMutationInput = { answeredAt: new Date() };
  switch (value.type) {
    case "CHECKBOX": data.checked = value.checked; break;
    case "TEXT": data.text = value.text.slice(0, 2000); break;
    case "NUMBER":
      if (!Number.isFinite(value.number)) throw invalid("mustBeNumber", { label: item.label });
      if (item.min != null && value.number < item.min) throw invalid("atLeast", { label: item.label, min: item.min });
      if (item.max != null && value.number > item.max) throw invalid("atMost", { label: item.label, max: item.max });
      data.number = value.number; break;
    case "SELECT":
      if (!item.options.includes(value.choice)) throw invalid("notAnOption", { choice: value.choice, label: item.label });
      data.choice = value.choice; break;
    case "PHOTO":
    case "VIDEO": {
      const ext = extForMime(value.fileType);
      if (!ext || !mediaRule(value.type).types.includes(value.fileType)) throw invalid("unsupportedFileType");
      if (value.fileKey !== mediaKey(ctx.orgId, instanceId, itemId, ext)) throw invalid("invalidFileKey");
      // The presigned PUT happens in the browser, so nothing else proves the upload actually landed.
      if (storageConfigured() && !(await objectExists(value.fileKey))) throw invalid("uploadFirst");
      data.fileKey = value.fileKey; data.fileType = value.fileType; break;
    }
  }
  // Conditional on the instance still being fillable, so a concurrent submit cannot be written around.
  const { count } = await db.instanceItem.updateMany({ where: { id: itemId, instance: { status: { in: ["OPEN", "REJECTED"] } } }, data });
  if (count === 0) throw invalid("noLongerEditable");
}

/** Issues a presigned PUT for a PHOTO or VIDEO item. The key is deterministic per item, so re-uploads overwrite. */
export async function requestUpload(ctx: Ctx, input: { instanceId: string; itemId: string; contentType: string; sizeBytes: number }) {
  const inst = await getInstance(ctx, input.instanceId);
  if (!inst.canFill) throw invalid("cannotEdit");
  const item = inst.items.find((i) => i.id === input.itemId);
  if (!item || (item.type !== "PHOTO" && item.type !== "VIDEO")) throw invalid("itemNoFiles");
  const rule = mediaRule(item.type);
  const ext = extForMime(input.contentType);
  if (!ext || !rule.types.includes(input.contentType)) throw invalid("unsupportedFileTypeNamed", { type: input.contentType });
  if (input.sizeBytes > rule.maxBytes) throw invalid("fileTooLarge", { mb: Math.round(rule.maxBytes / 1024 / 1024) });
  const key = mediaKey(ctx.orgId, input.instanceId, input.itemId, ext);
  const url = await presignUpload({ key, contentType: input.contentType, contentLength: input.sizeBytes, expiresSec: rule.presignSec });
  return { url, key };
}

export async function submit(ctx: Ctx, instanceId: string) {
  const inst = await ownInstance(ctx, instanceId);
  assertFillable(inst.status);
  const items = await db.instanceItem.findMany({ where: { instanceId }, orderBy: { order: "asc" } });
  const missing = items.filter((i) => i.required && !isAnswered(i)).map((i) => i.label);
  if (missing.length) throw invalid("missing", { labels: missing.join(", ") });
  const { count } = await db.checklistInstance.updateMany({
    where: { id: instanceId, status: { in: ["OPEN", "REJECTED"] } },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });
  if (count === 0) throw invalid("alreadySubmitted");

  const full = await db.checklistInstance.findUniqueOrThrow({
    where: { id: instanceId }, select: { propertyId: true, templateName: true, dueAt: true, assignee: { select: { name: true } }, property: { select: { name: true } }, org: { select: { timezone: true } } },
  });
  const recipients = await recipientsForSubmitted(ctx.orgId, full.propertyId, ctx.userId);
  const params = copyParams({ template: full.templateName, property: full.property.name, dueAt: full.dueAt, tz: full.org.timezone, worker: full.assignee.name });
  await notify(recipients.map((userId) => ({ orgId: ctx.orgId, userId, type: "SUBMITTED" as const, instanceId, url: `/checklists/${instanceId}`, params })));
}

export async function review(ctx: Ctx, instanceId: string, decision: "APPROVED" | "REJECTED", comment?: string) {
  const role = await requireOrgRole(ctx, "MANAGER");
  const inst = await db.checklistInstance.findFirst({
    where: { id: instanceId, orgId: ctx.orgId },
    select: { id: true, status: true, propertyId: true, property: { select: { members: { where: { userId: ctx.userId }, select: { userId: true } } } } },
  });
  if (!inst || (role !== "OWNER" && inst.property.members.length === 0)) throw notFound("checklistNotFound");
  if (inst.status !== "SUBMITTED") throw invalid("notSubmitted", { status: inst.status });
  const text = comment?.trim() || null;
  if (decision === "REJECTED" && !text) throw invalid("commentRequired");
  const { count } = await db.checklistInstance.updateMany({
    where: { id: instanceId, status: "SUBMITTED" },
    data: { status: decision, reviewedAt: new Date(), reviewedById: ctx.userId, reviewComment: text },
  });
  if (count === 0) throw invalid("notAwaitingReview");

  const full = await db.checklistInstance.findUniqueOrThrow({
    where: { id: instanceId }, select: { assigneeId: true, templateName: true, dueAt: true, property: { select: { name: true } }, org: { select: { timezone: true } } },
  });
  const params = copyParams({ template: full.templateName, property: full.property.name, dueAt: full.dueAt, tz: full.org.timezone, comment: text });
  await notify([{ orgId: ctx.orgId, userId: full.assigneeId, type: decision, instanceId, url: `/checklists/${instanceId}`, params }]);
}
