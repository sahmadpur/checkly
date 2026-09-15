import { requireUser } from "@/lib/auth/guard";
import { listAll, type StatusFilter } from "@/lib/services/instance";
import { AppError } from "@/lib/errors";
import { PageHeader } from "@/components/page-header";
import { Forbidden } from "@/components/forbidden";
import { ChecklistList, parseStatusFilter } from "@/components/checklist-list";
import { listProperties } from "@/lib/services/property";
import { listMembers } from "@/lib/services/member";
import { listTemplates } from "@/lib/services/template";
import { AssignForm } from "../properties/[id]/assign-form";

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
  const [properties, members, templates] = await Promise.all([listProperties(ctx), listMembers(ctx), listTemplates(ctx)]);
  const options = properties.map((p) => ({ id: p.id, name: p.name, workers: members.filter((m) => m.propertyIds.includes(p.id)).map((m) => ({ id: m.userId, name: m.name })) }));
  return (
    <div className="space-y-8">
      <PageHeader title="Checklists" description="Everything assigned across your properties. Open one to see the answers." />
      <ChecklistList basePath="/checklists" instances={instances} filter={filter} subtitle={(i) => `${i.propertyName} · ${i.assigneeName}`}
        empty="No checklists yet. Assign one below." />
      <AssignForm properties={options} templates={templates.map((t) => ({ id: t.id, name: t.name }))} />
    </div>
  );
}
