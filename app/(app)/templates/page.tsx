import Link from "next/link";
import { LayoutTemplate, Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { requireUser } from "@/lib/auth/guard";
import { listTemplates } from "@/lib/services/template";
import { AppError } from "@/lib/errors";
import { Forbidden } from "@/components/forbidden";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { List, ListLink } from "@/components/ui/list";

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const ctx = await requireUser();
  const t = await getTranslations("templates");
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
      <PageHeader title={t("title")} description={t("description")}>
        <Button variant="outline" render={<Link href={showArchived ? "/templates" : "/templates?archived=1"} />}>{showArchived ? t("hideArchived") : t("showArchived")}</Button>
        <Button render={<Link href="/templates/new" />}><Plus aria-hidden /> {t("new")}</Button>
      </PageHeader>
      {templates.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-12 text-center">
          <LayoutTemplate className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="mt-3 font-medium">{t("empty")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("emptyHint")}</p>
        </div>
      ) : (
        <List>
          {templates.map((x) => (
            <ListLink key={x.id} href={`/templates/${x.id}`}>
              <span className="font-medium">{x.name}</span>
              <span className="text-muted-foreground">{t("itemCount", { count: x.itemCount, archived: x.archivedAt ? "yes" : "no" })}</span>
            </ListLink>
          ))}
        </List>
      )}
    </div>
  );
}
