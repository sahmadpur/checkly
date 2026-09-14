import Link from "next/link";
import { requireUser } from "@/lib/auth/guard";
import { listMine, InstanceSummary } from "@/lib/services/instance";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/format";
import { LocalTime } from "@/components/local-time";

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
      <h2 className="font-medium">{title}</h2>
      <ul className="divide-y rounded-md border">
        {items.map((i) => (
          <li key={i.id}>
            <Link href={`/checklists/${i.id}`} className="flex items-center justify-between gap-2 p-3 text-sm">
              <span><span className="font-medium">{i.templateName}</span> <span className="text-muted-foreground">· {i.propertyName}</span></span>
              <span className="flex items-center gap-2 text-muted-foreground"><LocalTime iso={i.dueAt.toISOString()} fallback={formatDateTime(i.dueAt)} /> <StatusBadge status={i.status} overdue={i.overdue} /></span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function TodayPage() {
  const ctx = await requireUser();
  const b = bucket(await listMine(ctx));
  const empty = Object.values(b).every((x) => x.length === 0);
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Today</h1>
      {empty && <p className="text-sm text-muted-foreground">Nothing assigned to you.</p>}
      <Section title="Overdue" items={b.overdue} />
      <Section title="Needs rework" items={b.rework} />
      <Section title="Due today" items={b.today} />
      <Section title="Upcoming" items={b.upcoming} />
      <Section title="Done" items={b.done} />
    </div>
  );
}
