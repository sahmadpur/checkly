import Link from "next/link";
import { requireUser } from "@/lib/auth/guard";
import { listTemplates } from "@/lib/services/template";
import { AppError } from "@/lib/errors";
import { Forbidden } from "@/components/forbidden";
import { Button } from "@/components/ui/button";

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const ctx = await requireUser();
  const { archived } = await searchParams;
  let templates;
  try {
    templates = await listTemplates(ctx, { includeArchived: archived === "1" });
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") return <Forbidden />;
    throw e;
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Templates</h1>
        <Button render={<Link href="/templates/new" />}>New template</Button>
      </div>
      <p className="text-sm">
        <Link className="underline" href={archived === "1" ? "/templates" : "/templates?archived=1"}>{archived === "1" ? "Hide archived" : "Show archived"}</Link>
      </p>
      {templates.length === 0 && <p className="text-sm text-muted-foreground">No templates yet.</p>}
      <ul className="divide-y rounded-md border">
        {templates.map((t) => (
          <li key={t.id} className="flex items-center justify-between p-3 text-sm">
            <Link href={`/templates/${t.id}`} className="font-medium">{t.name}</Link>
            <span className="text-muted-foreground">{t.itemCount} item{t.itemCount === 1 ? "" : "s"}{t.archivedAt ? " · archived" : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
