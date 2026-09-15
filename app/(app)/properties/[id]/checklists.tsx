import type { InstanceSummary } from "@/lib/services/instance";
import { ChecklistList } from "@/components/checklist-list";
import { Section } from "@/components/section";

export function PropertyChecklists({ propertyId, instances, filter }: { propertyId: string; instances: InstanceSummary[]; filter: string }) {
  return (
    <Section title="Checklists">
      <ChecklistList basePath={`/properties/${propertyId}`} instances={instances} filter={filter} subtitle={(i) => i.assigneeName}
        empty="No checklists yet. Assign one below or set up a schedule." />
    </Section>
  );
}
