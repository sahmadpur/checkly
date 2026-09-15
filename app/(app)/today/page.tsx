import { ClipboardCheck } from "lucide-react";
import { requireUser } from "@/lib/auth/guard";
import { listMine, InstanceSummary } from "@/lib/services/instance";
import { StatusBadge, STATUS_RAIL, statusKey } from "@/components/status-badge";
import { formatDateTime } from "@/lib/format";
import { LocalTime } from "@/components/local-time";
import { List, ListLink } from "@/components/ui/list";
import { PageHeader } from "@/components/page-header";

function bucket(all: InstanceSummary[]) {
  const now = new Date();
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
  const out = { overdue: [] as InstanceSummary[], rework: [] as InstanceSummary[], today: [] as InstanceSummary[], upcoming: [] as InstanceSummary[], done: [] as InstanceSummary[] };
  for (const i of all) {
    if (i.status === "REJECTED") out.rework.push(i);
    else if (i.status === "SUBMITTED" || i.status === "APPROVED") out.done.push(i);
    else if (i.overdue) out.overdue.push(i);
    else if (i.dueAt <= endOfDay) out.today.push(i);
    else out.upcoming.push(i);
  }
  return out;
}

function Section({ title, items }: { title: string; items: InstanceSummary[] }) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">{title} <span className="text-base font-normal text-muted-foreground">{items.length}</span></h2>
      <List>
        {items.map((i) => (
          <ListLink key={i.id} href={`/checklists/${i.id}`} rail={STATUS_RAIL[statusKey(i.status, i.overdue)]}>
            <span className="min-w-0">
              <span className="block truncate font-medium">{i.templateName}</span>
              <span className="block truncate text-muted-foreground">{i.propertyName}</span>
            </span>
            <span className="flex items-center gap-2 text-muted-foreground">
              <LocalTime iso={i.dueAt.toISOString()} fallback={formatDateTime(i.dueAt)} />
              <StatusBadge status={i.status} overdue={i.overdue} />
            </span>
          </ListLink>
        ))}
      </List>
    </section>
  );
}

const DAY = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" });

export default async function TodayPage() {
  const ctx = await requireUser();
  const b = bucket(await listMine(ctx));
  const empty = Object.values(b).every((x) => x.length === 0);
  return (
    <div className="space-y-6">
      <PageHeader title="Today" description={DAY.format(new Date())} />
      {empty && (
        <div className="rounded-xl border border-dashed px-4 py-12 text-center">
          <ClipboardCheck className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="mt-3 font-medium">Nothing on your list</p>
          <p className="mt-1 text-sm text-muted-foreground">Checklists assigned to you will show up here.</p>
        </div>
      )}
      <Section title="Overdue" items={b.overdue} />
      <Section title="Needs rework" items={b.rework} />
      <Section title="Due today" items={b.today} />
      <Section title="Upcoming" items={b.upcoming} />
      <Section title="Done" items={b.done} />
    </div>
  );
}
