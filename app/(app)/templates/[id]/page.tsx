import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth/guard";
import { getTemplate } from "@/lib/services/template";
import { AppError } from "@/lib/errors";
import { Forbidden } from "@/components/forbidden";
import { PageHeader } from "@/components/page-header";
import { TemplateBuilder } from "../template-builder";
import { ArchiveButton } from "./archive-button";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireUser();
  const tr = await getTranslations("templates");
  let t;
  try {
    t = await getTemplate(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") return <Forbidden />;
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  return (
    <div className="space-y-6">
      <PageHeader title={t.name} back={{ href: "/templates", label: tr("title") }} description={t.archivedAt ? tr("archivedNote") : undefined}>
        <ArchiveButton id={t.id} archived={!!t.archivedAt} />
      </PageHeader>
      <TemplateBuilder template={{ id: t.id, name: t.name, description: t.description, items: t.items.map(({ type, label, required, options, min, max }) => ({ type, label, required, options, min, max })) }} />
    </div>
  );
}
