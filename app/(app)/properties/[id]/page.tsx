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
    ? (await listMembers(ctx)).filter((m) => !assigned.has(m.userId)).map(({ userId, name }) => ({ userId, name }))
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
