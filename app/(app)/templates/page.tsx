import Link from "next/link";
import { LayoutTemplate, Plus } from "lucide-react";
import { requireUser } from "@/lib/auth/guard";
import { listTemplates } from "@/lib/services/template";
import { AppError } from "@/lib/errors";
import { Forbidden } from "@/components/forbidden";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { List, ListLink } from "@/components/ui/list";

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const ctx = await requireUser();
  const { archived } = await searchParams;
  const showArchived = archived === "1";
  let templates;
  try {
    templates = await listTemplates(ctx, { includeArchived: showArchived });
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") return <Forbidden />;
    throw e;
  }
  return (
    <div className="space-y-6">
      <PageHeader title="Templates" description="Reusable checklists you assign or schedule at properties.">
        <Button variant="outline" render={<Link href={showArchived ? "/templates" : "/templates?archived=1"} />}>{showArchived ? "Hide archived" : "Show archived"}</Button>
        <Button render={<Link href="/templates/new" />}><Plus aria-hidden /> New template</Button>
      </PageHeader>
      {templates.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-12 text-center">
          <LayoutTemplate className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="mt-3 font-medium">Build your first template</p>
          <p className="mt-1 text-sm text-muted-foreground">A turnover clean, a weekly inspection, a pool check: anything your team repeats.</p>
        </div>
      ) : (
        <List>
          {templates.map((t) => (
            <ListLink key={t.id} href={`/templates/${t.id}`}>
              <span className="font-medium">{t.name}</span>
              <span className="text-muted-foreground">{t.itemCount} item{t.itemCount === 1 ? "" : "s"}{t.archivedAt ? " · archived" : ""}</span>
            </ListLink>
          ))}
        </List>
      )}
    </div>
  );
}
