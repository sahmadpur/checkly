import { getTranslations } from "next-intl/server";
import { requireUser, requireOrgRole } from "@/lib/auth/guard";
import { AppError } from "@/lib/errors";
import { Forbidden } from "@/components/forbidden";
import { PageHeader } from "@/components/page-header";
import { TemplateBuilder } from "../template-builder";

export default async function NewTemplatePage() {
  try {
    await requireOrgRole(await requireUser(), "MANAGER");
  } catch (e) {
    if (e instanceof AppError && e.code === "FORBIDDEN") return <Forbidden />;
    throw e;
  }
  const t = await getTranslations("templates");
  return (
    <div className="space-y-6">
      <PageHeader title={t("new")} back={{ href: "/templates", label: t("title") }} />
      <TemplateBuilder />
    </div>
  );
}
