import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth/guard";
import { describeRule, todayYmd } from "@/lib/schedule";
import { getSchedule } from "@/lib/services/schedule";
import { getProperty } from "@/lib/services/property";
import { listTemplates } from "@/lib/services/template";
import { AppError } from "@/lib/errors";
import { Forbidden } from "@/components/forbidden";
import { PageHeader } from "@/components/page-header";
import { ScheduleForm } from "../schedule-form";
import { ScheduleControls } from "./schedule-controls";
import { getLocale, getTranslations } from "next-intl/server";

export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireUser();
  let s;
  try { s = await getSchedule(ctx, id); } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") return <Forbidden />;
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const [property, templates, org, t, locale] = await Promise.all([
    getProperty(ctx, s.propertyId),
    listTemplates(ctx, { includeArchived: true }),
    db.org.findUniqueOrThrow({ where: { id: ctx.orgId }, select: { timezone: true } }),
    getTranslations("schedules.detail"),
    getLocale(),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title={<>{s.name}{s.pausedAt && <span className="ml-3 align-middle rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">{t("paused")}</span>}</>}
        back={{ href: `/properties/${s.propertyId}`, label: property.name }} description={`${describeRule(s, locale)} · ${org.timezone}`}>
        <ScheduleControls id={s.id} paused={!!s.pausedAt} />
      </PageHeader>
      <ScheduleForm propertyId={s.propertyId} templates={templates.map((t) => ({ id: t.id, name: t.name }))} workers={property.members.map((m) => ({ id: m.userId, name: m.name }))}
        todayYmd={todayYmd(org.timezone)} templateArchived={s.templateArchived}
        schedule={{ id: s.id, templateId: s.templateId, assigneeIds: s.assignees.map((a) => a.userId), freq: s.freq, daysOfWeek: s.daysOfWeek, dayOfMonth: s.dayOfMonth, dueTime: s.dueTime, startsOn: s.startsOn, endsOn: s.endsOn }} />
    </div>
  );
}
