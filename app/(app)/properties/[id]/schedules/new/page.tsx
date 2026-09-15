import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser, requireOrgRole } from "@/lib/auth/guard";
import { todayYmd } from "@/lib/schedule";
import { getProperty } from "@/lib/services/property";
import { listTemplates } from "@/lib/services/template";
import { AppError } from "@/lib/errors";
import { Forbidden } from "@/components/forbidden";
import { PageHeader } from "@/components/page-header";
import { ScheduleForm } from "@/app/(app)/schedules/schedule-form";
import { getTranslations } from "next-intl/server";

export default async function NewSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireUser();
  try { await requireOrgRole(ctx, "MANAGER"); } catch (e) { if (e instanceof AppError && e.code === "FORBIDDEN") return <Forbidden />; throw e; }
  let property;
  try { property = await getProperty(ctx, id); } catch (e) { if (e instanceof AppError && e.code === "NOT_FOUND") notFound(); throw e; }
  const [templates, org] = await Promise.all([listTemplates(ctx), db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { timezone: true } })]);
  const t = await getTranslations("properties.schedules");
  return (
    <div className="space-y-6">
      <PageHeader title={t("new")} back={{ href: `/properties/${property.id}`, label: property.name }} description={t("tz", { tz: org.timezone })} />
      <ScheduleForm propertyId={property.id} templates={templates.map((t) => ({ id: t.id, name: t.name }))} workers={property.members.map((m) => ({ id: m.userId, name: m.name }))} todayYmd={todayYmd(org.timezone)} />
    </div>
  );
}
