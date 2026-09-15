import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { requireUser, requireOrgRole, roleAtLeast } from "@/lib/auth/guard";
import { listProperties } from "@/lib/services/property";
import { instanceCounts } from "@/lib/services/instance";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";

export default async function DashboardPage() {
  const ctx = await requireUser();
  const role = await requireOrgRole(ctx, "WORKER");
  const properties = await listProperties(ctx);
  const counts = await instanceCounts(ctx, properties.map((p) => p.id));
  const manager = roleAtLeast(role, "MANAGER");
  return (
    <div className="space-y-6">
      <PageHeader title="Properties">
        {manager && <Button render={<Link href="/properties/new" />}><Plus aria-hidden /> New property</Button>}
      </PageHeader>
      {properties.length === 0 && (
        <div className="rounded-xl border border-dashed px-4 py-12 text-center">
          <Building2 className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="mt-3 font-medium">{manager ? "Add your first property" : "No properties assigned to you yet"}</p>
          <p className="mt-1 text-sm text-muted-foreground">{manager ? "Each property gets its own members, checklists and schedules." : "A manager adds you to a property before work shows up here."}</p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {properties.map((p) => {
          const c = counts[p.id];
          return (
            <Link key={p.id} href={`/properties/${p.id}`}
              className="group flex min-h-28 flex-col justify-between rounded-xl bg-card p-4 ring-1 ring-border transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold group-hover:text-primary">{p.name}</h2>
                <p className="truncate text-sm text-muted-foreground">{p.address ?? "No address"}</p>
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>{p.memberCount} member{p.memberCount === 1 ? "" : "s"}</span>
                {c.open > 0 && <span>{c.open} open</span>}
                {c.overdue > 0 && <span className="font-medium text-destructive">{c.overdue} overdue</span>}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
