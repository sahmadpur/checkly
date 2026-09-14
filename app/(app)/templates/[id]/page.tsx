import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guard";
import { getTemplate } from "@/lib/services/template";
import { AppError } from "@/lib/errors";
import { Forbidden } from "@/components/forbidden";
import { TemplateBuilder } from "../template-builder";
import { ArchiveButton } from "./archive-button";

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireUser();
  let t;
  try {
    t = await getTemplate(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") return <Forbidden />;
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t.name}{t.archivedAt ? " (archived)" : ""}</h1>
        <ArchiveButton id={t.id} archived={!!t.archivedAt} />
      </div>
      <TemplateBuilder template={{ id: t.id, name: t.name, description: t.description, items: t.items.map(({ type, label, required, options, min, max }) => ({ type, label, required, options, min, max })) }} />
    </div>
  );
}
