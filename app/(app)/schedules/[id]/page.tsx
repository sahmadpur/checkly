import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guard";
import { getSchedule } from "@/lib/services/schedule";
import { getProperty } from "@/lib/services/property";
import { listTemplates } from "@/lib/services/template";
import { AppError } from "@/lib/errors";
import { Forbidden } from "@/components/forbidden";
import { ScheduleForm } from "../schedule-form";
import { ScheduleControls } from "./schedule-controls";

export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireUser();
  let s;
  try { s = await getSchedule(ctx, id); } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") return <Forbidden />;
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const [property, templates] = await Promise.all([getProperty(ctx, s.propertyId), listTemplates(ctx, { includeArchived: true })]);
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground"><Link href={`/properties/${s.propertyId}`} className="underline">{property.name}</Link></p>
        <h1 className="text-xl font-semibold">{s.name}{s.pausedAt ? " (paused)" : ""}</h1>
        <p className="text-sm text-muted-foreground">{s.description}</p>
      </div>
      <ScheduleControls id={s.id} paused={!!s.pausedAt} />
      <ScheduleForm propertyId={s.propertyId} templates={templates.map((t) => ({ id: t.id, name: t.name }))} workers={property.members.map((m) => ({ id: m.userId, name: m.name }))}
        schedule={{ id: s.id, templateId: s.templateId, assigneeIds: s.assignees.map((a) => a.userId), freq: s.freq, daysOfWeek: s.daysOfWeek, dayOfMonth: s.dayOfMonth, dueTime: s.dueTime, startsOn: s.startsOn, endsOn: s.endsOn }} />
    </div>
  );
}
