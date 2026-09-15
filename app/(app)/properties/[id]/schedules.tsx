import Link from "next/link";
import { Plus } from "lucide-react";
import type { ScheduleRow } from "@/lib/services/schedule";
import { LocalTime } from "@/components/local-time";
import { formatDateTime } from "@/lib/format";
import { describeRule } from "@/lib/schedule";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { List, ListEmpty, ListLink } from "@/components/ui/list";
import { Section } from "@/components/section";

const pill = "rounded-full px-2 py-0.5 text-xs font-medium";

export async function PropertySchedules({ propertyId, schedules, locale }: { propertyId: string; schedules: ScheduleRow[]; locale: string }) {
  const t = await getTranslations("properties.schedules");
  return (
    <Section title={t("title")} actions={<Button size="sm" variant="outline" render={<Link href={`/properties/${propertyId}/schedules/new`} />}><Plus aria-hidden /> {t("new")}</Button>}>
      <List>
        {schedules.length === 0 && <ListEmpty>{t("empty")}</ListEmpty>}
        {schedules.map((s) => (
          <ListLink key={s.id} href={`/schedules/${s.id}`} rail={s.pausedAt ? "bg-muted-foreground/40" : s.assignees.length === 0 || s.templateArchived ? "bg-warning" : undefined}>
            <span className="min-w-0">
              <span className="block truncate font-medium">{s.name}</span>
              <span className="block truncate text-muted-foreground">{describeRule(s, locale)} · {s.assignees.map((a) => a.name).join(", ") || t("noWorkersInline")}</span>
            </span>
            <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
              {s.pausedAt && <span className={`${pill} bg-muted`}>{t("paused")}</span>}
              {s.assignees.length === 0 && <span className={`${pill} bg-warning/15 text-warning-foreground`}>{t("noWorkers")}</span>}
              {s.templateArchived && <span className={`${pill} bg-warning/15 text-warning-foreground`}>{t("archivedTemplate")}</span>}
              {s.nextAt && <>{t("next")} <LocalTime iso={s.nextAt.toISOString()} fallback={formatDateTime(s.nextAt, locale)} /></>}
            </span>
          </ListLink>
        ))}
      </List>
    </Section>
  );
}
