import { InstanceStatus, ItemType, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { Ctx, requireOrgRole, requirePropertyAccess, roleAtLeast } from "@/lib/auth/guard";
import { forbidden, invalid, notFound } from "@/lib/errors";
import { extForMime, isItemAnswered, mediaKey, mediaRule } from "@/lib/media";

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
  if (assigneeIds.length > 50) throw invalid("Assign to at most 50 workers at a time");
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
  const { role } = await requirePropertyAccess(ctx, propertyId);
  // Workers only ever see their own work; managers and owners see the whole property.
  const where: Prisma.ChecklistInstanceWhereInput = { orgId: ctx.orgId, propertyId, ...(role === "WORKER" ? { assigneeId: ctx.userId } : {}) };
  if (opts.status === "OVERDUE") {
    where.status = { in: ["OPEN", "REJECTED"] };
    where.dueAt = { lt: new Date() };
  } else if (opts.status) where.status = opts.status;
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
  if (!inst) throw notFound("Checklist not found");
  if (inst.assigneeId !== ctx.userId) {
    // A manager with access to the instance's property gets FORBIDDEN (they cannot answer for workers); everyone else NOT_FOUND, to avoid leaking existence.
    const managerAccess = roleAtLeast(role, "MANAGER") && (role === "OWNER" || inst.property.members.length > 0);
    if (managerAccess) throw forbidden("Only the assignee can fill in this checklist");
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

  const data: Prisma.InstanceItemUpdateManyMutationInput = { answeredAt: new Date() };
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
      const ext = extForMime(value.fileType);
      if (!ext || !mediaRule(value.type).types.includes(value.fileType)) throw invalid("Unsupported file type");
      if (value.fileKey !== mediaKey(ctx.orgId, instanceId, itemId, ext)) throw invalid("Invalid file key");
      data.fileKey = value.fileKey; data.fileType = value.fileType; break;
    }
  }
  // Conditional on the instance still being fillable, so a concurrent submit cannot be written around.
  const { count } = await db.instanceItem.updateMany({ where: { id: itemId, instance: { status: { in: ["OPEN", "REJECTED"] } } }, data });
  if (count === 0) throw invalid("Checklist can no longer be edited");
}

export async function submit(ctx: Ctx, instanceId: string) {
  const inst = await ownInstance(ctx, instanceId);
  assertFillable(inst.status);
  const items = await db.instanceItem.findMany({ where: { instanceId }, orderBy: { order: "asc" } });
  const missing = items.filter((i) => i.required && !isAnswered(i)).map((i) => i.label);
  if (missing.length) throw invalid(`Missing: ${missing.join(", ")}`);
  const { count } = await db.checklistInstance.updateMany({
    where: { id: instanceId, status: { in: ["OPEN", "REJECTED"] } },
    data: { status: "SUBMITTED", submittedAt: new Date() },
  });
  if (count === 0) throw invalid("Checklist was already submitted");
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
  const { count } = await db.checklistInstance.updateMany({
    where: { id: instanceId, status: "SUBMITTED" },
    data: { status: decision, reviewedAt: new Date(), reviewedById: ctx.userId, reviewComment: text },
  });
  if (count === 0) throw invalid("Checklist is no longer awaiting review");
}
