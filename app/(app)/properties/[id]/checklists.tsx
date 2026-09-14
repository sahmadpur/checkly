import Link from "next/link";
import type { InstanceSummary } from "@/lib/services/instance";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/format";
import { LocalTime } from "@/components/local-time";

const FILTERS = [["", "All"], ["OPEN", "Open"], ["OVERDUE", "Overdue"], ["SUBMITTED", "Submitted"], ["APPROVED", "Approved"], ["REJECTED", "Rejected"]] as const;

export function PropertyChecklists({ propertyId, instances, filter }: { propertyId: string; instances: InstanceSummary[]; filter: string }) {
  return (
    <section className="space-y-3">
      <h2 className="font-medium">Checklists</h2>
      <nav className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map(([value, label]) => (
          <Link key={value} href={value ? `/properties/${propertyId}?status=${value}` : `/properties/${propertyId}`}
            className={`rounded-md px-2 py-1 ${filter === value ? "bg-accent font-medium" : "text-muted-foreground"}`}>{label}</Link>
        ))}
      </nav>
      <ul className="divide-y rounded-md border">
        {instances.length === 0 && <li className="p-3 text-sm text-muted-foreground">No checklists.</li>}
        {instances.map((i) => (
          <li key={i.id} className="p-3 text-sm">
            <Link href={`/checklists/${i.id}`} className="flex flex-wrap items-center justify-between gap-2">
              <span><span className="font-medium">{i.templateName}</span> <span className="text-muted-foreground">· {i.assigneeName}</span></span>
              <span className="flex items-center gap-2 text-muted-foreground"><LocalTime iso={i.dueAt.toISOString()} fallback={formatDateTime(i.dueAt)} /> <StatusBadge status={i.status} overdue={i.overdue} /></span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
