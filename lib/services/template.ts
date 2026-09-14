import { ItemType } from "@prisma/client";
import { db } from "@/lib/db";
import { Ctx, requireOrgRole } from "@/lib/auth/guard";
import { invalid, notFound } from "@/lib/errors";

export type ItemInput = { type: ItemType; label: string; required: boolean; options: string[]; min: number | null; max: number | null };
export type TemplateInput = { name: string; description?: string | null; items: ItemInput[] };
export type TemplateSummary = { id: string; name: string; description: string | null; archivedAt: Date | null; itemCount: number };
export type TemplateDetail = {
  id: string; name: string; description: string | null; archivedAt: Date | null;
  items: (ItemInput & { id: string; order: number })[];
};

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

export async function listTemplates(ctx: Ctx, opts: { includeArchived?: boolean } = {}): Promise<TemplateSummary[]> {
  await requireOrgRole(ctx, "MANAGER");
  const rows = await db.checklistTemplate.findMany({
    where: { orgId: ctx.orgId, ...(opts.includeArchived ? {} : { archivedAt: null }) },
    orderBy: { name: "asc" },
    include: { _count: { select: { items: true } } },
  });
  return rows.map((t) => ({ id: t.id, name: t.name, description: t.description, archivedAt: t.archivedAt, itemCount: t._count.items }));
}

export async function getTemplate(ctx: Ctx, id: string): Promise<TemplateDetail> {
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

export async function createTemplate(ctx: Ctx, input: TemplateInput): Promise<{ id: string }> {
  await requireOrgRole(ctx, "MANAGER");
  validateItems(input.items);
  const t = await db.checklistTemplate.create({
    data: { orgId: ctx.orgId, name: input.name.trim(), description: input.description?.trim() || null, items: { create: toRows(input.items) } },
    select: { id: true },
  });
  return { id: t.id };
}

export async function updateTemplate(ctx: Ctx, id: string, input: TemplateInput): Promise<void> {
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

export async function archiveTemplate(ctx: Ctx, id: string): Promise<void> {
  await requireOrgRole(ctx, "MANAGER");
  await ownedTemplate(ctx, id);
  await db.checklistTemplate.update({ where: { id }, data: { archivedAt: new Date() } });
}

export async function unarchiveTemplate(ctx: Ctx, id: string): Promise<void> {
  await requireOrgRole(ctx, "MANAGER");
  await ownedTemplate(ctx, id);
  await db.checklistTemplate.update({ where: { id }, data: { archivedAt: null } });
}
