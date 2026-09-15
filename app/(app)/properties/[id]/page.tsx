import { notFound } from "next/navigation";
import { requireUser, requireOrgRole, roleAtLeast } from "@/lib/auth/guard";
import { getProperty } from "@/lib/services/property";
import { listMembers } from "@/lib/services/member";
import { listForProperty, type StatusFilter } from "@/lib/services/instance";
import { listTemplates } from "@/lib/services/template";
import { listSchedules } from "@/lib/services/schedule";
import { AppError } from "@/lib/errors";
import { PageHeader } from "@/components/page-header";
import { Section } from "@/components/section";
import { PropertyForm } from "../new/property-form";
import { PropertyMembers } from "./members";
import { PropertyChecklists } from "./checklists";
import { parseStatusFilter } from "@/components/checklist-list";
import { PropertySchedules } from "./schedules";
import { AssignForm } from "./assign-form";
import { DeleteProperty } from "./danger";

export default async function PropertyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
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
    ? (await listMembers(ctx)).filter((m) => !assigned.has(m.userId)).map(({ userId, name }) => ({ userId, name }))
    : [];
  const { status } = await searchParams;
  const filter = parseStatusFilter(status);
  const instances = await listForProperty(ctx, id, filter ? { status: filter as StatusFilter } : {});
  const templates = canEdit ? await listTemplates(ctx) : [];
  const schedules = canEdit ? await listSchedules(ctx, id) : [];

  return (
    <div className="space-y-8">
      <PageHeader title={property.name} back={{ href: "/", label: "Properties" }} description={property.address ?? "No address"} />
      <PropertyChecklists propertyId={property.id} instances={instances} filter={filter} />
      {canEdit && <AssignForm propertyId={property.id} templates={templates.map((t) => ({ id: t.id, name: t.name }))} workers={property.members.map((m) => ({ id: m.userId, name: m.name }))} />}
      {canEdit && <PropertySchedules propertyId={property.id} schedules={schedules} />}
      <PropertyMembers propertyId={property.id} members={property.members} candidates={candidates} canEdit={canEdit} />
      {canEdit && (
        <Section title="Details" card>
          <PropertyForm property={property} />
        </Section>
      )}
      {canEdit && <DeleteProperty id={property.id} name={property.name} />}
    </div>
  );
}
