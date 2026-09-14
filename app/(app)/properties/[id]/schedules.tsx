import Link from "next/link";
import type { ScheduleRow } from "@/lib/services/schedule";
import { LocalTime } from "@/components/local-time";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";

export function PropertySchedules({ propertyId, schedules }: { propertyId: string; schedules: ScheduleRow[] }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Schedules</h2>
        <Button size="sm" render={<Link href={`/properties/${propertyId}/schedules/new`} />}>New schedule</Button>
      </div>
      <ul className="divide-y rounded-md border">
        {schedules.length === 0 && <li className="p-3 text-sm text-muted-foreground">No schedules.</li>}
        {schedules.map((s) => (
          <li key={s.id} className="p-3 text-sm">
            <Link href={`/schedules/${s.id}`} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-medium">{s.name}</span> <span className="text-muted-foreground">· {s.description} · {s.assignees.map((a) => a.name).join(", ") || "no workers"}</span>
              </span>
              <span className="flex items-center gap-2 text-muted-foreground">
                {s.pausedAt && <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Paused</span>}
                {s.assignees.length === 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">No assignees</span>}
                {s.templateArchived && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">Archived template</span>}
                {s.nextAt && <>next <LocalTime iso={s.nextAt.toISOString()} fallback={formatDateTime(s.nextAt)} /></>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
