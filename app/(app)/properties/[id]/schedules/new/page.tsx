import { notFound } from "next/navigation";
import { requireUser, requireOrgRole } from "@/lib/auth/guard";
import { getProperty } from "@/lib/services/property";
import { listTemplates } from "@/lib/services/template";
import { AppError } from "@/lib/errors";
import { Forbidden } from "@/components/forbidden";
import { ScheduleForm } from "@/app/(app)/schedules/schedule-form";

export default async function NewSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireUser();
  try { await requireOrgRole(ctx, "MANAGER"); } catch (e) { if (e instanceof AppError && e.code === "FORBIDDEN") return <Forbidden />; throw e; }
  let property;
  try { property = await getProperty(ctx, id); } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
  const templates = await listTemplates(ctx);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">New schedule · {property.name}</h1>
      <ScheduleForm propertyId={property.id} templates={templates.map((t) => ({ id: t.id, name: t.name }))} workers={property.members.map((m) => ({ id: m.userId, name: m.name }))} />
    </div>
  );
}
