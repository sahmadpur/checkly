import type { InstanceSummary } from "@/lib/services/instance";
import { ChecklistList } from "@/components/checklist-list";
import { Section } from "@/components/section";
import { getTranslations } from "next-intl/server";

export async function PropertyChecklists({ propertyId, instances, filter }: { propertyId: string; instances: InstanceSummary[]; filter: string }) {
  const t = await getTranslations("properties.checklists");
  return (
    <Section title={t("title")}>
      <ChecklistList basePath={`/properties/${propertyId}`} instances={instances} filter={filter} subtitle={(i) => i.assigneeName}
        empty={t("empty")} />
    </Section>
  );
}
