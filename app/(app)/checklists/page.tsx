import { requireUser } from "@/lib/auth/guard";
import { listAll, type StatusFilter } from "@/lib/services/instance";
import { AppError } from "@/lib/errors";
import { PageHeader } from "@/components/page-header";
import { Forbidden } from "@/components/forbidden";
import { ChecklistList, parseStatusFilter } from "@/components/checklist-list";

export default async function ChecklistsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireUser();
  const filter = parseStatusFilter((await searchParams).status);
  let instances;
  try {
    instances = await listAll(ctx, filter ? { status: filter as StatusFilter } : {});
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") return <Forbidden />;
    throw e;
  }
  return (
    <div className="space-y-6">
      <PageHeader title="Checklists" description="Everything assigned across your properties. Open one to see the answers." />
      <ChecklistList basePath="/checklists" instances={instances} filter={filter} subtitle={(i) => `${i.propertyName} · ${i.assigneeName}`}
        empty="No checklists yet. Assign one from a property page." />
    </div>
  );
}
