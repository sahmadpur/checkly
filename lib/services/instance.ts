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
