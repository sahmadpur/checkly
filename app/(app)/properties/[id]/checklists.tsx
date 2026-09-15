import Link from "next/link";
import type { InstanceSummary } from "@/lib/services/instance";
import { StatusBadge, STATUS_RAIL, statusKey } from "@/components/status-badge";
import { formatDateTime } from "@/lib/format";
import { LocalTime } from "@/components/local-time";
import { List, ListEmpty, ListLink } from "@/components/ui/list";
import { Section } from "@/components/section";
import { cn } from "cn";

const FILTERS = [["", "All"], ["OPEN", "Open"], ["OVERDUE", "Overdue"], ["SUBMITTED", "Submitted"], ["APPROVED", "Approved"], ["REJECTED", "Rejected"]] as const;

export function PropertyChecklists({ propertyId, instances, filter }: { propertyId: string; instances: InstanceSummary[]; filter: string }) {
  return (
    <Section title="Checklists">
      <nav aria-label="Filter by status" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 text-sm [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
        {FILTERS.map(([value, label]) => (
          <Link key={value} href={value ? `/properties/${propertyId}?status=${value}` : `/properties/${propertyId}`}
            aria-current={filter === value ? "page" : undefined}
            className={cn("shrink-0 rounded-full px-3 py-1.5 font-medium transition-colors", filter === value ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground ring-1 ring-border hover:text-foreground")}>{label}</Link>
        ))}
      </nav>
      <List>
        {instances.length === 0 && <ListEmpty>{filter ? "Nothing with this status." : "No checklists yet. Assign one below or set up a schedule."}</ListEmpty>}
        {instances.map((i) => (
          <ListLink key={i.id} href={`/checklists/${i.id}`} rail={STATUS_RAIL[statusKey(i.status, i.overdue)]}>
            <span className="min-w-0">
              <span className="block truncate font-medium">{i.templateName}</span>
              <span className="block truncate text-muted-foreground">{i.assigneeName}</span>
            </span>
            <span className="flex items-center gap-2 text-muted-foreground">
              <LocalTime iso={i.dueAt.toISOString()} fallback={formatDateTime(i.dueAt)} />
              <StatusBadge status={i.status} overdue={i.overdue} />
            </span>
          </ListLink>
        ))}
      </List>
    </Section>
  );
}
